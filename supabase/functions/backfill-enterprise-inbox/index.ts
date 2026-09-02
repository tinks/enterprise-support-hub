import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isFilterSafeEmail } from "../_shared/safe-email.ts";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: settings } = await supabase.from("settings").select("*").limit(1).single();
  if (!settings?.intercom_inbox_id) {
    return new Response(JSON.stringify({ error: "No enterprise inbox ID configured" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const enterpriseInboxId = settings.intercom_inbox_id;

  let adminOwnerMap: Record<string, string> = {};
  try { adminOwnerMap = JSON.parse(settings.admin_owner_map || "{}"); } catch { /* ignore */ }

  // Body: { startingAfter?: string, maxBatch?: number, createdAfter?: number, createdBefore?: number }
  let body: { startingAfter?: string; maxBatch?: number; createdAfter?: number; createdBefore?: number } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const maxBatch = Math.min(body.maxBatch ?? 25, 50); // process up to N convs per call
  const createdAfter = body.createdAfter;
  const createdBefore = body.createdBefore;

  const results: Array<{ id: string; action: string }> = [];
  let nextStartingAfter: string | null = body.startingAfter ?? null;
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  const startTime = Date.now();
  const TIME_BUDGET_MS = 120_000; // leave headroom under 150s

  while (processed < maxBatch) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break;

    const queryClauses: Array<Record<string, unknown>> = [
      { field: "team_assignee_id", operator: "=", value: parseInt(enterpriseInboxId) },
    ];
    if (typeof createdAfter === "number") {
      queryClauses.push({ field: "created_at", operator: ">", value: createdAfter });
    }
    if (typeof createdBefore === "number") {
      queryClauses.push({ field: "created_at", operator: "<", value: createdBefore });
    }
    const searchBody: Record<string, unknown> = {
      query: queryClauses.length === 1 ? queryClauses[0] : { operator: "AND", value: queryClauses },
      pagination: { per_page: 25 },
    };
    if (nextStartingAfter) {
      (searchBody.pagination as Record<string, unknown>).starting_after = nextStartingAfter;
    }

    const searchRes = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Intercom-Version": "2.13",
      },
      body: JSON.stringify(searchBody),
    });

    if (!searchRes.ok) {
      const t = await searchRes.text();
      console.error("Search failed:", searchRes.status, t);
      break;
    }

    const searchData = await searchRes.json();
    const convs = searchData.conversations || [];
    const pages = searchData.pages;
    const newCursor = pages?.next?.starting_after || null;

    for (const conv of convs) {
      if (processed >= maxBatch || Date.now() - startTime > TIME_BUDGET_MS) break;
      processed++;

      const intercomConvId = String(conv.id);

      // Already tracked anywhere?
      const [d1, d2, d3] = await Promise.all([
        supabase.from("manual_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("conversation_mappings").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("gmail_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
      ]);
      if (d1.data || d2.data || d3.data) {
        skipped++;
        results.push({ id: intercomConvId, action: "already_tracked" });
        continue;
      }

      // Fetch full conversation
      const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.13",
        },
      });
      if (!icRes.ok) {
        results.push({ id: intercomConvId, action: "fetch_failed" });
        continue;
      }
      const icData = await icRes.json();

      // Strict guard: still in enterprise inbox?
      const convTeamId = String(icData.team_assignee_id || "");
      if (convTeamId !== String(enterpriseInboxId)) {
        skipped++;
        results.push({ id: intercomConvId, action: "skipped_wrong_inbox" });
        continue;
      }

      // Contact
      let contactName = "";
      let contactEmail = "";
      const sourceContact = icData.source?.author;
      if (sourceContact) {
        contactName = sourceContact.name || sourceContact.email || "";
        contactEmail = sourceContact.email || "";
      }
      if (!contactEmail && icData.contacts?.contacts?.length > 0) {
        const contactId = icData.contacts.contacts[0].id;
        try {
          const cr = await fetch(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
              "Intercom-Version": "2.13",
            },
          });
          if (cr.ok) {
            const cd = await cr.json();
            contactEmail = cd.email || "";
            if (!contactName) contactName = cd.name || contactEmail;
          }
        } catch { /* ignore */ }
      }

      const adminAssigneeId = String(icData.admin_assignee_id || "");
      const resolvedOwner = adminOwnerMap[adminAssigneeId] || null;

      // Try linking to gmail first
      if (contactEmail && isFilterSafeEmail(contactEmail)) {
        const emailLower = contactEmail.toLowerCase();
        const { data: gmailMatches } = await supabase
          .from("gmail_conversations")
          .select("id, gmail_thread_id")
          .is("intercom_conversation_id", null)
          .or(`from_email.ilike.%${emailLower}%,to_emails.ilike.%${emailLower}%,cc_emails.ilike.%${emailLower}%`)
          .order("received_at", { ascending: false })
          .limit(10);

        if (gmailMatches && gmailMatches.length > 0) {
          const updatePayload: Record<string, unknown> = { intercom_conversation_id: intercomConvId };
          if (resolvedOwner) updatePayload.owner = resolvedOwner;
          const threadId = gmailMatches[0].gmail_thread_id;
          if (threadId) {
            await supabase.from("gmail_conversations").update(updatePayload).eq("gmail_thread_id", threadId);
          } else {
            await supabase.from("gmail_conversations").update(updatePayload).in("id", gmailMatches.map(r => r.id));
          }
          imported++;
          results.push({ id: intercomConvId, action: "linked_gmail" });
          continue;
        }
      }

      // Build messages
      const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
      const convUrl = `https://app.intercom.com/a/inbox/wq44gprj/inbox/conversation/${intercomConvId}`;
      const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
      const toIso = (ts: number) => new Date(ts * 1000).toISOString();
      const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);
      const preMessages: Array<{ message_text: string; sender_name: string; role: string; created_at: string; is_internal_note: boolean }> = [];

      const src = icData.source;
      if (src?.body) {
        const text = stripHtml(src.body);
        if (text) {
          preMessages.push({
            message_text: text,
            sender_name: src.author?.name || src.author?.email || src.author?.type || "Unknown",
            role: mapRole(src.author?.type || "user"),
            created_at: src.created_at ? toIso(src.created_at) : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString()),
            is_internal_note: false,
          });
        }
      }

      let allParts = icData.conversation_parts?.conversation_parts || [];
      let nextPageUrl = icData.conversation_parts?.pages?.next;
      while (nextPageUrl) {
        const pr = await fetch(nextPageUrl, {
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            Accept: "application/json",
            "Intercom-Version": "2.13",
          },
        });
        if (!pr.ok) break;
        const pd = await pr.json();
        allParts = [...allParts, ...(pd.conversation_parts || [])];
        nextPageUrl = pd.pages?.next;
      }

      for (const part of allParts) {
        if (!part.body) continue;
        if (SKIP_PART_TYPES.has(part.part_type)) continue;
        if (part.author?.type === "bot") continue;
        const text = stripHtml(part.body);
        if (!text) continue;
        preMessages.push({
          message_text: text,
          sender_name: part.author?.name || part.author?.email || part.author?.type || "Unknown",
          role: mapRole(part.author?.type || "admin"),
          created_at: part.created_at ? toIso(part.created_at) : new Date().toISOString(),
          is_internal_note: part.part_type === "note",
        });
      }

      preMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const conversationCreatedAt = preMessages.length > 0
        ? preMessages[0].created_at
        : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString());

      const isClosed = icData.state === "closed" || icData.open === false;
      const insertPayload: Record<string, unknown> = {
        source: "intercom",
        contact_name: contactName,
        subject,
        link: convUrl,
        intercom_conversation_id: intercomConvId,
        status: isClosed ? "resolved" : "active",
        created_at: conversationCreatedAt,
      };
      if (isClosed) insertPayload.resolved_at = new Date().toISOString();
      if (resolvedOwner) insertPayload.owner = resolvedOwner;

      const { data: inserted, error: insertErr } = await supabase
        .from("manual_conversations")
        .upsert(insertPayload, { onConflict: "intercom_conversation_id" })
        .select("id")
        .single();

      if (insertErr) {
        console.error(`Insert error for ${intercomConvId}:`, insertErr);
        results.push({ id: intercomConvId, action: "insert_failed" });
        continue;
      }

      if (preMessages.length > 0) {
        const messages = preMessages.map(m => ({ ...m, conversation_id: inserted.id }));
        await supabase.from("manual_messages").insert(messages);
      }

      imported++;
      results.push({ id: intercomConvId, action: "imported" });
    }

    nextStartingAfter = newCursor;
    if (!nextStartingAfter) break;
  }

  return new Response(JSON.stringify({
    ok: true,
    processed,
    imported,
    skipped,
    nextStartingAfter,
    done: !nextStartingAfter,
    results,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
