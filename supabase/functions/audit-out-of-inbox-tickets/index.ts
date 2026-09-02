import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Mismatch {
  table: "manual_conversations" | "gmail_conversations" | "conversation_mappings";
  id: string;
  intercomId: string;
  currentTeamId: string;
  subject: string;
  contact: string;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let apply = false;
  let batchSize = 100;
  let offset = 0;
  try {
    const body = await req.json();
    apply = body?.apply === true;
    if (typeof body?.batchSize === "number") batchSize = Math.min(300, Math.max(1, body.batchSize));
    if (typeof body?.offset === "number") offset = Math.max(0, body.offset);
  } catch {}

  const { data: settings } = await sb.from("settings").select("intercom_inbox_id").limit(1).single();
  const enterpriseInboxId = String(settings?.intercom_inbox_id || "");
  if (!enterpriseInboxId) {
    return new Response(JSON.stringify({ error: "No enterprise inbox configured" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pull a unified list of rows to check across the 3 tables
  type Row = { table: Mismatch["table"]; id: string; intercomId: string; subject: string; contact: string; created_at: string };
  const collected: Row[] = [];

  const [mc, gm, cm] = await Promise.all([
    sb.from("manual_conversations")
      .select("id, intercom_conversation_id, subject, contact_name, created_at")
      .not("intercom_conversation_id", "is", null)
      .eq("is_test", false)
      .order("created_at", { ascending: true }),
    sb.from("gmail_conversations")
      .select("id, intercom_conversation_id, subject, from_email, created_at")
      .not("intercom_conversation_id", "is", null)
      .eq("is_test", false)
      .order("created_at", { ascending: true }),
    sb.from("conversation_mappings")
      .select("id, intercom_conversation_id, original_message_text, slack_user_name, created_at")
      .not("intercom_conversation_id", "is", null)
      .eq("is_test", false)
      .order("created_at", { ascending: true }),
  ]);

  for (const r of mc.data || []) collected.push({ table: "manual_conversations", id: r.id, intercomId: r.intercom_conversation_id!, subject: r.subject || "", contact: r.contact_name || "", created_at: r.created_at });
  for (const r of gm.data || []) collected.push({ table: "gmail_conversations", id: r.id, intercomId: r.intercom_conversation_id!, subject: r.subject || "", contact: r.from_email || "", created_at: r.created_at });
  for (const r of cm.data || []) collected.push({ table: "conversation_mappings", id: r.id, intercomId: r.intercom_conversation_id!, subject: (r.original_message_text || "").slice(0, 120), contact: r.slack_user_name || "", created_at: r.created_at });

  const total = collected.length;
  const slice = collected.slice(offset, offset + batchSize);

  const mismatches: Mismatch[] = [];
  let checked = 0;
  let inInbox = 0;
  let notFound = 0;
  let apiErrors = 0;

  for (const row of slice) {
    checked++;
    try {
      const res = await fetch(`https://api.intercom.io/conversations/${row.intercomId}`, {
        headers: { Authorization: `Bearer ${INTERCOM_API_TOKEN}`, Accept: "application/json", "Intercom-Version": "2.13" },
      });
      if (res.status === 404) {
        notFound++;
        mismatches.push({ ...row, currentTeamId: "deleted" });
      } else if (!res.ok) {
        apiErrors++;
      } else {
        const data = await res.json();
        const currentTeamId = String(data.team_assignee_id || "");
        if (currentTeamId === enterpriseInboxId) {
          inInbox++;
        } else {
          mismatches.push({ ...row, currentTeamId });
        }
      }
    } catch (e) {
      apiErrors++;
      console.error("audit error", row.intercomId, e);
    }
    await new Promise(r => setTimeout(r, 80));
  }

  let flagged = 0;
  const affectedMonths = new Set<string>();
  if (apply && mismatches.length > 0) {
    for (const m of mismatches) {
      const { error: upErr } = await sb.from(m.table).update({ is_test: true }).eq("id", m.id);
      if (upErr) {
        console.error("flag failed", m.table, m.id, upErr);
        continue;
      }
      flagged++;
      if (m.created_at) {
        const d = new Date(m.created_at);
        if (!isNaN(d.getTime())) {
          affectedMonths.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
        }
      }
      await sb.from("conversation_audit_logs").insert({
        conversation_id: m.id,
        conversation_source: m.table === "manual_conversations" ? "manual" : m.table === "gmail_conversations" ? "gmail" : "slack",
        action: "flagged_out_of_inbox",
        old_value: "false",
        new_value: "true",
        performed_by: "audit-out-of-inbox-tickets",
      });
    }
  }

  const purgedMonths: string[] = [];
  if (apply && affectedMonths.size > 0) {
    const months = Array.from(affectedMonths);
    const { error: delErr, data: del } = await sb
      .from("monthly_insights")
      .delete()
      .eq("source", "intercom")
      .in("month", months)
      .select("month");
    if (delErr) {
      console.error("purge insights failed", delErr);
    } else {
      for (const r of del || []) purgedMonths.push(r.month);
    }
  }

  const nextOffset = offset + slice.length;
  const done = nextOffset >= total;

  return new Response(JSON.stringify({
    ok: true,
    apply,
    enterpriseInboxId,
    total,
    offset,
    nextOffset,
    done,
    checked,
    inInbox,
    notFound,
    apiErrors,
    mismatchCount: mismatches.length,
    flagged,
    purgedMonths,
    mismatches: mismatches.slice(0, 200),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
