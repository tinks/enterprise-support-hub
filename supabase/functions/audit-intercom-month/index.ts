import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);
const mapRole = (t: string) => (t === "user" || t === "lead") ? "user" : "admin";
const toIso = (ts: number) => new Date(ts * 1000).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    // Public ops endpoint (no auth) — verify_jwt = false in config.toml

    const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
    if (!INTERCOM_API_TOKEN) {
      return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const start: string = body.start || "2026-04-01";
    const end: string = body.end || "2026-05-01";
    const dryRun: boolean = body.dryRun !== false && !body.import;
    const owner: string | null = body.owner || null;
    const maxImports: number = body.maxImports || 200;

    const startTs = Math.floor(new Date(start + "T00:00:00Z").getTime() / 1000);
    const endTs = Math.floor(new Date(end + "T00:00:00Z").getTime() / 1000);

    // 1) Page through all Intercom conversations created in window
    const intercomIds = new Set<string>();
    let startingAfter: string | null = null;
    let pages = 0;
    while (true) {
      pages++;
      const searchBody: Record<string, unknown> = {
        query: {
          operator: "AND",
          value: [
            { field: "created_at", operator: ">", value: startTs },
            { field: "created_at", operator: "<", value: endTs },
          ],
        },
        pagination: { per_page: 150, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      };
      const r = await fetch("https://api.intercom.io/conversations/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${INTERCOM_API_TOKEN}`, "Content-Type": "application/json", Accept: "application/json", "Intercom-Version": "2.13" },
        body: JSON.stringify(searchBody),
      });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: `Intercom search failed (${r.status}): ${t}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await r.json();
      for (const c of (data.conversations || [])) intercomIds.add(String(c.id));
      const next = data.pages?.next?.starting_after || null;
      if (!next || pages > 200) break;
      startingAfter = next;
    }

    const allIds = Array.from(intercomIds);

    // 2) Look up tracked IDs
    const trackedManual = new Set<string>();
    const trackedGmail = new Set<string>();
    const trackedSlack = new Set<string>();
    const trackedPending = new Set<string>();
    const chunk = <T,>(arr: T[], size: number) => {
      const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out;
    };
    for (const ids of chunk(allIds, 500)) {
      const [m, g, s, p] = await Promise.all([
        sb.from("manual_conversations").select("intercom_conversation_id").in("intercom_conversation_id", ids),
        sb.from("gmail_conversations").select("intercom_conversation_id").in("intercom_conversation_id", ids),
        sb.from("conversation_mappings").select("intercom_conversation_id").in("intercom_conversation_id", ids),
        sb.from("pending_intercom_links").select("intercom_conversation_id").in("intercom_conversation_id", ids),
      ]);
      m.data?.forEach((r: { intercom_conversation_id: string }) => trackedManual.add(r.intercom_conversation_id));
      g.data?.forEach((r: { intercom_conversation_id: string }) => trackedGmail.add(r.intercom_conversation_id));
      s.data?.forEach((r: { intercom_conversation_id: string }) => trackedSlack.add(r.intercom_conversation_id));
      p.data?.forEach((r: { intercom_conversation_id: string }) => trackedPending.add(r.intercom_conversation_id));
    }

    const trackedAll = new Set<string>([...trackedManual, ...trackedGmail, ...trackedSlack, ...trackedPending]);
    const missingIds = allIds.filter(id => !trackedAll.has(id));

    if (dryRun) {
      return new Response(JSON.stringify({
        window: { start, end },
        totalIntercom: allIds.length,
        tracked: { manual: trackedManual.size, gmail: trackedGmail.size, slack: trackedSlack.size, pending: trackedPending.size, unique: trackedAll.size },
        missingCount: missingIds.length,
        sampleMissing: missingIds.slice(0, 30),
        intercomPages: pages,
      }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Backfill missing into manual_conversations (cap at maxImports)
    const toImport = missingIds.slice(0, maxImports);
    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const intercomConvId of toImport) {
      try {
        const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
          headers: { Authorization: `Bearer ${INTERCOM_API_TOKEN}`, Accept: "application/json", "Intercom-Version": "2.13" },
        });
        if (!icRes.ok) { results.push({ id: intercomConvId, status: "failed", error: `API ${icRes.status}` }); await new Promise(r => setTimeout(r, 200)); continue; }
        const icData = await icRes.json();

        const sourceContact = icData.source?.author;
        const contactName = sourceContact ? (sourceContact.name || sourceContact.email || "") : "";
        const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
        const icState = icData.state || "open";
        const appStatus = icState === "closed" ? "resolved" : "active";

        const messages: Array<{ message_text: string; sender_name: string; role: string; created_at: string; is_internal_note: boolean }> = [];
        const src = icData.source;
        if (src?.body) {
          const text = stripHtml(src.body);
          if (text) messages.push({
            message_text: text,
            sender_name: src.author?.name || src.author?.email || src.author?.type || "Unknown",
            role: mapRole(src.author?.type || "user"),
            created_at: src.created_at ? toIso(src.created_at) : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString()),
            is_internal_note: false,
          });
        }
        let allParts = icData.conversation_parts?.conversation_parts || [];
        let nextUrl = icData.conversation_parts?.pages?.next;
        while (nextUrl) {
          const pr = await fetch(nextUrl, { headers: { Authorization: `Bearer ${INTERCOM_API_TOKEN}`, Accept: "application/json", "Intercom-Version": "2.13" } });
          if (!pr.ok) break;
          const pd = await pr.json();
          allParts = [...allParts, ...(pd.conversation_parts || [])];
          nextUrl = pd.pages?.next;
        }
        for (const part of allParts) {
          if (!part.body) continue;
          if (SKIP_PART_TYPES.has(part.part_type)) continue;
          if (part.author?.type === "bot") continue;
          const text = stripHtml(part.body);
          if (!text) continue;
          messages.push({
            message_text: text,
            sender_name: part.author?.name || part.author?.email || part.author?.type || "Unknown",
            role: mapRole(part.author?.type || "admin"),
            created_at: part.created_at ? toIso(part.created_at) : new Date().toISOString(),
            is_internal_note: part.part_type === "note",
          });
        }
        messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const conversationCreatedAt = messages.length > 0 ? messages[0].created_at : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString());

        const rating = icData.conversation_rating;
        const csatFields: Record<string, unknown> = rating && typeof rating.rating === "number"
          ? { csat_rating: rating.rating, csat_remark: rating.remark || null, csat_rated_at: rating.created_at ? toIso(rating.created_at) : null }
          : {};

        const { data: inserted, error: insertErr } = await sb.from("manual_conversations").insert({
          source: "intercom",
          contact_name: contactName,
          subject,
          link: `https://app.intercom.com/a/apps/teb21d17/inbox/inbox/conversation/${intercomConvId}`,
          intercom_conversation_id: String(intercomConvId),
          status: appStatus,
          owner,
          resolved_at: appStatus === "resolved" ? new Date().toISOString() : null,
          created_at: conversationCreatedAt,
          ...csatFields,
        }).select("id").single();

        if (insertErr) { results.push({ id: intercomConvId, status: "failed", error: insertErr.message }); continue; }
        if (messages.length > 0) {
          await sb.from("manual_messages").insert(messages.map(m => ({ ...m, conversation_id: inserted.id })));
        }
        results.push({ id: intercomConvId, status: "imported" });
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        results.push({ id: intercomConvId, status: "failed", error: String(err) });
      }
    }

    const imported = results.filter(r => r.status === "imported").length;
    const failed = results.filter(r => r.status === "failed").length;

    return new Response(JSON.stringify({
      window: { start, end },
      totalIntercom: allIds.length,
      missingBefore: missingIds.length,
      attempted: toImport.length,
      imported, failed,
      remaining: Math.max(0, missingIds.length - imported),
      results: results.slice(0, 50),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("audit-intercom-month error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
