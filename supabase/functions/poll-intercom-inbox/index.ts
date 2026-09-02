import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isFilterSafeEmail } from "../_shared/safe-email.ts";
import { recordIntegrationHealth, classifyHttpStatus } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

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

// Extracts Intercom custom attributes "Affected Product Area" → product_area
// and "Ticket type" → classification. Empty/missing values are omitted so we
// never overwrite an existing value with blank.
function extractIntercomCustomFields(icData: any): { product_area?: string; classification?: string } {
  const ca = icData?.custom_attributes || {};
  const out: { product_area?: string; classification?: string } = {};
  const pa = typeof ca["Affected Product Area"] === "string" ? ca["Affected Product Area"].trim() : "";
  const tt = typeof ca["Ticket type"] === "string" ? ca["Ticket type"].trim() : "";
  if (pa) out.product_area = pa;
  if (tt) out.classification = tt;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const gate = await requireEditorOrSecret(req, corsHeaders);
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

  // Load settings
  const { data: settings } = await supabase.from("settings").select("*").limit(1).single();
  if (!settings) {
    return new Response(JSON.stringify({ error: "No settings found" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const enterpriseInboxId = settings.intercom_inbox_id;
  if (!enterpriseInboxId) {
    return new Response(JSON.stringify({ error: "No enterprise inbox ID configured" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse admin-to-owner mapping
  let adminOwnerMap: Record<string, string> = {};
  try {
    adminOwnerMap = JSON.parse(settings.admin_owner_map || "{}");
  } catch { /* ignore */ }

  // Use last_polled_intercom_at as lower bound; fall back to 48 hours if null (first run)
  const sinceTs = settings.last_polled_intercom_at
    ? Math.floor(new Date(settings.last_polled_intercom_at).getTime() / 1000)
    : Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
  console.log(`Searching since ${new Date(sinceTs * 1000).toISOString()} (last_polled_intercom_at: ${settings.last_polled_intercom_at || "null, using 48h fallback"})`);

  const results: Array<{ intercomId: string; action: string; id?: string }> = [];

  // Build search queries: one for team_assignee_id + one per admin in admin_owner_map
  // Exclude the bot admin (intercom_assignee_id) from per-admin searches — their
  // conversations reach the inbox via team_assignee_id and searching them causes timeouts
  const botAdminId = settings.intercom_assignee_id || "";
  const adminIds = Object.keys(adminOwnerMap).filter(id => id !== botAdminId);
  console.log(`Admin IDs to search (excluding bot ${botAdminId}): [${adminIds.join(", ")}]`);

  const MAX_PAGES_PER_QUERY = 10; // Safety cap: 500 conversations max per query

  const searchQueries: Array<{ label: string; query: Record<string, unknown> }> = [
    {
      label: `team_assignee_id=${enterpriseInboxId}`,
      query: {
        operator: "AND",
        value: [
          { field: "team_assignee_id", operator: "=", value: parseInt(enterpriseInboxId) },
          { field: "updated_at", operator: ">", value: sinceTs },
        ],
      },
    },
    ...adminIds.map((adminId) => ({
      label: `admin_assignee_id=${adminId}`,
      query: {
        operator: "AND",
        value: [
          { field: "admin_assignee_id", operator: "=", value: parseInt(adminId) },
          { field: "updated_at", operator: ">", value: sinceTs },
        ],
      },
    })),
  ];

  console.log(`Running ${searchQueries.length} search queries (1 team + ${adminIds.length} admins)`);

  // Collect all conversations across all queries, deduplicate by ID
  const seenConvIds = new Set<string>();
  const allConversations: Array<Record<string, unknown>> = [];
  // Track whether any upstream Intercom call failed during this run so we don't
  // overwrite a fresh auth_error/error with "ok" at the end of the function.
  let upstreamFailed = false;
  let lastUpstreamStatus: "auth_error" | "error" | null = null;
  let lastUpstreamError: string | null = null;

  for (const sq of searchQueries) {
    let hasMore = true;
    let startingAfter: string | null = null;

    let pageCount = 0;
    while (hasMore) {
      const searchBody: Record<string, unknown> = {
        query: sq.query,
        pagination: { per_page: 50 },
      };
      if (startingAfter) {
        (searchBody.pagination as Record<string, unknown>).starting_after = startingAfter;
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
        const errText = await searchRes.text();
        console.error(`Intercom search failed for ${sq.label}:`, searchRes.status, errText);
        const classified = classifyHttpStatus(searchRes.status);
        upstreamFailed = true;
        lastUpstreamStatus = classified === "ok" ? lastUpstreamStatus : classified;
        lastUpstreamError = `search ${searchRes.status}: ${errText.slice(0, 200)}`;
        await recordIntegrationHealth(supabase, "intercom_poll", classified, lastUpstreamError);
        // Continue with other queries instead of failing entirely
        break;
      }

      const searchData = await searchRes.json();
      const conversations = searchData.conversations || searchData.data || [];
      console.log(`Fetched ${conversations.length} conversations for ${sq.label}`);

      for (const conv of conversations) {
        const convId = String(conv.id);
        if (!seenConvIds.has(convId)) {
          seenConvIds.add(convId);
          allConversations.push(conv);
        }
      }

      pageCount++;
      const pages = searchData.pages;
      if (pages?.next?.starting_after && pageCount < MAX_PAGES_PER_QUERY) {
        startingAfter = pages.next.starting_after;
      } else {
        if (pageCount >= MAX_PAGES_PER_QUERY && pages?.next?.starting_after) {
          console.log(`Capped pagination for ${sq.label} at ${MAX_PAGES_PER_QUERY} pages`);
        }
        hasMore = false;
      }
    }
  }

  console.log(`Total unique conversations across all queries: ${allConversations.length}`);

    for (const conv of allConversations) {
      const intercomConvId = String(conv.id);

      // Check if already tracked in any table
      const [dup1, dup2, dup3] = await Promise.all([
        supabase.from("conversation_mappings").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("gmail_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("manual_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
      ]);

      if (dup1.data || dup2.data || dup3.data) {
        results.push({ intercomId: intercomConvId, action: "already_tracked" });
        continue;
      }

      // Not tracked — fetch full conversation
      const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.13",
        },
      });

      if (!icRes.ok) {
        console.error(`Failed to fetch conversation ${intercomConvId}:`, icRes.status);
        results.push({ intercomId: intercomConvId, action: "fetch_failed" });
        continue;
      }

      const icData = await icRes.json();

      // STRICT INBOX MEMBERSHIP GUARD: only import if currently in enterprise inbox.
      // Search queries can return conversations that touched the inbox historically
      // or are assigned to Sam (AI agent) but live in other inboxes.
      const convTeamId = String(icData.team_assignee_id || "");
      if (convTeamId !== String(enterpriseInboxId)) {
        console.log(`Skipping ${intercomConvId}: team_assignee_id=${convTeamId} != ${enterpriseInboxId}`);
        results.push({ intercomId: intercomConvId, action: "skipped_wrong_inbox" });
        continue;
      }

      // Extract contact name and email
      let contactName = "";
      let contactEmail = "";
      const sourceContact = icData.source?.author;
      if (sourceContact) {
        contactName = sourceContact.name || sourceContact.email || "";
        contactEmail = sourceContact.email || "";
      }

      // If no email from source, try fetching the contact
      if (!contactEmail && icData.contacts?.contacts?.length > 0) {
        const contactId = icData.contacts.contacts[0].id;
        try {
          const contactRes = await fetch(`https://api.intercom.io/contacts/${contactId}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
              "Intercom-Version": "2.13",
            },
          });
          if (contactRes.ok) {
            const contactData = await contactRes.json();
            contactEmail = contactData.email || "";
            if (!contactName) contactName = contactData.name || contactEmail;
          }
        } catch (e) {
          console.log("Failed to fetch contact email:", e);
        }
      }

      // Resolve owner from admin_assignee_id
      const adminAssigneeId = String(conv.admin_assignee_id || icData.admin_assignee_id || "");
      const resolvedOwner = adminOwnerMap[adminAssigneeId] || null;

      const customFields = extractIntercomCustomFields(icData);

      // Cross-reference with gmail_conversations
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
          const updatePayload: Record<string, unknown> = { intercom_conversation_id: intercomConvId, ...customFields };
          if (resolvedOwner) updatePayload.owner = resolvedOwner;

          const threadId = gmailMatches[0].gmail_thread_id;
          if (threadId) {
            await supabase.from("gmail_conversations").update(updatePayload).eq("gmail_thread_id", threadId);
            console.log(`Linked Intercom ${intercomConvId} to Gmail thread ${threadId}`);
          } else {
            const ids = gmailMatches.map(r => r.id);
            await supabase.from("gmail_conversations").update(updatePayload).in("id", ids);
            console.log(`Linked Intercom ${intercomConvId} to ${ids.length} Gmail rows`);
          }
          results.push({ intercomId: intercomConvId, action: "linked_gmail" });
          continue;
        }
      }

      // No Gmail match — create manual_conversations entry
      const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
      const convUrl = `https://app.intercom.com/a/inbox/wq44gprj/inbox/conversation/${intercomConvId}`;

      const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
      const toIso = (ts: number) => new Date(ts * 1000).toISOString();
      const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);

      const preMessages: Array<{ message_text: string; sender_name: string; role: string; created_at: string; is_internal_note: boolean }> = [];

      // Source message
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

      // Paginate conversation parts
      let allParts = icData.conversation_parts?.conversation_parts || [];
      let nextPageUrl = icData.conversation_parts?.pages?.next;

      while (nextPageUrl) {
        const pageRes = await fetch(nextPageUrl, {
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            Accept: "application/json",
            "Intercom-Version": "2.13",
          },
        });
        if (!pageRes.ok) break;
        const pageData = await pageRes.json();
        allParts = [...allParts, ...(pageData.conversation_parts || [])];
        nextPageUrl = pageData.pages?.next;
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

      const insertPayload: Record<string, unknown> = {
        source: "intercom",
        contact_name: contactName,
        subject,
        link: convUrl,
        intercom_conversation_id: intercomConvId,
        status: "active",
        created_at: conversationCreatedAt,
        ...customFields,
      };
      if (resolvedOwner) insertPayload.owner = resolvedOwner;

      const { data: inserted, error: insertErr } = await supabase
        .from("manual_conversations")
        .upsert(insertPayload, { onConflict: "intercom_conversation_id" })
        .select("id")
        .single();

      if (insertErr) {
        console.error(`Insert error for ${intercomConvId}:`, insertErr);
        results.push({ intercomId: intercomConvId, action: "insert_failed" });
        continue;
      }

      // Insert messages with idempotency dedup against existing rows for this conversation.
      // Guards against poll/webhook races inserting the same message twice.
      const messages = preMessages.map(m => ({ ...m, conversation_id: inserted.id }));
      if (messages.length > 0) {
        const { data: existingMsgs } = await supabase
          .from("manual_messages")
          .select("role, message_text, created_at")
          .eq("conversation_id", inserted.id);

        const seenKeys = new Set<string>(
          (existingMsgs || []).map(m =>
            `${m.role}|${Math.floor(new Date(m.created_at).getTime() / 1000)}|${m.message_text}`
          )
        );

        const fresh = messages.filter(m => {
          const key = `${m.role}|${Math.floor(new Date(m.created_at).getTime() / 1000)}|${m.message_text}`;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });

        if (fresh.length > 0) {
          const { error: msgErr } = await supabase.from("manual_messages").insert(fresh);
          if (msgErr) console.error(`Messages insert error for ${intercomConvId}:`, msgErr);
        }
        console.log(`Poll dedup for ${intercomConvId}: ${messages.length} extracted, ${fresh.length} new, ${messages.length - fresh.length} skipped`);
      }

      console.log(`Imported Intercom ${intercomConvId} as ${inserted.id} with ${messages.length} messages`);
      results.push({ intercomId: intercomConvId, action: "imported", id: inserted.id });
    }

  // Update last_polled_intercom_at
  await supabase.from("settings").update({ last_polled_intercom_at: new Date().toISOString() }).eq("id", settings.id);
  // Only mark intercom_poll healthy if every upstream Intercom call succeeded.
  // Otherwise the auth_error/error recorded mid-run would be overwritten and
  // the Settings → Integration health card would falsely show "Healthy".
  if (!upstreamFailed) {
    await recordIntegrationHealth(supabase, "intercom_poll", "ok");
  } else if (lastUpstreamStatus) {
    await recordIntegrationHealth(supabase, "intercom_poll", lastUpstreamStatus, lastUpstreamError);
  }


  const imported = results.filter(r => r.action === "imported").length;
  const linkedGmail = results.filter(r => r.action === "linked_gmail").length;
  const alreadyTracked = results.filter(r => r.action === "already_tracked").length;
  const skippedWrongInbox = results.filter(r => r.action === "skipped_wrong_inbox").length;

  console.log(`Poll complete: ${imported} imported, ${linkedGmail} linked to Gmail, ${alreadyTracked} already tracked, ${skippedWrongInbox} skipped (wrong inbox)`);

  return new Response(JSON.stringify({
    ok: true,
    total: results.length,
    imported,
    linkedGmail,
    alreadyTracked,
    skippedWrongInbox,
    results,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
