import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isFilterSafeEmail } from "../_shared/safe-email.ts";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";
import { recordIntegrationHealth, classifyHttpStatus } from "../_shared/integration-health.ts";
import { getSettings } from "../_shared/settings-cache.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature",
};

const SLACK_API_URL = "https://slack.com/api";
const ASSIGNMENT_TOPICS = [
  "conversation.admin.assigned",
  "conversation.admin.open.assigned",
  "ticket.admin.assigned",
  "ticket.team.assigned",
];
const BOT_IDENTITY = {
  username: "Ask Lovable",
  icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
};

const ALERT_CHANNEL_ID = "C0B9NSBM60H"; // #enterprise-support-hub-alerts

// Posts a non-blocking alert to #enterprise-support-hub-alerts. Failures are
// swallowed so guard logic always completes even if Slack is degraded.
async function postGuardAlert(opts: {
  tier: "email" | "subject";
  intercomConvId: string;
  existingThreadId: string;
  attemptedThreadId: string | null;
  contactEmail?: string | null;
}) {
  try {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) return;
    const { tier, intercomConvId, existingThreadId, attemptedThreadId, contactEmail } = opts;
    const text = `:shield: Cross-thread link blocked (${tier} tier) — Intercom \`${intercomConvId}\``;
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: `:shield: *Cross-thread link blocked* — _${tier} tier_` } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Intercom ticket:*\n<https://app.intercom.com/a/inbox/_/inbox/conversation/${intercomConvId}|${intercomConvId}>` },
          { type: "mrkdwn", text: `*Already linked to thread:*\n\`${existingThreadId}\`` },
          { type: "mrkdwn", text: `*Refused new thread:*\n\`${attemptedThreadId || "(orphan rows)"}\`` },
          { type: "mrkdwn", text: `*Contact:*\n${contactEmail || "_unknown_"}` },
        ],
      },
      { type: "context", elements: [{ type: "mrkdwn", text: `Guard fired at ${new Date().toISOString()}` }] },
    ];
    await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel: ALERT_CHANNEL_ID,
        text,
        blocks,
        username: "Support Hub Guard",
        icon_emoji: ":shield:",
      }),
    });
  } catch (err) {
    console.error("postGuardAlert failed:", err);
  }
}

// Extracts Intercom custom attributes "Affected Product Area" → product_area
// and "Ticket type" → classification. Empty/missing values are omitted so we
// never overwrite an existing value with blank on upsert/update.
function extractIntercomCustomFields(icData: any): { product_area?: string; classification?: string } {
  const ca = icData?.custom_attributes || {};
  const out: { product_area?: string; classification?: string } = {};
  const pa = typeof ca["Affected Product Area"] === "string" ? ca["Affected Product Area"].trim() : "";
  const tt = typeof ca["Ticket type"] === "string" ? ca["Ticket type"].trim() : "";
  if (pa) out.product_area = pa;
  if (tt) out.classification = tt;
  return out;
}

async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
  try {
    console.log(`Adding reaction ${emoji} to channel=${channel} ts=${timestamp}`);
    const res = await fetch(`${SLACK_API_URL}/reactions.add`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Slack reactions.add failed for ${emoji}:`, data.error);
    }
  } catch (e) {
    console.error(`Failed to add reaction ${emoji}:`, e);
  }
}

async function removeReaction(token: string, channel: string, timestamp: string, emoji: string) {
  try {
    const res = await fetch(`${SLACK_API_URL}/reactions.remove`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok && data.error !== "no_reaction") {
      console.error(`Slack reactions.remove failed for ${emoji}:`, data.error);
    }
  } catch (e) {
    console.error(`Failed to remove reaction ${emoji}:`, e);
  }
}

async function verifyIntercomSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const expected = signature.replace("sha1=", "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = new TextDecoder().decode(hexEncode(new Uint8Array(sig)));
  return computed === expected;
}

// Records a delivery that failed AFTER we already answered Intercom 200, so the
// event is recoverable by hand instead of silently lost. Never throws.
// deno-lint-ignore no-explicit-any
async function recordWebhookFailure(supabase: any, rawBody: string, errorMessage: string) {
  let payload: unknown = { raw: rawBody.slice(0, 20000) };
  let topic: string | null = null;
  let convId: string | null = null;
  try {
    const parsed = JSON.parse(rawBody);
    payload = parsed;
    topic = parsed?.topic ?? null;
    const id = parsed?.data?.item?.id ?? parsed?.data?.item?.ticket?.id;
    convId = id ? String(id) : null;
  } catch { /* keep the raw body */ }

  try {
    await supabase.from("intercom_webhook_failures").insert({
      topic,
      intercom_conversation_id: convId,
      error: errorMessage.slice(0, 2000),
      payload,
    });
  } catch (e) {
    console.error("Failed to write intercom_webhook_failures row:", e);
  }

  try {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) return;
    await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel: ALERT_CHANNEL_ID,
        text: `:shield: Intercom webhook delivery failed — topic \`${topic ?? "unknown"}\`, conversation \`${convId ?? "unknown"}\`: ${errorMessage.slice(0, 300)}`,
        username: "Support Hub Guard",
        icon_emoji: ":shield:",
      }),
    });
  } catch (e) {
    console.error("Failed to alert on webhook failure:", e);
  }
}

