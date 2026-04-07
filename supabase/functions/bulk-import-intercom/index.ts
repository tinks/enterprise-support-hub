import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!INTERCOM_API_TOKEN) {
      return new Response(
        JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { ids, owner } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing ids array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results: Array<{ id: string; status: "imported" | "skipped" | "failed"; error?: string; dbId?: string }> = [];

    const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);
    const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
    const toIso = (ts: number) => new Date(ts * 1000).toISOString();

    for (const intercomConvId of ids) {
      try {
        // Check duplicates
        const [dup1, dup2, dup3] = await Promise.all([
          sb.from("manual_conversations").select("id").eq("intercom_conversation_id", String(intercomConvId)).maybeSingle(),
          sb.from("conversation_mappings").select("id").eq("intercom_conversation_id", String(intercomConvId)).maybeSingle(),
          sb.from("gmail_conversations").select("id").eq("intercom_conversation_id", String(intercomConvId)).maybeSingle(),
        ]);

        if (dup1.data || dup2.data || dup3.data) {
          results.push({ id: String(intercomConvId), status: "skipped", dbId: dup1.data?.id || dup2.data?.id || dup3.data?.id });
          continue;
        }

        // Fetch from Intercom
        const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            Accept: "application/json",
            "Intercom-Version": "2.11",
          },
        });

        if (!icRes.ok) {
          const errText = await icRes.text();
          console.error(`Intercom API error for ${intercomConvId}:`, icRes.status, errText);
          results.push({ id: String(intercomConvId), status: "failed", error: `API ${icRes.status}` });
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        const icData = await icRes.json();

        // Extract metadata
        let contactName = "";
        const sourceContact = icData.source?.author;
        if (sourceContact) {
          contactName = sourceContact.name || sourceContact.email || "";
        }
        const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);

        // Determine status
        const icState = icData.state || "open";
        const appStatus = icState === "closed" ? "resolved" : "active";

        // Insert conversation
        const { data: inserted, error: insertErr } = await sb
          .from("manual_conversations")
          .insert({
            source: "intercom",
            contact_name: contactName,
            subject,
            link: `https://app.intercom.com/a/apps/teb21d17/inbox/inbox/conversation/${intercomConvId}`,
            intercom_conversation_id: String(intercomConvId),
            status: appStatus,
            owner: owner || null,
            resolved_at: appStatus === "resolved" ? new Date().toISOString() : null,
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error(`Insert error for ${intercomConvId}:`, insertErr);
          results.push({ id: String(intercomConvId), status: "failed", error: "DB insert failed" });
          continue;
        }

        // Extract messages
        const messages: Array<{ conversation_id: string; message_text: string; sender_name: string; role: string; created_at: string }> = [];

        const src = icData.source;
        if (src?.body) {
          const text = stripHtml(src.body);
          if (text) {
            messages.push({
              conversation_id: inserted.id,
              message_text: text,
              sender_name: src.author?.name || src.author?.email || src.author?.type || "Unknown",
              role: mapRole(src.author?.type || "user"),
              created_at: src.created_at ? toIso(src.created_at) : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString()),
            });
          }
        }

        // Paginate conversation parts
        let allParts = icData.conversation_parts?.conversation_parts || [];
        let nextPageUrl = icData.conversation_parts?.pages?.next;

        while (nextPageUrl) {
          const pageRes = await fetch(nextPageUrl, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
              "Intercom-Version": "2.11",
            },
          });
          if (!pageRes.ok) break;
          const pageData = await pageRes.json();
          allParts = [...allParts, ...(pageData.conversation_parts || [])];
          nextPageUrl = pageData.pages?.next;
        }

        for (const part of allParts) {
          if (!part.body) continue;
          if (part.part_type === "note") continue;
          if (SKIP_PART_TYPES.has(part.part_type) && !part.body) continue;
          if (part.author?.type === "bot") continue;
          const text = stripHtml(part.body);
          if (!text) continue;
          messages.push({
            conversation_id: inserted.id,
            message_text: text,
            sender_name: part.author?.name || part.author?.email || part.author?.type || "Unknown",
            role: mapRole(part.author?.type || "admin"),
            created_at: part.created_at ? toIso(part.created_at) : new Date().toISOString(),
          });
        }

        messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        // Set created_at to earliest message
        const conversationCreatedAt = messages.length > 0
          ? messages[0].created_at
          : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString());

        await sb.from("manual_conversations").update({ created_at: conversationCreatedAt }).eq("id", inserted.id);

        if (messages.length > 0) {
          await sb.from("manual_messages").insert(messages);
        }

        results.push({ id: String(intercomConvId), status: "imported", dbId: inserted.id });

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error processing ${intercomConvId}:`, err);
        results.push({ id: String(intercomConvId), status: "failed", error: String(err) });
      }
    }

    const imported = results.filter(r => r.status === "imported").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const failed = results.filter(r => r.status === "failed").length;

    return new Response(
      JSON.stringify({ results, summary: { imported, skipped, failed, total: ids.length } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
