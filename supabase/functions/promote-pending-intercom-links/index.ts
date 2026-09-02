import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Promote pending Intercom links that have aged past the Gmail-reconciliation window
// into manual_conversations. This is the safety net for tickets where the source
// email never arrived in our Gmail (e.g. customer used Intercom Messenger or a
// non-Group address). Runs every 2 min via pg_cron.
const PROMOTE_AFTER_MIN = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const cutoff = new Date(Date.now() - PROMOTE_AFTER_MIN * 60 * 1000).toISOString();

  const { data: stale, error: staleErr } = await supabase
    .from("pending_intercom_links")
    .select("*")
    .lte("intercom_created_at", cutoff)
    .order("intercom_created_at", { ascending: true })
    .limit(50);

  if (staleErr) {
    console.error("[promote-pending] fetch error", staleErr);
    return new Response(JSON.stringify({ error: staleErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!stale || stale.length === 0) {
    return new Response(JSON.stringify({ ok: true, promoted: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let promoted = 0;
  let droppedDuplicate = 0;
  const errors: Array<{ id: string; message: string }> = [];

  for (const row of stale) {
    try {
      // Last-chance check: maybe poll-gmail just landed the matching row.
      // Re-run the same reconciliation logic in-line before promoting.
      const normalize = (s: string) =>
        (s || "").replace(/^(Re|Fwd|Fw):\s*/gi, "").replace(/\s+/g, " ").toLowerCase().trim();

      const icMs = new Date(row.intercom_created_at).getTime();
      const windowStart = new Date(icMs - 15 * 60 * 1000).toISOString();
      const windowEnd = new Date(icMs + 15 * 60 * 1000).toISOString();

      const { data: gmailCandidates } = await supabase
        .from("gmail_conversations")
        .select("id, gmail_thread_id, subject, intercom_conversation_id")
        .gte("received_at", windowStart)
        .lte("received_at", windowEnd)
        .order("received_at", { ascending: false })
        .limit(50);

      const matched = (gmailCandidates || []).filter(
        (r) => normalize(String(r.subject || "")) === row.normalized_subject,
      );

      if (matched.length > 0 && matched[0].gmail_thread_id) {
        const threadId = matched[0].gmail_thread_id;
        const updatePayload: Record<string, unknown> = {
          intercom_conversation_id: row.intercom_conversation_id,
        };
        if (row.resolved_owner) updatePayload.owner = row.resolved_owner;
        await supabase
          .from("gmail_conversations")
          .update(updatePayload)
          .eq("gmail_thread_id", threadId)
          .or(
            `intercom_conversation_id.is.null,intercom_conversation_id.eq.${row.intercom_conversation_id}`,
          );
        await supabase.from("pending_intercom_links").delete().eq("id", row.id);
        droppedDuplicate++;
        console.log(
          `[promote-pending] late-reconciled Intercom ${row.intercom_conversation_id} to Gmail thread ${threadId}`,
        );
        continue;
      }

      // Also re-check if a manual or Slack mapping appeared while we waited
      const [m1, m2] = await Promise.all([
        supabase
          .from("manual_conversations")
          .select("id")
          .eq("intercom_conversation_id", row.intercom_conversation_id)
          .maybeSingle(),
        supabase
          .from("conversation_mappings")
          .select("id")
          .eq("intercom_conversation_id", row.intercom_conversation_id)
          .maybeSingle(),
      ]);

      if (m1.data || m2.data) {
        await supabase.from("pending_intercom_links").delete().eq("id", row.id);
        droppedDuplicate++;
        console.log(
          `[promote-pending] Intercom ${row.intercom_conversation_id} already tracked elsewhere, dropping pending row`,
        );
        continue;
      }

      // Promote: create manual_conversations + manual_messages
      const payload = row.source_payload || {};
      const preMessages = Array.isArray(row.pre_messages) ? row.pre_messages : [];
      const conversationCreatedAt =
        preMessages.length > 0
          ? preMessages[0].created_at
          : row.intercom_created_at;

      const insertPayload: Record<string, unknown> = {
        source: "intercom",
        contact_name: row.contact_name || "",
        subject: payload.subject || "(no subject)",
        link: payload.link || null,
        intercom_conversation_id: row.intercom_conversation_id,
        status: "active",
        created_at: conversationCreatedAt,
      };
      if (row.resolved_owner) insertPayload.owner = row.resolved_owner;
      // Carry through Intercom custom-attribute mappings stashed by intercom-webhook
      if (typeof payload.product_area === "string" && payload.product_area.trim()) {
        insertPayload.product_area = payload.product_area.trim();
      }
      if (typeof payload.classification === "string" && payload.classification.trim()) {
        insertPayload.classification = payload.classification.trim();
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("manual_conversations")
        .upsert(insertPayload, { onConflict: "intercom_conversation_id" })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        errors.push({ id: row.id, message: insertErr?.message || "insert returned no id" });
        await supabase
          .from("pending_intercom_links")
          .update({ attempts: (row.attempts || 0) + 1, last_attempt_at: new Date().toISOString() })
          .eq("id", row.id);
        continue;
      }

      if (preMessages.length > 0) {
        const messages = preMessages.map((m: any) => ({ ...m, conversation_id: inserted.id }));
        const { error: msgErr } = await supabase.from("manual_messages").insert(messages);
        if (msgErr) console.error("[promote-pending] message insert error", msgErr);
      }

      await supabase.from("pending_intercom_links").delete().eq("id", row.id);
      promoted++;
      console.log(
        `[promote-pending-ok] Intercom ${row.intercom_conversation_id} -> manual ${inserted.id} (${preMessages.length} messages)`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ id: row.id, message });
      console.error("[promote-pending] row error", row.id, message);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, candidates: stale.length, promoted, droppedDuplicate, errors }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
