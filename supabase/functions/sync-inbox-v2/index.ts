import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { classifyHttpStatus, recordIntegrationHealth } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// Mirrors extractIntercomCustomFields from poll-intercom-inbox, but for the
// sandbox table we DO allow nulling out values — this table is a faithful
// mirror of Intercom, so drift IS the signal.
function extractFields(icData: any): { product_area: string | null; classification: string | null } {
  const ca = icData?.custom_attributes || {};
  const pa = typeof ca["Affected Product Area"] === "string" ? ca["Affected Product Area"].trim() : "";
  const tt = typeof ca["Ticket type"] === "string" ? ca["Ticket type"].trim() : "";
  return {
    product_area: pa || null,
    classification: tt || null,
  };
}

// Extract Intercom conversation tag names. Overwrites on every sync (drift is the signal).
function extractTags(icData: any): string[] {
  const arr = icData?.tags?.tags;
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const t of arr) {
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    if (name) out.push(name);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { windowHours?: number; full?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const windowHours = body.full ? 24 * 30 : (typeof body.windowHours === "number" ? body.windowHours : 24);

  const { data: settings } = await supabase.from("settings").select("*").limit(1).single();
  if (!settings?.intercom_inbox_id) {
    return new Response(JSON.stringify({ error: "No enterprise inbox configured" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const enterpriseInboxId = settings.intercom_inbox_id;

  let adminOwnerMap: Record<string, string> = {};
  try { adminOwnerMap = JSON.parse(settings.admin_owner_map || "{}"); } catch { /* ignore */ }

  const sinceTs = Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 1000);
  console.log(`[sync-inbox-v2] window=${windowHours}h since=${new Date(sinceTs * 1000).toISOString()}`);

  // Single search query: all conversations in the enterprise inbox updated since cutoff.
  const searchBody = {
    query: {
      operator: "AND",
      value: [
        { field: "team_assignee_id", operator: "=", value: parseInt(enterpriseInboxId) },
        { field: "updated_at", operator: ">", value: sinceTs },
      ],
    },
    pagination: { per_page: 50 },
  };

  const MAX_PAGES = 40; // 2000 conversations cap
  const conversations: any[] = [];
  let startingAfter: string | null = null;
  let page = 0;

  while (page < MAX_PAGES) {
    const reqBody: any = { ...searchBody };
    if (startingAfter) reqBody.pagination = { per_page: 50, starting_after: startingAfter };

    const res = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Intercom-Version": "2.13",
      },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[sync-inbox-v2] search failed ${res.status}:`, text.slice(0, 200));
      await recordIntegrationHealth(supabase, "inbox_v2_sync", classifyHttpStatus(res.status), `search ${res.status}: ${text.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: "Intercom search failed", status: res.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();
    const list = data.conversations || data.data || [];
    for (const c of list) conversations.push(c);

    page++;
    const next = data.pages?.next?.starting_after;
    if (!next) break;
    startingAfter = next;
  }

  console.log(`[sync-inbox-v2] fetched ${conversations.length} conversations`);

  let inserted = 0, updated = 0, failed = 0;

  for (const conv of conversations) {
    const intercomConvId = String(conv.id);
    try {
      // Fetch full conversation for custom_attributes + source
      const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.13",
        },
      });
      if (!icRes.ok) { failed++; continue; }
      const icData = await icRes.json();

      // Inbox membership guard
      if (String(icData.team_assignee_id || "") !== String(enterpriseInboxId)) continue;

      // Contact
      let contactName = "";
      let contactEmail = "";
      const sa = icData.source?.author;
      if (sa) { contactName = sa.name || sa.email || ""; contactEmail = sa.email || ""; }
      if (!contactEmail && icData.contacts?.contacts?.length > 0) {
        const cid = icData.contacts.contacts[0].id;
        try {
          const cRes = await fetch(`https://api.intercom.io/contacts/${cid}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
              "Intercom-Version": "2.13",
            },
          });
          if (cRes.ok) {
            const cd = await cRes.json();
            contactEmail = cd.email || "";
            if (!contactName) contactName = cd.name || contactEmail;
          }
        } catch { /* ignore */ }
      }

      const adminId = String(icData.admin_assignee_id || conv.admin_assignee_id || "");
      const owner = adminOwnerMap[adminId] || null;
      const { product_area, classification } = extractFields(icData);
      const tags = extractTags(icData);
      const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
      const status = String(icData.state || "open");

      // Customer-submitted CSAT from Intercom's native conversation_rating.
      // Overwrite on every sync (drift IS the signal for this table).
      const cr = icData?.conversation_rating;
      const csat_rating = typeof cr?.rating === "number" ? cr.rating : null;
      const csat_remark = typeof cr?.remark === "string" && cr.remark.trim() ? cr.remark.trim() : null;
      const csat_rated_at = typeof cr?.created_at === "number"
        ? new Date(cr.created_at * 1000).toISOString()
        : null;

      const row = {
        intercom_conversation_id: intercomConvId,
        subject,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        owner,
        product_area,
        classification,
        tags,
        status,
        csat_rating,
        csat_remark,
        csat_rated_at,
        intercom_created_at: icData.created_at ? new Date(icData.created_at * 1000).toISOString() : null,
        intercom_updated_at: icData.updated_at ? new Date(icData.updated_at * 1000).toISOString() : null,
        last_synced_at: new Date().toISOString(),
        raw_payload: icData,
      };

      // Check existence to count insert vs update
      const { data: existing } = await supabase
        .from("inbox_v2_tickets")
        .select("id")
        .eq("intercom_conversation_id", intercomConvId)
        .maybeSingle();

      const { error } = await supabase
        .from("inbox_v2_tickets")
        .upsert(row, { onConflict: "intercom_conversation_id" });

      if (error) { console.error(`upsert failed for ${intercomConvId}:`, error.message); failed++; continue; }
      if (existing) updated++; else inserted++;
    } catch (e) {
      console.error(`[sync-inbox-v2] error on ${intercomConvId}:`, (e as Error).message);
      failed++;
    }
  }

  await recordIntegrationHealth(supabase, "inbox_v2_sync", "ok");

  return new Response(JSON.stringify({
    ok: true,
    windowHours,
    fetched: conversations.length,
    inserted,
    updated,
    failed,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