// Every outbound call gets a hard ceiling. A hung Intercom or Slack call used to
// hold the whole request open until the platform killed it (504).
const OUTBOUND_TIMEOUT_MS = 8000;
const baseFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: RequestInit) => {
  if (init?.signal) return baseFetch(input, init);
  return baseFetch(input, { ...(init ?? {}), signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
}) as typeof fetch;

// The full event pipeline. Runs in the background after the 200 is already sent.
async function handleEvent(rawBody: string): Promise<Response> {


  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Record health on every signature-verified delivery. This is what "healthy webhook"
  // means: Intercom is successfully reaching us with a valid signature. The per-topic
  // handlers below may early-return for many reasons (wrong inbox, already tracked,
  // unhandled topic, etc.) — none of those should mark the integration as stale.
  await recordIntegrationHealth(supabase, "intercom_webhook", "ok");

  // Fetch settings for testing_mode and admin owner map
  const appSettings = await getSettings(supabase) as any;
  const testingMode = appSettings?.testing_mode === true;

  // Parse admin-to-owner mapping (JSON string like {"12345":"Joel","67890":"Kristina"})
  let adminOwnerMap: Record<string, string> = {};
  try {
    adminOwnerMap = JSON.parse(appSettings?.admin_owner_map || "{}");
  } catch { /* ignore parse errors */ }

  try {
    // Identity guard: verify token matches expected bot before posting to Slack
    const expectedBotId = appSettings?.slack_bot_user_id;
    if (expectedBotId) {
      const authCheck = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      });
      const authCheckData = await authCheck.json();
      if (!authCheckData.ok || authCheckData.user_id !== expectedBotId) {
        console.error(`IDENTITY GUARD: Token belongs to ${authCheckData.user_id || "unknown"}, expected ${expectedBotId}. Blocking.`);
        return new Response(JSON.stringify({ error: "Bot identity mismatch — refusing to post to Slack" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = JSON.parse(rawBody);
    console.log("Intercom webhook received:", JSON.stringify(body).substring(0, 500));

    const topic = body.topic;
    const itemId = body.data?.item?.id || body.data?.item?.ticket?.id;
    console.log(`Intercom webhook topic: ${topic}, conversation_id: ${itemId}`);

    const REPLY_TOPICS = [
      "conversation.admin.replied",
      "conversation.admin.single.reply",
      "conversation.admin.noted",
      "ticket.admin.replied",
      "conversation.user.replied",
      "conversation.user.created",
      "conversation.operator.replied",
      "ticket.contact.replied",
    ];
    const CLOSED_TOPICS = ["conversation.admin.closed", "ticket.state.updated"];

    if (!REPLY_TOPICS.includes(topic) && !CLOSED_TOPICS.includes(topic) && !ASSIGNMENT_TOPICS.includes(topic)) {
      console.log(`Ignoring topic: ${topic}`);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Handle assignment topics: auto-import to manual_conversations ---
    if (ASSIGNMENT_TOPICS.includes(topic)) {
      const rawTeamId = body.data?.item?.team_assignee_id;
      const teamId = rawTeamId ? String(rawTeamId) : null;
      const enterpriseInboxId = appSettings?.intercom_inbox_id;
      const intercomConvId = String(body.data?.item?.ticket?.id || body.data?.item?.id || "");

      // Resolve owner from admin_assignee_id
      const adminAssigneeId = String(body.data?.item?.admin_assignee_id || "");
      const resolvedOwner = adminOwnerMap[adminAssigneeId] || null;
      console.log(`Assignment event: team=${teamId}, enterpriseInbox=${enterpriseInboxId}, convId=${intercomConvId}, adminAssignee=${adminAssigneeId}, resolvedOwner=${resolvedOwner}`);

      // Check if this is the enterprise inbox — direct match first
      let isEnterpriseInbox = teamId === enterpriseInboxId;

      // If team_assignee_id doesn't match (admin-only assignment), verify via Intercom API
      if (!isEnterpriseInbox && INTERCOM_API_TOKEN && intercomConvId) {
        try {
          const convResp = await fetch(
            `https://api.intercom.io/conversations/${intercomConvId}`,
            {
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                Accept: "application/json",
                "Intercom-Version": "2.13",
              },
            }
          );
          if (convResp.ok) {
            const convData = await convResp.json();
            const actualTeamId = String(convData.team_assignee_id || "");
            console.log(`Intercom API fallback: conversation ${intercomConvId} actual team_assignee_id=${actualTeamId}`);
            isEnterpriseInbox = actualTeamId === enterpriseInboxId;
          }
        } catch (e) {
          console.error("Intercom API fallback check failed:", e);
        }
      }

      // Strict guard: do NOT fall back to admin_owner_map. Conversations assigned to
      // Joel/Kristina/Sam from other inboxes must not be auto-imported.

      if (!enterpriseInboxId || !isEnterpriseInbox) {
        console.log(`Assignment not to enterprise inbox (team=${teamId} vs ${enterpriseInboxId}), ignoring`);
        return new Response(JSON.stringify({ ok: true, message: "Not enterprise inbox" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!intercomConvId) {
        console.log("No conversation ID in assignment payload");
        return new Response(JSON.stringify({ ok: true, message: "No conv ID" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if already tracked in any table
      const [dup1, dup2, dup3] = await Promise.all([
        supabase.from("conversation_mappings").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("gmail_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("manual_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
      ]);

      if (dup1.data || dup2.data || dup3.data) {
        const existingId = dup1.data?.id || dup2.data?.id || dup3.data?.id;
        console.log(`Intercom ${intercomConvId} already tracked (${existingId}), updating owner if resolved`);

        // Update owner on the existing row if we resolved one
        if (resolvedOwner) {
          if (dup1.data) {
            await supabase.from("conversation_mappings").update({ owner: resolvedOwner }).eq("id", dup1.data.id);
          } else if (dup2.data) {
            await supabase.from("gmail_conversations").update({ owner: resolvedOwner }).eq("id", dup2.data.id);
          } else if (dup3.data) {
            await supabase.from("manual_conversations").update({ owner: resolvedOwner }).eq("id", dup3.data.id);
          }
          console.log(`Updated owner to ${resolvedOwner} for existing conversation ${existingId}`);
        }

        return new Response(JSON.stringify({ ok: true, message: "Already tracked", existingId, ownerUpdated: !!resolvedOwner }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch full conversation from Intercom API
      if (!INTERCOM_API_TOKEN) {
        console.error("INTERCOM_API_TOKEN not configured, cannot auto-import");
        return new Response(JSON.stringify({ ok: true, message: "No API token" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.13",
        },
      });

      if (!icRes.ok) {
        const errText = await icRes.text();
        console.error("Intercom API error during auto-import:", icRes.status, errText);
        await recordIntegrationHealth(supabase, "intercom_webhook", classifyHttpStatus(icRes.status), `auto-import ${icRes.status}: ${errText.slice(0, 200)}`);
        return new Response(JSON.stringify({ ok: true, message: "Intercom API error" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await recordIntegrationHealth(supabase, "intercom_webhook", "ok");
      const icData = await icRes.json();
      const customFields = extractIntercomCustomFields(icData);

      // Extract contact name and email
      let contactName = "";
      let contactEmail = "";
      const sourceContact = icData.source?.author;
      if (sourceContact) {
        contactName = sourceContact.name || sourceContact.email || "";
        contactEmail = sourceContact.email || "";
      }

      // If no email from source, try fetching the contact from Intercom API
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

      // Group aliases that should NOT be used for email-based linking — when a customer
      // emails enterprise-support@lovable.dev (a Google Group), Intercom records the group
      // alias as the contact email rather than the customer's address. Matching on it would
      // be ambiguous against every Gmail row in the inbox.
      const GROUP_ALIASES = new Set<string>(["enterprise-support@lovable.dev"]);
      const emailLowerForSkip = contactEmail ? contactEmail.toLowerCase() : "";
      const isGroupAlias = emailLowerForSkip ? GROUP_ALIASES.has(emailLowerForSkip) : false;
      // Option 1: internal Lovable employees appear as Intercom contacts on tickets they
      // open on behalf of customers. Their @lovable.dev inbox has dozens of unrelated open
      // threads, so the most-recent-thread email linker would mis-stamp. Skip the email
      // tier and rely on subject + pending-link path instead.
      const isInternalDomain = emailLowerForSkip.endsWith("@lovable.dev");
      const skipEmailLinker = isGroupAlias || isInternalDomain;
      if (skipEmailLinker) {
        console.log(`[email-linker-skip] Contact email ${contactEmail} is ${isGroupAlias ? "a group alias" : "an internal @lovable.dev address"}; skipping email-linker, will rely on subject + pending-link path.`);
      }

      // Cross-reference with gmail_conversations before creating manual entry
      if (contactEmail && !skipEmailLinker && isFilterSafeEmail(contactEmail)) {
        const emailLower = contactEmail.toLowerCase();
        const { data: gmailMatches } = await supabase
          .from("gmail_conversations")
          .select("id, gmail_thread_id")
          .is("intercom_conversation_id", null)
          .or(`from_email.ilike.%${emailLower}%,to_emails.ilike.%${emailLower}%,cc_emails.ilike.%${emailLower}%`)
          .order("received_at", { ascending: false })
          .limit(10);

        // Option 2: inverse uniqueness guard. If this Intercom id is already linked
        // to a *different* gmail_thread_id, refuse to stamp a second thread with it.
        // Prevents one Intercom ticket from fanning out across unrelated Gmail threads.
        if (gmailMatches && gmailMatches.length > 0) {
          const candidateThreadId = gmailMatches[0].gmail_thread_id;
          const { data: priorLinks } = await supabase
            .from("gmail_conversations")
            .select("gmail_thread_id")
            .eq("intercom_conversation_id", intercomConvId)
            .not("gmail_thread_id", "is", null);
          const distinctPriorThreads = Array.from(new Set((priorLinks || []).map(r => r.gmail_thread_id).filter(Boolean)));
          const conflictingPriorThread = distinctPriorThreads.find(t => t !== candidateThreadId);
          if (conflictingPriorThread) {
            console.warn(`[cross_thread_link_conflict:email] Intercom ${intercomConvId} already linked to Gmail thread ${conflictingPriorThread}; refusing to also stamp ${candidateThreadId || "(orphan rows)"} via email tier.`);
            await postGuardAlert({ tier: "email", intercomConvId, existingThreadId: conflictingPriorThread, attemptedThreadId: candidateThreadId, contactEmail });
            return new Response(JSON.stringify({
              ok: true,
              message: "Intercom ticket already linked to a different Gmail thread; refusing cross-thread link",
              existingThreadId: conflictingPriorThread,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }

        if (gmailMatches && gmailMatches.length > 0) {
          const updatePayload: Record<string, unknown> = { intercom_conversation_id: intercomConvId, ...customFields };
          if (resolvedOwner) updatePayload.owner = resolvedOwner;

          const threadId = gmailMatches[0].gmail_thread_id;
          if (threadId) {
            // Guard: never overwrite a sibling already linked to a different Intercom ticket
            const { data: siblings } = await supabase
              .from("gmail_conversations")
              .select("intercom_conversation_id")
              .eq("gmail_thread_id", threadId)
              .not("intercom_conversation_id", "is", null);
            const conflicting = (siblings || []).find(s => s.intercom_conversation_id && s.intercom_conversation_id !== intercomConvId);
            if (conflicting) {
              console.warn(`[email_link_conflict] Gmail thread ${threadId} already linked to ${conflicting.intercom_conversation_id}; refusing to overwrite with ${intercomConvId}. Treating as duplicate Intercom ticket.`);
              return new Response(JSON.stringify({ ok: true, message: "Duplicate Intercom ticket for already-linked Gmail thread", existingIntercomId: conflicting.intercom_conversation_id }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }

            const { error: gmailErr } = await supabase
              .from("gmail_conversations")
              .update(updatePayload)
              .eq("gmail_thread_id", threadId)
              .or(`intercom_conversation_id.is.null,intercom_conversation_id.eq.${intercomConvId}`);
            if (gmailErr) {
              console.error("Gmail thread link error:", gmailErr);
            } else {
              console.log(`Linked Intercom ${intercomConvId} to Gmail thread ${threadId} via email ${emailLower}`);
              return new Response(JSON.stringify({ ok: true, message: "Linked to Gmail thread", gmailThreadId: threadId }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          } else {
            const ids = gmailMatches.map(r => r.id);
            const { error: gmailErr } = await supabase
              .from("gmail_conversations")
              .update(updatePayload)
              .in("id", ids);
            if (gmailErr) {
              console.error("Gmail row link error:", gmailErr);
            } else {
              console.log(`Linked Intercom ${intercomConvId} to ${ids.length} Gmail rows via email ${emailLower}`);
              return new Response(JSON.stringify({ ok: true, message: "Linked to Gmail records", gmailIds: ids }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
        }
      }

      // Subject-based fallback: catches Google-Group-relayed mail where the
      // customer's email never appears on the Gmail row (from_email is the
      // group alias, not the customer). Match within last 14d.
      const icSubject: string = String(icData.source?.subject || icData.subject || "").trim();
      const normalize = (s: string) =>
        s.replace(/^(Re|Fwd|Fw):\s*/gi, "").replace(/\s+/g, " ").toLowerCase().trim();
      const normSubject = icSubject ? normalize(icSubject) : "";

      if (normSubject.length > 5) {
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const { data: subjCandidates } = await supabase
          .from("gmail_conversations")
          .select("id, gmail_thread_id, subject, intercom_conversation_id")
          .gte("received_at", since)
          .order("received_at", { ascending: false })
          .limit(200);

        const matched = (subjCandidates || []).filter(r => normalize(String(r.subject || "")) === normSubject);

        // (a) "Already represented" check — any candidate already linked to a different Intercom ticket?
        const alreadyLinked = matched.filter(r => r.intercom_conversation_id && r.intercom_conversation_id !== intercomConvId);
        const distinctExistingIcIds = Array.from(new Set(alreadyLinked.map(r => r.intercom_conversation_id)));
        if (distinctExistingIcIds.length === 1) {
          const existingIcId = distinctExistingIcIds[0]!;
          const existingThreadId = alreadyLinked[0]?.gmail_thread_id || null;
          console.warn(`[subject_match_existing_gmail] Intercom ${intercomConvId} matches Gmail thread ${existingThreadId} already linked to ${existingIcId}; skipping new manual creation.`);
          return new Response(JSON.stringify({
            ok: true,
            message: "Duplicate Intercom ticket for existing Gmail thread",
            existingThreadId,
            existingIntercomId: existingIcId,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else if (distinctExistingIcIds.length > 1) {
          console.warn(`[subject_match_existing_gmail_ambiguous] ${distinctExistingIcIds.length} distinct existing Intercom IDs for subject "${normSubject}"; falling through.`);
        }

        // (b) Stamp tier — only unlinked candidates, exactly one distinct thread
        const unlinked = matched.filter(r => !r.intercom_conversation_id);
        const distinctThreads = Array.from(new Set(unlinked.map(r => r.gmail_thread_id).filter(Boolean)));
        if (distinctThreads.length === 1) {
          const threadId = distinctThreads[0]!;

          // Defense-in-depth: re-check siblings before stamping
          const { data: siblings } = await supabase
            .from("gmail_conversations")
            .select("intercom_conversation_id")
            .eq("gmail_thread_id", threadId)
            .not("intercom_conversation_id", "is", null);
          const conflicting = (siblings || []).find(s => s.intercom_conversation_id && s.intercom_conversation_id !== intercomConvId);
          if (conflicting) {
            console.warn(`[subject_link_conflict] Gmail thread ${threadId} already linked to ${conflicting.intercom_conversation_id}; refusing to overwrite with ${intercomConvId}.`);
            return new Response(JSON.stringify({ ok: true, message: "Duplicate Intercom ticket for already-linked Gmail thread", existingIntercomId: conflicting.intercom_conversation_id }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Option 2: inverse uniqueness guard at subject tier.
          const { data: priorLinksSubj } = await supabase
            .from("gmail_conversations")
            .select("gmail_thread_id")
            .eq("intercom_conversation_id", intercomConvId)
            .not("gmail_thread_id", "is", null);
          const distinctPriorSubj = Array.from(new Set((priorLinksSubj || []).map(r => r.gmail_thread_id).filter(Boolean)));
          const conflictingPriorSubj = distinctPriorSubj.find(t => t !== threadId);
          if (conflictingPriorSubj) {
            console.warn(`[cross_thread_link_conflict:subject] Intercom ${intercomConvId} already linked to Gmail thread ${conflictingPriorSubj}; refusing to also stamp ${threadId} via subject tier.`);
            await postGuardAlert({ tier: "subject", intercomConvId, existingThreadId: conflictingPriorSubj, attemptedThreadId: threadId, contactEmail });
            return new Response(JSON.stringify({
              ok: true,
              message: "Intercom ticket already linked to a different Gmail thread; refusing cross-thread link",
              existingThreadId: conflictingPriorSubj,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }


          const updatePayload: Record<string, unknown> = { intercom_conversation_id: intercomConvId, ...customFields };
          if (resolvedOwner) updatePayload.owner = resolvedOwner;
          const { error: subjErr } = await supabase
            .from("gmail_conversations")
            .update(updatePayload)
            .eq("gmail_thread_id", threadId)
            .or(`intercom_conversation_id.is.null,intercom_conversation_id.eq.${intercomConvId}`);
          if (!subjErr) {
            console.log(`[subject-fallback] Linked Intercom ${intercomConvId} to Gmail thread ${threadId} via subject "${normSubject}"`);
            return new Response(JSON.stringify({ ok: true, message: "Linked via subject fallback", gmailThreadId: threadId }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          console.error("Subject-fallback link error:", subjErr);
        } else if (distinctThreads.length > 1) {
          console.warn(`[subject_link_ambiguous] ${distinctThreads.length} candidate Gmail threads for subject "${normSubject}", falling through.`);
        }
      }

      // Manual-conversations subject lookup tier: prevents creating a duplicate
      // manual row when an existing one already represents the same thread.
      if (normSubject.length > 5) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: manualMatches } = await supabase
          .from("manual_conversations")
          .select("id, intercom_conversation_id, subject")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(100);

        const matched = (manualMatches || []).filter(r => normalize(String(r.subject || "")) === normSubject);
        if (matched.length === 1) {
          const existing = matched[0];
          console.log(`[subject_match_existing_manual] Intercom ${intercomConvId} matches existing manual row ${existing.id} (intercom ${existing.intercom_conversation_id || "none"}); skipping new manual creation.`);
          return new Response(JSON.stringify({
            ok: true,
            message: "Duplicate Intercom ticket for existing manual conversation",
            existingManualId: existing.id,
            existingIntercomId: existing.intercom_conversation_id,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else if (matched.length > 1) {
          console.warn(`[subject_match_existing_manual_ambiguous] ${matched.length} manual rows match subject "${normSubject}"; falling through to manual creation.`);
        }
      }

      // Strip HTML helper
      const strip = (html: string): string =>
        html
          .replace(/<[^>]*>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ")
          .trim();

      const subject = strip(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
      const convUrl = `https://app.intercom.com/a/inbox/wq44gprj/inbox/conversation/${intercomConvId}`;

      // Extract messages FIRST to compute earliest timestamp
      const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
      const toIso = (ts: number) => new Date(ts * 1000).toISOString();
      const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);

      const preMessages: Array<{ message_text: string; sender_name: string; role: string; created_at: string; is_internal_note: boolean }> = [];

      // Source message
      const src = icData.source;
      if (src?.body) {
        const text = strip(src.body);
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
        const text = strip(part.body);
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

      // Compute earliest timestamp for created_at
      const conversationCreatedAt = preMessages.length > 0
        ? preMessages[0].created_at
        : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString());

      // Defer manual creation: insert into pending_intercom_links and let either
      // poll-gmail (within 15 min) or promote-pending-intercom-links (after 20 min)
      // decide whether this becomes a Gmail link or a manual_conversations row.
      // This closes the race where Intercom assigns the ticket within seconds while
      // the matching Gmail row is still queued for the 15-min poll cycle.
      const intercomCreatedAtIso = icData.created_at
        ? toIso(icData.created_at)
        : conversationCreatedAt;

      const { error: pendingErr } = await supabase
        .from("pending_intercom_links")
        .upsert({
          intercom_conversation_id: intercomConvId,
          normalized_subject: normSubject || subject.toLowerCase().trim(),
          intercom_created_at: intercomCreatedAtIso,
          contact_name: contactName,
          contact_email: contactEmail || null,
          resolved_owner: resolvedOwner,
          source_payload: {
            subject,
            link: convUrl,
            intercom_conversation_id: intercomConvId,
            conversation_created_at: conversationCreatedAt,
            ...customFields,
          },
          pre_messages: preMessages,
        }, { onConflict: "intercom_conversation_id" });

      if (pendingErr) {
        console.error("[pending-link-insert-error]", pendingErr);
        return new Response(JSON.stringify({ ok: true, message: "Pending insert failed", error: pendingErr.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[pending-link-queued] Intercom ${intercomConvId} held for Gmail reconciliation (subject="${normSubject}", contact="${contactEmail}", messages=${preMessages.length})`);
      return new Response(JSON.stringify({
        ok: true,
        message: "Queued for Gmail reconciliation",
        intercomConvId,
        normalizedSubject: normSubject,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For ticket.state.updated, only process resolved/closed states
    if (topic === "ticket.state.updated") {
      const ticketState = body.data?.item?.ticket_state;
      const stateCategory = typeof ticketState === "object" ? ticketState?.category : ticketState;
      if (stateCategory !== "resolved" && stateCategory !== "closed") {
        console.log(`Ignoring ticket.state.updated with state: ${stateCategory}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Ticket events may use different payload shapes for the conversation ID
    // For ticket topics, prefer item.ticket.id (item.id may be a part ID)
    const conversationId = (topic.startsWith("ticket.")
      ? (body.data?.item?.ticket?.id || body.data?.item?.id)
      : (body.data?.item?.id || body.data?.item?.ticket?.id))
      || body.data?.item?.ticket_id
      || body.data?.item?.conversation_id;
    if (!conversationId) {
      console.error("No conversation ID found in webhook payload");
      return new Response(JSON.stringify({ error: "No conversation ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { data: mapping } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("intercom_conversation_id", String(conversationId))
      .maybeSingle();

    // Fallback: try alternative IDs from payload if initial lookup fails
    if (!mapping) {
      const altIds = [
        body.data?.item?.ticket?.id,
        body.data?.item?.id,
        body.data?.item?.ticket_id,
        body.data?.item?.conversation_id,
      ].filter(Boolean).map(String).filter(id => id !== String(conversationId));

      for (const altId of altIds) {
        const { data: altMapping } = await supabase
          .from("conversation_mappings")
          .select("*")
          .eq("intercom_conversation_id", altId)
          .maybeSingle();
        if (altMapping) {
          mapping = altMapping;
          console.log(`Found mapping via alt ID ${altId} (original conversationId: ${conversationId})`);
          break;
        }
      }
    }

    if (!mapping) {
      // Fallback: check manual_conversations / gmail_conversations for non-Slack tracked conversations
      const allConvIds = [String(conversationId), ...[
        body.data?.item?.ticket?.id,
        body.data?.item?.id,
        body.data?.item?.ticket_id,
        body.data?.item?.conversation_id,
      ].filter(Boolean).map(String).filter(id => id !== String(conversationId))];

      if (REPLY_TOPICS.includes(topic)) {
        let manualConv = null;
        for (const cid of allConvIds) {
          const { data } = await supabase
            .from("manual_conversations")
            .select("id")
            .eq("intercom_conversation_id", cid)
            .maybeSingle();
          if (data) { manualConv = data; break; }
        }

        if (manualConv) {
          // Extract reply from webhook payload
          const parts = body.data?.item?.conversation_parts?.conversation_parts || [];
          const latestPart = parts[parts.length - 1] || parts[0];
          if (latestPart?.body) {
            const strip = (html: string): string =>
              html
                .replace(/<[^>]*>/g, "")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, " ")
                .trim();
            const text = strip(latestPart.body);
            if (text) {
              const authorType = latestPart.author?.type || "admin";
              const role = (authorType === "user" || authorType === "lead") ? "user" : "admin";
              const senderName = latestPart.author?.name || latestPart.author?.email || authorType;
              const createdAt = latestPart.created_at
                ? new Date(latestPart.created_at * 1000).toISOString()
                : new Date().toISOString();
              const isNote = latestPart.part_type === "note";

              const { error: msgErr } = await supabase.from("manual_messages").insert({
                conversation_id: manualConv.id,
                message_text: text,
                sender_name: senderName,
                role,
                created_at: createdAt,
                is_internal_note: isNote,
              });
              if (msgErr) {
                console.error("Failed to insert live reply for manual conv:", msgErr);
              } else {
                console.log(`Appended live ${isNote ? "note" : "reply"} to manual conversation ${manualConv.id}`);
                // Internal notes don't change the customer-facing status
                if (!isNote) {
                  const newStatus = role === "admin" ? "awaiting_customer" : "awaiting_support";
                  await supabase
                    .from("manual_conversations")
                    .update({ status: newStatus } as any)
                    .eq("id", manualConv.id)
                    .neq("status", "resolved");
                  console.log(`Updated manual_conversation ${manualConv.id} status to ${newStatus}`);
                }
              }
              return new Response(JSON.stringify({ ok: true, message: "Appended to manual conversation", id: manualConv.id }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
        }

        // Gmail fallback: update status for Gmail-linked conversations
        let gmailConv = null;
        for (const cid of allConvIds) {
          const { data } = await supabase
            .from("gmail_conversations")
            .select("id")
            .eq("intercom_conversation_id", cid)
            .maybeSingle();
          if (data) { gmailConv = data; break; }
        }

        if (gmailConv) {
          const parts = body.data?.item?.conversation_parts?.conversation_parts || [];
          const latestPart = parts[parts.length - 1] || parts[0];
          const authorType = latestPart?.author?.type || "admin";
          const newStatus = (authorType === "user" || authorType === "lead") ? "awaiting_support" : "awaiting_customer";
          await supabase
            .from("gmail_conversations")
            .update({ status: newStatus })
            .eq("id", gmailConv.id)
            .neq("status", "resolved");
          console.log(`Updated gmail_conversation ${gmailConv.id} status to ${newStatus} via Intercom reply`);
          return new Response(JSON.stringify({ ok: true, message: "Updated Gmail conversation status", id: gmailConv.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Fallback: resolve manual_conversations or gmail_conversations on Intercom close
      if (CLOSED_TOPICS.includes(topic)) {
        const now = new Date().toISOString();
        let resolved = false;

        for (const cid of allConvIds) {
          const { data: mc } = await supabase
            .from("manual_conversations")
            .update({ status: "resolved", resolved_at: now } as any)
            .eq("intercom_conversation_id", cid)
            .neq("status", "resolved")
            .select("id")
            .maybeSingle();
          if (mc) {
            console.log(`Resolved manual_conversation ${mc.id} via Intercom close`);
            resolved = true;
            break;
          }
        }

        if (!resolved) {
          for (const cid of allConvIds) {
            const { data: gc } = await supabase
              .from("gmail_conversations")
              .update({ status: "resolved", resolved_at: now })
              .eq("intercom_conversation_id", cid)
              .neq("status", "resolved")
              .select("id")
              .maybeSingle();
            if (gc) {
              console.log(`Resolved gmail_conversation ${gc.id} via Intercom close`);
              resolved = true;
              break;
            }
          }
        }

        if (resolved) {
          return new Response(JSON.stringify({ ok: true, message: "Resolved via Intercom close" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      console.log(`No mapping found for Intercom conversation ${conversationId}. Payload IDs: item.id=${body.data?.item?.id}, ticket.id=${body.data?.item?.ticket?.id}, ticket_id=${body.data?.item?.ticket_id}, type=${body.data?.item?.type}`);
      return new Response(JSON.stringify({ ok: true, message: "No mapping found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle conversation closed/resolved in Intercom
    if (CLOSED_TOPICS.includes(topic)) {
      if (mapping.status !== "resolved") {
        // Remove feedback buttons from previous bot messages in the thread
        try {
          const repliesRes = await fetch(
            `${SLACK_API_URL}/conversations.replies?channel=${mapping.slack_channel_id}&ts=${mapping.slack_thread_ts}&limit=100`,
            { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
          );
          const repliesData = await repliesRes.json();
          if (repliesData.ok && repliesData.messages) {
            for (const msg of repliesData.messages) {
              // Find messages with action blocks (feedback buttons)
              const hasActions = msg.blocks?.some((b: { type: string }) => b.type === "actions");
              if (hasActions && msg.ts) {
                const blocksWithoutActions = msg.blocks.filter((b: { type: string }) => b.type !== "actions");
                await fetch(`${SLACK_API_URL}/chat.update`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    channel: mapping.slack_channel_id,
                    ts: msg.ts,
                    text: msg.text || "",
                    blocks: blocksWithoutActions,
                  }),
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to remove feedback buttons:", e);
        }

        // Load bot messages for closed text
        const { data: closedMsgRows } = await supabase.from("bot_messages").select("message_key, message_text").eq("message_key", "conversation_closed").maybeSingle();
        const closedText = closedMsgRows?.message_text || "This issue has been marked as resolved. If you need any further assistance, please feel free to start a new Slack thread. Continuing the conversation here will not notify our Support Team.";

        const closeRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: mapping.slack_channel_id,
            thread_ts: mapping.slack_thread_ts,
            text: closedText,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: closedText } }],
            ...BOT_IDENTITY,
          }),
        });
        const closeData = await closeRes.json();
        if (!closeRes.ok || !closeData.ok) {
          console.error(`Failed to post close message: ${JSON.stringify(closeData)}`);
        }

        await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "eyes");
        await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "hourglass_flowing_sand");
        await addReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "white_check_mark");

        await supabase
          .from("conversation_mappings")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", mapping.id);

        // Post CSAT prompt (idempotent: skip if already rated or already prompted)
        if (!(mapping as any).csat_rating && !(mapping as any).csat_prompt_ts) {
          try {
            const csatRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: mapping.slack_channel_id,
                thread_ts: mapping.slack_thread_ts,
                text: "Rate your conversation",
                blocks: [
                  { type: "section", text: { type: "mrkdwn", text: "*Rate your conversation*" } },
                  {
                    type: "actions",
                    block_id: `csat_${mapping.id}`,
                    elements: [
                      { type: "button", action_id: "csat_1", text: { type: "plain_text", emoji: true, text: "😠 Terrible" }, value: "1" },
                      { type: "button", action_id: "csat_2", text: { type: "plain_text", emoji: true, text: "🙁 Bad" }, value: "2" },
                      { type: "button", action_id: "csat_3", text: { type: "plain_text", emoji: true, text: "😐 OK" }, value: "3" },
                      { type: "button", action_id: "csat_4", text: { type: "plain_text", emoji: true, text: "😀 Great" }, value: "4" },
                      { type: "button", action_id: "csat_5", text: { type: "plain_text", emoji: true, text: "🤩 Amazing" }, value: "5" },
                    ],
                  },
                ],
                ...BOT_IDENTITY,
              }),
            });
            const csatData = await csatRes.json();
            if (csatData.ok && csatData.ts) {
              await supabase.from("conversation_mappings").update({ csat_prompt_ts: csatData.ts } as any).eq("id", mapping.id);
            } else {
              console.error("Failed to post CSAT prompt:", csatData);
            }
          } catch (e) {
            console.error("CSAT post error:", e);
          }
        }

        console.log(`Marked conversation ${conversationId} as resolved and notified Slack`);
      } else {
        console.log(`Conversation ${conversationId} already resolved, skipping`);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if conversation is already resolved — UNLESS:
    // 1. No reply was ever posted (e.g. Sam merged/closed before the reply webhook arrived)
    // 2. An admin is following up (e.g. Sam's snooze→reply→close workflow)
    const isAdminReplyTopic = topic === "conversation.admin.replied" || topic === "conversation.admin.single.reply" || topic === "ticket.admin.replied";
    if (mapping.status === "resolved" && mapping.last_intercom_part_id !== null && !isAdminReplyTopic) {
      console.log(`Ignoring reply for ${conversationId} — status is already resolved and a reply was previously posted (non-admin topic: ${topic})`);
      return new Response(JSON.stringify({ ok: true, message: "Already closed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mapping.status === "resolved" && mapping.last_intercom_part_id !== null && isAdminReplyTopic) {
      console.log(`Processing admin follow-up on resolved conversation ${conversationId} — reopening for tracking`);
    }
    if (mapping.status === "resolved" && mapping.last_intercom_part_id === null) {
      console.log(`Processing reply for resolved conversation ${conversationId} — no reply was ever posted`);
    }

    let conversationParts = body.data?.item?.conversation_parts?.conversation_parts;

    // Always prefer fresh conversation parts from Intercom API for reply topics.
    // Webhook payloads can be partial/stale, which can make us pick an older comment
    // and incorrectly skip customer-facing replies.
    if (INTERCOM_API_TOKEN) {
      try {
        const convoRes = await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            Accept: "application/json",
            "Intercom-Version": "2.13",
          },
        });

        if (convoRes.ok) {
          const convoData = await convoRes.json();
          const apiParts = convoData?.conversation_parts?.conversation_parts;
          if (Array.isArray(apiParts) && apiParts.length > 0) {
            conversationParts = apiParts;
            console.log(`Loaded ${apiParts.length} conversation parts from Intercom API for ${conversationId}`);
          }
        } else {
          console.warn(`Failed to fetch conversation ${conversationId} from Intercom API: ${await convoRes.text()}`);
        }

        // Fallback: try tickets endpoint if conversation endpoint returned no parts
        if (!conversationParts || conversationParts.length === 0) {
          try {
            const ticketRes = await fetch(`https://api.intercom.io/tickets/${conversationId}`, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                Accept: "application/json",
                "Intercom-Version": "2.13",
              },
            });
            if (ticketRes.ok) {
              const ticketData = await ticketRes.json();
              const ticketParts = ticketData?.conversation_parts?.conversation_parts;
              if (Array.isArray(ticketParts) && ticketParts.length > 0) {
                conversationParts = ticketParts;
                console.log(`Loaded ${ticketParts.length} parts from tickets API for ${conversationId}`);
              }
            }
          } catch (te) {
            console.warn(`Tickets API fallback failed for ${conversationId}:`, te);
          }
        }
      } catch (e) {
        console.warn(`Error fetching conversation ${conversationId} from Intercom API:`, e);
      }
    }

    // Find the last public-facing comment part — skip notes, assignments, and system parts
    // IMPORTANT: We must identify the comment BEFORE setting the dedup marker,
    // otherwise non-comment parts can "consume" the dedup slot and prevent
    // the actual comment from ever being processed.
    // Accept comment parts AND assignment parts that carry a body — Intercom's
    // "assign and reply" delivers the admin's text on an `assignment` part.
    // Notes stay excluded (internal-only, must not leak to Slack).
    const FORWARDABLE_PART_TYPES = new Set(["comment", "assignment"]);
    let lastCommentPart: Record<string, unknown> | null = null;
    if (conversationParts && conversationParts.length > 0) {
      for (let i = conversationParts.length - 1; i >= 0; i--) {
        const p = conversationParts[i] as { part_type?: string; body?: string };
        if (FORWARDABLE_PART_TYPES.has(p.part_type || "") && p.body && String(p.body).trim()) {
          lastCommentPart = conversationParts[i];
          break;
        }
      }
    }

    if (!lastCommentPart) {
      console.log(`No comment part found in webhook payload for conversation ${conversationId}, skipping`);
      return new Response(JSON.stringify({ ok: true, message: "No comment part" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Author-type guard: never relay a customer-authored part back into Slack.
    // Slack→Intercom forwards of the original requester's words are posted as
    // user-type parts, which Intercom re-emits as conversation.user.replied.
    // Without this guard the Hub echoes the customer's own message into the
    // thread labeled as Sam / Ask Lovable (the "parroting" bug).
    {
      const guardAuthorType = String(
        (lastCommentPart.author as { type?: string } | undefined)?.type || ""
      ).toLowerCase();
      if (guardAuthorType === "user" || guardAuthorType === "lead" || guardAuthorType === "contact") {
        console.log(
          `Skipping Slack relay for conversation ${conversationId}: last forwardable part ${
            lastCommentPart.id ?? "unknown"
          } is customer-authored (${guardAuthorType})`
        );
        return new Response(
          JSON.stringify({ ok: true, message: "Customer-authored part, not relayed" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }


    // Deduplication: atomic claim via Postgres row-level lock
    const partId = lastCommentPart.id ? String(lastCommentPart.id) : null;
    if (partId) {
      const { data: claimed, error: claimError } = await supabase
        .rpc("claim_intercom_part", {
          p_mapping_id: mapping.id,
          p_part_id: partId,
        });

      if (claimError) {
        console.error(`Dedup claim RPC failed for mapping ${mapping.id}, part ${partId}:`, claimError);
        // Default: proceed to avoid dropping messages
      }

      if (!claimError && claimed === false) {
        console.log(`Duplicate part ${partId} for mapping ${mapping.id}, skipping`);
        return new Response(JSON.stringify({ ok: true, message: "Duplicate skipped" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let replyText = "";
    let adminName = "";
    let isHumanAdmin = false;
    let lastCommentAuthorType = "";
    let isKnownAiAgent = false;

    // Attachments from the comment part
    let attachments: Array<{ url: string; name: string; content_type: string }> = [];

    {
      const rawBody = (lastCommentPart.body as string) || "";

      // Extract inline <img> URLs before stripping HTML
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = imgRegex.exec(rawBody)) !== null) {
        const imgUrl = imgMatch[1];
        if (imgUrl && !imgUrl.startsWith("data:")) {
          attachments.push({ url: imgUrl, name: "inline-image", content_type: "image/png" });
        }
      }

      replyText = rawBody
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const author = lastCommentPart.author as { type?: string; name?: string; id?: string } | undefined;
      lastCommentAuthorType = String(author?.type || "");
      const normalizedAuthorName = String(author?.name || "").trim().toLowerCase();
      isKnownAiAgent = normalizedAuthorName === "sam" || normalizedAuthorName.includes("ask lovable");

      // Keep human behavior intact, but force Sam/Ask Lovable to stay on default bot identity
      if (author && author.type === "admin" && author.name && !isKnownAiAgent) {
        adminName = author.name;
        isHumanAdmin = true;
      }

      // Extract explicit attachments from the conversation part
      const partAttachments = lastCommentPart.attachments;
      if (partAttachments && Array.isArray(partAttachments)) {
        const explicit = partAttachments
          .filter((a: { url?: string }) => a.url)
          .map((a: { url: string; name?: string; content_type?: string }) => ({
            url: a.url,
            name: a.name || "attachment",
            content_type: a.content_type || "application/octet-stream",
          }));
        // Deduplicate against inline images already extracted
        const existingUrls = new Set(attachments.map((a) => a.url));
        for (const att of explicit) {
          if (!existingUrls.has(att.url)) {
            attachments.push(att);
          }
        }
      }
      if (attachments.length > 0) {
        console.log(`Found ${attachments.length} attachment(s) in Intercom reply`);
      }
    }
    const isAiAgentReply = lastCommentAuthorType === "admin" && !isHumanAdmin;

    // Skip replies that originated from Slack (they already appear in the thread)
    const slackOriginPattern = /\[From:.*via Slack\]/i;
    if (slackOriginPattern.test(replyText) || slackOriginPattern.test((lastCommentPart.body as string) || "")) {
      console.log(`Skipping Slack-originated reply for conversation ${conversationId} (already in thread)`);
      return new Response(JSON.stringify({ ok: true, message: "Slack-originated reply skipped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip the customer-side marker we create during Sam auto-escalation. Intercom
    // emits it back as conversation.user.replied; reposting it would create a loop.
    const escalationCustomerMarkerPattern = /^This ticket has been escalated — awaiting human support response\.?$/i;
    if (lastCommentAuthorType !== "admin" && escalationCustomerMarkerPattern.test(replyText.trim())) {
      console.log(`Skipping webhook-created escalation marker for conversation ${conversationId}`);
      return new Response(JSON.stringify({ ok: true, message: "Escalation marker skipped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!replyText && attachments.length === 0) {
      console.log("No reply text or attachments found");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect incident.io action — check if the reply body references incident.io or the status page
    const STATUS_PAGE_URL = "https://status.lovable.dev";
    const incidentIoPattern = /incident\.io|status\.lovable\.dev|we have an incident|status page/i;
    const hasIncidentIoAction = incidentIoPattern.test(replyText) || incidentIoPattern.test((lastCommentPart.body as string) || "");

    let incidentStatusBlock: Record<string, unknown>[] = [];
    if (hasIncidentIoAction) {
      try {
        const statusRes = await fetch(`${STATUS_PAGE_URL}/api/v2/summary.json`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const overallStatus = statusData.status?.description || "Unknown";
          const indicator = statusData.status?.indicator || "none";
          const emoji = indicator === "none" ? "✅" : indicator === "minor" ? "⚠️" : indicator === "major" ? "🔴" : indicator === "critical" ? "🚨" : "ℹ️";

          // Build component statuses
          const componentLines = (statusData.components || [])
            .map((c: { name: string; status: string }) => {
              const cEmoji = c.status === "operational" ? "✅" : c.status === "degraded_performance" ? "⚠️" : c.status === "partial_outage" ? "🟡" : c.status === "major_outage" ? "🔴" : "❓";
              return `${cEmoji} *${c.name}*: ${c.status.replace(/_/g, " ")}`;
            })
            .join("\n");

          incidentStatusBlock = [
            { type: "divider" },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${emoji} *Lovable Status: ${overallStatus}*`,
              },
            },
            ...(componentLines ? [{
              type: "section",
              text: { type: "mrkdwn", text: componentLines },
            }] : []),
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
                  action_id: "feedback_positive",
                  value: String(conversationId),
                },
                ...(mapping.status !== "escalated" && mapping.status !== "escalated_pending" ? [{
                  type: "button",
                  text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
                  action_id: "feedback_negative",
                  value: String(conversationId),
                }] : []),
                {
                  type: "button",
                  text: { type: "plain_text", text: "📡 Subscribe to status updates", emoji: true },
                  url: STATUS_PAGE_URL,
                  action_id: "incident_io_subscribe",
                },
              ],
            },
          ];

          console.log(`incident.io action detected — status: ${overallStatus}`);
        } else {
          console.error(`Failed to fetch status page: ${statusRes.status}`);
        }
      } catch (e) {
        console.error("Failed to fetch incident.io status:", e);
      }
    }

    // Replace incident.io app references with the actual status page URL
    replyText = replyText
      .replace(/\[App:\s*incident\.io\]/gi, "https://status.lovable.dev/")
      .replace(/\(App:\s*incident\.io\)/gi, "https://status.lovable.dev/");

    // Strip sign-off lines and AI attribution (handle various Intercom AI footers)
    replyText = replyText
      .replace(/\n*This message was.*$/is, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\n+\w+\s*$/i, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\s*$/i, "")
      .trim();


    // Split long text into chunks to avoid Slack's "See more" collapse.
    // Slack truncates at ~3000 chars OR ~40 lines — use whichever limit is hit first.
    const MAX_CHUNK_CHARS = 2500;
    const MAX_CHUNK_LINES = 35;
    const chunks: string[] = [];
    function needsSplit(text: string) {
      return text.length > MAX_CHUNK_CHARS || text.split("\n").length > MAX_CHUNK_LINES;
    }

    if (!needsSplit(replyText)) {
      chunks.push(replyText);
    } else {
      let remaining = replyText;
      while (needsSplit(remaining)) {
        let splitIdx = remaining.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
        if (splitIdx <= 0) splitIdx = remaining.lastIndexOf("\n", MAX_CHUNK_CHARS);
        if (splitIdx <= 0) splitIdx = MAX_CHUNK_CHARS;

        const lines = remaining.substring(0, splitIdx).split("\n");
        if (lines.length > MAX_CHUNK_LINES) {
          splitIdx = lines.slice(0, MAX_CHUNK_LINES).join("\n").length;
        }

        chunks.push(remaining.substring(0, splitIdx).trim());
        remaining = remaining.substring(splitIdx).trim();
      }
      if (remaining) chunks.push(remaining);
    }

    // Helper to post a single Slack message
    async function postSlackMessage(payload: Record<string, unknown>) {
      const res = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(`Slack API call failed [${res.status}]: ${JSON.stringify(data)}`);
      }
      return data;
    }

    const basePayload: Record<string, unknown> = {
      channel: mapping.slack_channel_id,
      thread_ts: mapping.slack_thread_ts,
      ...BOT_IDENTITY,
    };

    // For human admin replies, fetch their avatar and override Slack identity
    if (isHumanAdmin && adminName && INTERCOM_API_TOKEN) {
      const adminAuthor = lastCommentPart.author as { id?: string } | undefined;
      const adminId = adminAuthor?.id;
      let avatarUrl = "";

      // 1) Try Intercom admin avatar
      if (adminId) {
        try {
          const adminRes = await fetch(`https://api.intercom.io/admins/${adminId}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
            },
          });
          if (adminRes.ok) {
            const adminData = await adminRes.json();
            console.log(`Intercom admin data for ${adminName}: avatar=${adminData.avatar?.image_url || "none"}, email=${adminData.email || "none"}`);
            if (adminData.avatar?.image_url) {
              avatarUrl = adminData.avatar.image_url;
            }

            // 2) Fallback: look up Slack profile picture by admin email
            if (!avatarUrl && adminData.email) {
              try {
                const slackLookup = await fetch(
                  `${SLACK_API_URL}/users.lookupByEmail?email=${encodeURIComponent(adminData.email)}`,
                  { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
                );
                const slackData = await slackLookup.json();
                if (slackData.ok && slackData.user?.profile) {
                  avatarUrl = slackData.user.profile.image_192 || slackData.user.profile.image_72 || "";
                  console.log(`Using Slack avatar for ${adminName}: ${avatarUrl}`);
                }
              } catch (e) {
                console.error("Slack email lookup failed:", e);
              }
            }
          } else {
            console.error(`Intercom admin fetch failed: ${adminRes.status}`);
          }
        } catch (e) {
          console.error("Failed to fetch admin avatar:", e);
        }
      }

      if (avatarUrl) {
        basePayload.icon_url = avatarUrl;
      }
      basePayload.username = adminName;
    }

    // Debug message is already posted by slack-interactions when the ticket is created

    // Remove feedback buttons from previous bot messages before posting new reply
    try {
      const repliesRes = await fetch(
        `${SLACK_API_URL}/conversations.replies?channel=${mapping.slack_channel_id}&ts=${mapping.slack_thread_ts}&limit=100`,
        { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
      );
      const repliesData = await repliesRes.json();
      if (repliesData.ok && repliesData.messages) {
        for (const msg of repliesData.messages) {
          const hasActions = msg.blocks?.some((b: { type: string }) => b.type === "actions");
          if (hasActions && msg.ts) {
            const blocksWithoutActions = msg.blocks.filter((b: { type: string }) => b.type !== "actions");
            await fetch(`${SLACK_API_URL}/chat.update`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: mapping.slack_channel_id,
                ts: msg.ts,
                text: msg.text || "",
                blocks: blocksWithoutActions,
              }),
            });
          }
        }
      }
    } catch (e) {
      console.error("Failed to remove old feedback buttons:", e);
    }

    // Send each chunk as a separate threaded message to avoid Slack's "See more" collapse
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const blocks: Record<string, unknown>[] = [];

      // Add divider + timestamp header on the first chunk
      if (i === 0) {
        blocks.push({ type: "divider" });
        const headerLabel = isHumanAdmin && adminName ? `💬 *${adminName}* replied · ${timestamp}` : `🤖 *Sam* replied · ${timestamp}`;
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: headerLabel }] });
      }

      blocks.push({ type: "section", text: { type: "mrkdwn", text: chunks[i] } });

      // Detect if Sam (AI) decided to route/escalate to humans
      const escalationKeywords = /\b(escalat|routing|transfer|hand(ing|ed)?\s*(this\s+)?(over|off)|human\s+(agent|support|team)|enterprise\s+(support\s+)?team|team\s+member|connect(ing)?\s+you\s+with|pass(ing)?\s+(this\s+)?(to|along))\b/i;
      const isAiEscalation = isAiAgentReply && escalationKeywords.test(replyText);

      // Detect interim "working/thinking" messages from Sam — no buttons for these
      const workingPattern = /^(sam is (working|thinking|typing|processing)|working on (it|this|your)|let me (check|look|investigate)|one moment|hang tight|looking into)/i;
      const isInterimMessage = !isHumanAdmin && workingPattern.test(replyText.replace(/^[*_~`]+/, "").trim());

      const isAlreadyResolved = mapping.status === "resolved";

      if (isLastChunk) {
        if (isAlreadyResolved || isInterimMessage) {
          // Interim processing message — no buttons, no "continue chatting" hint
        } else if (isAiEscalation) {
          // Sam decided to route — no buttons, just a context note
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "_Sam has routed this to the Enterprise Support Team_" }],
          });
        } else if (hasIncidentIoAction) {
          // incident.io action detected — skip buttons here, they'll go in the status block
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: isHumanAdmin ? "_To continue chatting, please send a reply in the thread_" : "_To continue chatting with Sam, please send a reply in the thread_" }],
          });
        } else {
          // Normal reply — show feedback buttons
          const actionElements: Record<string, unknown>[] = [
            {
              type: "button",
              text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
              action_id: "feedback_positive",
              value: conversationId,
            },
          ];

          if (mapping.status !== "escalated" && mapping.status !== "escalated_pending") {
            actionElements.push({
              type: "button",
              text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
              action_id: "feedback_negative",
              value: conversationId,
            });
          }

          blocks.push({ type: "actions", elements: actionElements });
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: isHumanAdmin ? "_To continue chatting, please send a reply in the thread_" : "_To continue chatting with Sam, please send a reply in the thread_" }],
          });
        }
      }

      await postSlackMessage({ ...basePayload, text: chunks[i], blocks });
    }

    // Post incident.io status block if detected
    if (incidentStatusBlock.length > 0) {
      await postSlackMessage({
        ...basePayload,
        text: "📡 Lovable Status",
        blocks: incidentStatusBlock,
      });
    }

    // Post Intercom attachments to the Slack thread
    if (attachments.length > 0) {
      for (const att of attachments) {
        const isImage = att.content_type.startsWith("image/");
        const attBlocks: Record<string, unknown>[] = [];

        if (isImage) {
          attBlocks.push({
            type: "image",
            image_url: att.url,
            alt_text: att.name,
            title: { type: "plain_text", text: att.name },
          });
        } else {
          attBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `📎 <${att.url}|${att.name}>` },
          });
        }

        await postSlackMessage({
          ...basePayload,
          text: isImage ? att.name : `📎 ${att.name}`,
          blocks: attBlocks,
        });
      }
      console.log(`Posted ${attachments.length} attachment(s) to Slack thread`);
    }

    console.log(
      `Sent reply to Slack channel ${mapping.slack_channel_id}, thread ${mapping.slack_thread_ts}`
    );

    // If Sam auto-escalated, update status + reactions to match manual escalation
    const escalationKeywords2 = /\b(escalat|routing|transfer|hand(ing|ed)?\s*(this\s+)?(over|off)|human\s+(agent|support|team)|enterprise\s+(support\s+)?team|team\s+member|connect(ing)?\s+you\s+with|pass(ing)?\s+(this\s+)?(to|along))\b/i;
    const isAiEscalation2 = isAiAgentReply && escalationKeywords2.test(replyText);
    if (isAiEscalation2 && mapping.status !== "escalated" && mapping.status !== "escalated_pending" && mapping.status !== "resolved") {
      await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "eyes");
      await addReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "hourglass_flowing_sand");
      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("id", mapping.id);
      console.log(`Sam auto-escalated conversation ${conversationId} — status set to escalated`);

      // Reassign in Intercom to enterprise team inbox (mirrors manual 👎 escalation)
      if (appSettings?.intercom_inbox_id && appSettings?.intercom_assignee_id) {
        // Route to test inbox if this is a test conversation
        const escalInboxId = mapping.is_test && appSettings?.test_intercom_inbox_id
          ? appSettings.test_intercom_inbox_id
          : appSettings.intercom_inbox_id;

        await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            message_type: "assignment",
            type: "team",
            assignee_id: escalInboxId,
            admin_id: appSettings.intercom_assignee_id,
            body: "",
          }),
        });
        console.log(`Webhook: reassigned conversation ${conversationId} to team inbox ${escalInboxId}`);

        // NOTE: escalation deliberately does NOT convert the conversation to an
        // Intercom Ticket. Everything the Hub touches stays a Conversation; the
        // reassignment above is the escalation marker. (Removed 2026-09-01.)


        // Post as customer to mark ticket as "Waiting" in Intercom inbox
        try {
          if (mapping.intercom_contact_id) {
            await fetch(`https://api.intercom.io/conversations/${conversationId}/reply`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                message_type: "comment",
                type: "user",
                intercom_user_id: mapping.intercom_contact_id,
                body: "This ticket has been escalated — awaiting human support response.",
              }),
            });
            console.log(`Webhook: posted customer comment on ${conversationId} to mark as waiting`);
          }
        } catch (e) {
          console.error(`Webhook: failed to post escalation customer comment:`, e);
        }
      }
    } else if (isHumanAdmin && (mapping.status === "active" || mapping.status === "active_pending")) {
      // Human admin replied while status was still active — transition to escalated
      // so subsequent user replies get "reply forwarded" instead of "Sam is writing..."
      await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "eyes");
      await addReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "hourglass_flowing_sand");
      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("id", mapping.id);
      console.log(`Human admin replied to conversation ${conversationId} — status set to escalated`);
    } else if (mapping.status === "active_pending") {
      // Reset pending status back so the next user reply can trigger a new notice
      await supabase
        .from("conversation_mappings")
        .update({ status: "active" })
        .eq("id", mapping.id);
    } else if (mapping.status === "escalated_pending") {
      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("id", mapping.id);
    }

    // Auto-update conversation status based on who replied (applies after escalation/pending logic)
    // isHumanAdmin covers Joel/Kristina; also check for Sam (AI agent, author.type=admin but isKnownAiAgent)
    const isAdminReply = isHumanAdmin || (lastCommentPart?.author as any)?.type === "admin";
    if (mapping && (mapping.status !== "resolved" || isAdminReply)) {
      if (isAdminReply) {
        // Admin (Joel, Kristina) or AI agent (Sam) replied → awaiting customer
        // This also reopens resolved conversations for follow-up tracking
        await supabase
          .from("conversation_mappings")
          .update({ status: "awaiting_customer", resolved_at: null })
          .eq("id", mapping.id);
        console.log(`Set conversation ${conversationId} status to awaiting_customer (admin/AI reply${mapping.status === "resolved" ? ", reopened from resolved" : ""})`);
      } else {
        // Customer replied → awaiting support
        await supabase
          .from("conversation_mappings")
          .update({ status: "awaiting_support" })
          .eq("id", mapping.id)
          .neq("status", "resolved");
        console.log(`Set conversation ${conversationId} status to awaiting_support (customer reply)`);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in intercom-webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    // The HTTP response was already sent (200) before this ran, so Intercom will
    // NOT retry. The dead-letter row + alert is the replacement safety net.
    await recordWebhookFailure(supabase, rawBody, errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// ─── Transport layer ───
// Verify the signature, acknowledge Intercom immediately, then do the real work
// in the background. Everything above this point used to run INSIDE the request,
// which is what produced the 504s (slow Intercom/Slack calls holding the socket)
// and 503s (many long-lived instances at once).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const INTERCOM_WEBHOOK_SECRET = Deno.env.get("INTERCOM_WEBHOOK_SECRET");
  if (!INTERCOM_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "INTERCOM_WEBHOOK_SECRET not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const isValid = await verifyIntercomSignature(
    rawBody,
    req.headers.get("x-hub-signature"),
    INTERCOM_WEBHOOK_SECRET,
  );
  if (!isValid) {
    console.error("Invalid Intercom webhook signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const work = (async () => {
    const started = Date.now();
    try {
      const res = await handleEvent(rawBody);
      console.log(`[timing] handleEvent ${Date.now() - started}ms status=${res.status}`);
    } catch (err) {
      // handleEvent has its own catch; this covers anything thrown outside it.
      console.error("intercom-webhook background failure:", err);
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await recordWebhookFailure(supabase, rawBody, err instanceof Error ? err.message : String(err));
      } catch (inner) {
        console.error("dead-letter write failed:", inner);
      }
    }
  })();

  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);

  return new Response(JSON.stringify({ ok: true, accepted: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
