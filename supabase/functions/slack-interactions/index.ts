import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SLACK_API_URL = "https://slack.com/api";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const BOT_IDENTITY = {
  username: "Ask Lovable",
  icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
};

// Module-level caches — survive across requests in the same isolate
let cachedBotUserId: string | null = null;
// deno-lint-ignore no-explicit-any
let cachedSettings: any = null;

async function downloadAndUploadFiles(
  files: Array<{ url_private: string; name: string; mimetype: string; size?: number }>,
  slackBotToken: string,
  supabase: ReturnType<typeof createClient>,
  threadTs: string
): Promise<string[]> {
  const publicUrls: string[] = [];
  for (const file of files) {
    try {
      if (file.size && file.size > MAX_FILE_SIZE) {
        console.log(`Skipping file ${file.name} (${file.size} bytes) — exceeds 50 MB limit`);
        continue;
      }
      const res = await fetch(file.url_private, {
        headers: { Authorization: `Bearer ${slackBotToken}` },
      });
      if (!res.ok) {
        console.error(`Failed to download file ${file.name}: ${res.status}`);
        continue;
      }
      const blob = await res.blob();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `slack-attachments/${threadTs.replace(".", "_")}/${safeName}`;
      const { error: uploadErr } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, blob, { contentType: file.mimetype, upsert: true });
      if (uploadErr) {
        console.error(`Failed to upload file ${file.name}:`, uploadErr);
        continue;
      }
      const link = attachmentUrl(path);
      publicUrls.push(link);
      console.log(`Uploaded ${file.name} → ${link}`);
    } catch (e) {
      console.error(`Error processing file ${file.name}:`, e);
    }
  }
  return publicUrls;
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

async function verifySlackSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  signingSecret: string
): Promise<boolean> {
  if (!signature || !timestamp) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const computed = `v0=${new TextDecoder().decode(hexEncode(new Uint8Array(sig)))}`;
  return computed === signature;
}

// ===== Shared helper: create Intercom ticket =====
async function createIntercomTicket(opts: {
  supabase: ReturnType<typeof createClient>;
  intercomToken: string;
  slackBotToken: string;
  channelId: string;
  threadTs: string;
  mappingId: string;
  originalMessage: string;
  slackUserId: string;
  email?: string;
  projectLink?: string;
  attachmentUrls?: string[];
  promptMessageTs?: string; // If provided, update existing message instead of posting new one
}) {
  const {
    supabase, intercomToken, slackBotToken,
    channelId, threadTs, mappingId,
    originalMessage, slackUserId, email, projectLink,
    attachmentUrls, promptMessageTs,
  } = opts;

  // Auto-lookup Slack user email if not provided
  let resolvedEmail = email;
  if (!resolvedEmail) {
    try {
      const userRes = await fetch(`${SLACK_API_URL}/users.info?user=${slackUserId}`, {
        headers: { Authorization: `Bearer ${slackBotToken}` },
      });
      const userData = await userRes.json();
      if (userData.ok && userData.user?.profile?.email) {
        resolvedEmail = userData.user.profile.email;
        console.log(`Auto-resolved email for ${slackUserId}: ${resolvedEmail}`);
      }
    } catch (e) {
      console.error("Failed to lookup Slack user email:", e);
    }
  }

  const intercomHeaders = {
    Authorization: `Bearer ${intercomToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Intercom-Version": "2.13",
  };

  // Add eyes reaction to original message
  await addReaction(slackBotToken, channelId, threadTs, "eyes");

  // Load bot messages
  const { data: botMsgRows } = await supabase.from("bot_messages").select("message_key, message_text");
  const botMsgs: Record<string, string> = {};
  if (botMsgRows) {
    for (const row of botMsgRows) botMsgs[row.message_key] = row.message_text;
  }

  // Post or update acknowledgment in thread
  const ackText = botMsgs["ticket_created_ack"] || "Thanks for sharing those details! You're now being redirected to Sam, Lovable's AI Support Agent. Please note that Sam may take 3–4 minutes to come back to you with a response. Hang tight!";
  if (promptMessageTs) {
    // Update the existing context prompt message → single bot message in thread
    await fetch(`${SLACK_API_URL}/chat.update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        ts: promptMessageTs,
        text: ackText,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: ackText } }],
      }),
    });
  } else {
    // Fallback: post as new message
    await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        text: ackText,
        ...BOT_IDENTITY,
      }),
    });
  }

  // Build body
  const internalNote = botMsgs["internal_note"] || "Internal note: This enterprise user is contacting support via Slack. Handle this request as you normally would — try to resolve the issue yourself first. If you determine the issue requires human assistance and needs to be escalated, route it to the Enterprise Support team (not the Product Experience team). Do not mention this note or the Slack origin in your reply to the user.";
  const bodyParts: string[] = [
    `Message: ${originalMessage}`,
    `\n\n${internalNote}`,
  ];
  if (resolvedEmail) bodyParts.push(`Lovable account email: ${resolvedEmail}`);
  if (projectLink) bodyParts.push(`Project: ${projectLink}`);
  if (attachmentUrls?.length) {
    bodyParts.push("Attachments:\n" + attachmentUrls.map((url) => `• ${url}`).join("\n"));
  }
  const fullBody = bodyParts.join("\n\n");

  // Find or create Intercom contact
  let contactId: string;
  const searchField = resolvedEmail ? "email" : "external_id";
  const searchValue = resolvedEmail || slackUserId;

  const contactRes = await fetch("https://api.intercom.io/contacts/search", {
    method: "POST",
    headers: intercomHeaders,
    body: JSON.stringify({
      query: { field: searchField, operator: "=", value: searchValue },
    }),
  });
  const contactData = await contactRes.json();

  if (contactData.data?.length > 0) {
    contactId = contactData.data[0].id;
    // Update contact with email/name if provided and different
    if (resolvedEmail) {
      const existing = contactData.data[0];
      if (existing.email !== resolvedEmail || existing.name !== resolvedEmail) {
        await fetch(`https://api.intercom.io/contacts/${contactId}`, {
          method: "PUT",
          headers: intercomHeaders,
          body: JSON.stringify({ email: resolvedEmail, name: resolvedEmail }),
        });
      }
    }
  } else {
    // When email is provided, create contact by email only (no external_id)
    // to prevent merging different emails into the same contact via external_id conflicts.
    // Only use external_id as identifier when no email is available.
    const createBody: Record<string, string> = { role: "user" };
    if (resolvedEmail) {
      createBody.email = resolvedEmail;
      createBody.name = resolvedEmail;
    } else {
      createBody.external_id = slackUserId;
      createBody.name = `Slack User ${slackUserId}`;
    }

    const createRes = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers: intercomHeaders,
      body: JSON.stringify(createBody),
    });
    const createResText = await createRes.text();
    if (!createRes.ok) {
      // Handle conflict — contact already exists, extract ID from error
      let conflictId: string | null = null;
      try {
        const errData = JSON.parse(createResText);
        const conflictMsg = errData.errors?.[0]?.message || "";
        const idMatch = conflictMsg.match(/id=([a-f0-9]+)/);
        if (idMatch) conflictId = idMatch[1];
      } catch (_) { /* ignore parse error */ }

      if (conflictId) {
        console.log(`Contact conflict resolved — using existing id=${conflictId}, NOT overwriting email`);
        contactId = conflictId;
        // Do NOT overwrite email on the existing contact — it may belong to a different ticket
      } else {
        console.error(`Failed to create Intercom contact: ${createResText}`);
        return;
      }
    } else {
      contactId = JSON.parse(createResText).id;
    }
  }

  // Create conversation
  const convRes = await fetch("https://api.intercom.io/conversations", {
    method: "POST",
    headers: intercomHeaders,
    body: JSON.stringify({
      from: { type: "user", id: contactId },
      body: fullBody,
    }),
  });

  if (!convRes.ok) {
    console.error(`Failed to create Intercom conversation: ${await convRes.text()}`);
    return;
  }

  const conversation = await convRes.json();
  const conversationId = conversation.conversation_id || conversation.id;

    // Assign if configured — use cachedSettings if available, otherwise fetch
    if (!cachedSettings) {
      cachedSettings = await getSettings(supabase);
    }
    if (cachedSettings.intercom_assignee_id) {
      await fetch(
        `https://api.intercom.io/conversations/${conversationId}/parts`,
        {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify({
            message_type: "assignment",
            type: "admin",
            assignee_id: cachedSettings.intercom_assignee_id,
            admin_id: cachedSettings.intercom_assignee_id,
          }),
        }
      );
    }

    // Check if this is a test conversation to determine routing
    const { data: routingMapping } = await supabase
      .from("conversation_mappings")
      .select("is_test")
      .eq("id", mappingId)
      .maybeSingle();
    const isTestConversation = routingMapping?.is_test === true;

    // Also move to enterprise inbox so it's visible to the team from the start
    const inboxId = isTestConversation && cachedSettings.test_intercom_inbox_id
      ? cachedSettings.test_intercom_inbox_id
      : cachedSettings.intercom_inbox_id;
    if (inboxId) {
      await fetch(
        `https://api.intercom.io/conversations/${conversationId}/parts`,
        {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify({
            message_type: "assignment",
            type: "team",
            assignee_id: inboxId,
            admin_id: cachedSettings.intercom_assignee_id,
            body: "",
          }),
        }
      );
    }

  // Update mapping with conversation ID and contact ID
  await supabase
    .from("conversation_mappings")
    .update({ intercom_conversation_id: conversationId, intercom_contact_id: contactId, status: "active" })
    .eq("id", mappingId);

  // Set conversation custom attributes (Slack channel + support tier)
  try {
    // Resolve human-readable channel name from Slack
    const channelInfoRes = await fetch(
      `${SLACK_API_URL}/conversations.info?channel=${channelId}`,
      { headers: { Authorization: `Bearer ${slackBotToken}` } }
    );
    const channelInfo = await channelInfoRes.json();
    const channelName = channelInfo.ok ? channelInfo.channel.name : channelId;

    const attrRes = await fetch(
      `https://api.intercom.io/conversations/${conversationId}`,
      {
        method: "PUT",
        headers: intercomHeaders,
        body: JSON.stringify({
          custom_attributes: {
            "Slack channel": channelName,
            source: "Slack",
            support_tier: isTestConversation ? "Test" : "Enterprise Support",
          },
        }),
      }
    );
    if (attrRes.ok) {
      console.log(`Set custom attributes on conversation ${conversationId}: Slack channel=${channelName}`);
    } else {
      const attrBody = await attrRes.json();
      console.error(`Failed to set attributes on conversation ${conversationId}: ${attrRes.status}`, attrBody);
    }
  } catch (attrErr) {
    console.error(`Failed to set attributes on conversation ${conversationId}:`, attrErr);
  }

  console.log(`Created Intercom conversation ${conversationId} for mapping ${mappingId}`);

  // If testing mode is enabled, post debug message with Intercom conversation ID
  if (cachedSettings?.testing_mode) {
    await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: threadTs,
        text: `🔧 *Debug:* Intercom Conversation ID: \`${conversationId}\``,
        ...BOT_IDENTITY,
      }),
    });
  }

  // Send group DM notification to Joel & Kristina + post to ticket channel
  const TICKET_NOTIFY_CHANNEL_ID = "C0BDZAY8R8A";
  const threadLink = `https://app.slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;
  const intercomLink = `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${conversationId}?view=List`;
  const notifText = `🎫 New ticket created by <@${slackUserId}>\n• <${threadLink}|Slack thread>\n• <${intercomLink}|Intercom conversation>`;

  try {
    const notifyUserIds = "U0AFU714807,U091GANMA2U"; // Kristina, Joel
    const openRes = await fetch(`${SLACK_API_URL}/conversations.open`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ users: notifyUserIds }),
    });
    const openBody = await openRes.json();
    if (openBody.ok && openBody.channel?.id) {
      const dmChannelId = openBody.channel.id;
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: dmChannelId,
          text: notifText,
          ...BOT_IDENTITY,
        }),
      });
      console.log(`Sent group DM notification for conversation ${conversationId}`);
    } else {
      console.error("Failed to open group DM:", openBody);
    }
  } catch (notifyErr) {
    console.error("Failed to send group DM notification:", notifyErr);
  }

  // Also post to the ticket notifications channel (same message body as DM).
  try {
    const chRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: TICKET_NOTIFY_CHANNEL_ID,
        text: notifText,
        ...BOT_IDENTITY,
      }),
    });
    const chBody = await chRes.json();
    if (chBody.ok) {
      console.log(`[ticket-channel-notify] Posted to ${TICKET_NOTIFY_CHANNEL_ID} for conversation ${conversationId}`);
    } else {
      console.error(
        `[ticket-channel-notify] chat.postMessage to ${TICKET_NOTIFY_CHANNEL_ID} failed:`,
        chBody.error,
        chBody.error === "not_in_channel"
          ? "— invite the bot to the channel with /invite @<botname>"
          : "",
      );
    }
  } catch (chErr) {
    console.error(`[ticket-channel-notify] Network/throw posting to ${TICKET_NOTIFY_CHANNEL_ID}:`, chErr);
  }

  // ===== Poll for Sam's initial reply and relay to Slack =====
  // The Intercom webhook often doesn't fire for AI agent (Fin/Sam) replies,
  // so we proactively poll the conversation for new parts after creation.
  try {
    const POLL_DELAYS = [10_000, 20_000, 30_000, 60_000]; // 10s, 20s, 30s, 60s
    for (const delay of POLL_DELAYS) {
      await new Promise((r) => setTimeout(r, delay));

      // Check if the mapping is still active (not already resolved/escalated by another path)
      const { data: currentMapping } = await supabase
        .from("conversation_mappings")
        .select("status, last_intercom_part_id")
        .eq("id", mappingId)
        .single();
      // Stop polling if resolved AND a reply was already posted.
      // If resolved but no reply ever posted (e.g. merge/close race), keep polling to catch Sam's reply.
      if (!currentMapping || (currentMapping.status === "resolved" && currentMapping.last_intercom_part_id !== null)) {
        console.log(`Poll: mapping ${mappingId} status=${currentMapping?.status}, last_part=${currentMapping?.last_intercom_part_id}, stopping poll`);
        break;
      }

      // Fetch conversation parts from Intercom
      const partsRes = await fetch(
        `https://api.intercom.io/conversations/${conversationId}`,
        { headers: intercomHeaders }
      );
      if (!partsRes.ok) {
        console.error(`Poll: failed to fetch conversation ${conversationId}: ${partsRes.status}`);
        continue;
      }
      const convData = await partsRes.json();
      const parts = convData.conversation_parts?.conversation_parts || [];

      // Find admin/bot parts that haven't been relayed yet
      const lastRelayedId = currentMapping.last_intercom_part_id;
      const unrelayedParts = parts.filter((p: { part_type: string; author?: { type: string }; id?: string; body?: string }) => {
        if (!p.body) return false;
        // Only process public-facing comments — skip notes, assignments, and all other part types
        if (p.part_type !== "comment") return false;
        if (p.author?.type !== "admin" && p.author?.type !== "bot") return false;
        // Skip if already relayed (compare as numbers for reliable ordering)
        if (lastRelayedId && p.id && Number(p.id) <= Number(lastRelayedId)) return false;
        return true;
      });

      if (unrelayedParts.length === 0) {
        console.log(`Poll: no unrelayed parts yet for ${conversationId} (attempt after ${delay / 1000}s)`);
        continue;
      }

      // Relay each unrelayed part to Slack
      for (const part of unrelayedParts) {
        // Claim dedup marker FIRST — before posting to Slack — to prevent duplicate messages.
        // If another process (webhook or concurrent poll) already claimed this part, skip it entirely.
        if (part.id) {
          const partIdStr = String(part.id);
          const { data: dedupeResult } = await supabase
            .from("conversation_mappings")
            .update({ last_intercom_part_id: partIdStr })
            .eq("id", mappingId)
            .or(`last_intercom_part_id.is.null,last_intercom_part_id.lt.${partIdStr}`)
            .select("id");
          if (!dedupeResult || dedupeResult.length === 0) {
            console.log(`Poll: part ${part.id} was already relayed by another process for mapping ${mappingId}, skipping`);
            break;
          }
        }

        const rawBody = part.body || "";
        let replyText = rawBody
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n\n")
          .replace(/<\/li>/gi, "\n")
          .replace(/<li[^>]*>/gi, "• ")
          .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
          .replace(/<[^>]*>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        // Strip AI footers
        replyText = replyText
          .replace(/\n*This message was.*$/is, "")
          .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\n+\w+\s*$/i, "")
          .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\s*$/i, "")
          .trim();

        if (!replyText) continue;

        // Detect escalation keywords
        const escalationKeywords = /\b(escalat|routing|transfer|hand(ing|ed)?\s*(this\s+)?(over|off)|human\s+(agent|support|team)|enterprise\s+(support\s+)?team|team\s+member|connect(ing)?\s+you\s+with|pass(ing)?\s+(this\s+)?(to|along))\b/i;
        const isAiEscalation = escalationKeywords.test(replyText);

        // Detect duplicate ticket merge — Sam tells user they already have open tickets
        const isDuplicateTicket = /^I can see you already have open tickets about/i.test(replyText);

        const now = new Date();
        const timestamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
        const headerLabel = `🤖 *Sam* replied · ${timestamp}`;

        const blocks: Record<string, unknown>[] = [
          { type: "divider" },
          { type: "context", elements: [{ type: "mrkdwn", text: headerLabel }] },
          { type: "section", text: { type: "mrkdwn", text: replyText } },
        ];

        // Check if the reply author is a human admin (not Sam/bot)
        const authorName = part.author?.name || "";
        const isHumanAdmin = part.author?.type === "admin" && authorName !== "Sam" && authorName !== "Ask Lovable";
        const isEscalatedStatus = currentMapping.status === "escalated" || currentMapping.status === "escalated_pending";

        if (isAiEscalation) {
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "_Sam has routed this to the Enterprise Support Team_" }],
          });
        } else if (isDuplicateTicket) {
          // No buttons for duplicate ticket merges — conversation continues in original ticket
          console.log(`Poll: duplicate ticket detected for ${conversationId}, skipping buttons`);
        } else {
          const actionElements: Record<string, unknown>[] = [
            {
              type: "button",
              text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
              action_id: "feedback_positive",
              value: String(conversationId),
            },
          ];

          // Only show escalate button if not already escalated and not a human admin reply
          if (!isEscalatedStatus && !isHumanAdmin) {
            actionElements.push({
              type: "button",
              text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
              action_id: "feedback_negative",
              value: String(conversationId),
            });
          }

          blocks.push({ type: "actions", elements: actionElements });
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "_To continue chatting with Sam, please send a reply in the thread_" }],
          });
        }

        await fetch(`${SLACK_API_URL}/chat.postMessage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${slackBotToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            thread_ts: threadTs,
            text: replyText,
            blocks,
            ...BOT_IDENTITY,
          }),
        });

        console.log(`Poll: relayed Sam's reply (part ${part.id}) to Slack for conversation ${conversationId}`);

        // Handle auto-escalation status
        if (isAiEscalation) {
          await removeReaction(slackBotToken, channelId, threadTs, "eyes");
          await addReaction(slackBotToken, channelId, threadTs, "hourglass_flowing_sand");
          await supabase
            .from("conversation_mappings")
            .update({ status: "escalated" })
            .eq("id", mappingId);
          console.log(`Poll: Sam auto-escalated conversation ${conversationId}`);

          // Reassign in Intercom to enterprise team inbox (mirrors manual 👎 escalation)
          if (!cachedSettings) cachedSettings = await getSettings(supabase);
          if (cachedSettings.intercom_inbox_id && cachedSettings.intercom_assignee_id) {
            // Route to test inbox if this is a test conversation
            const { data: escMapping } = await supabase
              .from("conversation_mappings")
              .select("is_test")
              .eq("id", mappingId)
              .maybeSingle();
            const escInboxId = escMapping?.is_test && cachedSettings.test_intercom_inbox_id
              ? cachedSettings.test_intercom_inbox_id
              : cachedSettings.intercom_inbox_id;

            await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${intercomToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                message_type: "assignment",
                type: "team",
                assignee_id: escInboxId,
                admin_id: cachedSettings.intercom_assignee_id,
                body: "",
              }),
            });
            console.log(`Poll: reassigned conversation ${conversationId} to team inbox ${escInboxId}`);

            // NOTE: escalation deliberately does NOT convert the conversation to an
            // Intercom Ticket. Everything the Hub touches stays a Conversation; the
            // reassignment above is the escalation marker. (Removed 2026-09-01.)


            // Post as customer to mark ticket as "Waiting" in Intercom inbox
            try {
              const { data: pollMapping } = await supabase
                .from("conversation_mappings")
                .select("intercom_contact_id")
                .eq("intercom_conversation_id", conversationId)
                .maybeSingle();
              if (pollMapping?.intercom_contact_id) {
                await fetch(`https://api.intercom.io/conversations/${conversationId}/reply`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${intercomToken}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify({
                    message_type: "comment",
                    type: "user",
                    intercom_user_id: pollMapping.intercom_contact_id,
                    body: "This ticket has been escalated — awaiting human support response.",
                  }),
                });
                console.log(`Poll: posted customer comment on ${conversationId} to mark as waiting`);
              }
            } catch (e) {
              console.error(`Poll: failed to post escalation customer comment:`, e);
            }
          }
        }
      }

      // Successfully relayed — stop polling
      console.log(`Poll: successfully relayed reply for ${conversationId}, stopping poll`);
      break;
    }
  } catch (pollErr) {
    console.error(`Poll: error checking for Sam's reply on ${conversationId}:`, pollErr);
  }
}

async function collectThreadFiles(
  slackBotToken: string,
  channelId: string,
  threadTs: string
): Promise<Array<{ url_private: string; name: string; mimetype: string; size?: number }>> {
  const allFiles: Array<{ url_private: string; name: string; mimetype: string; size?: number }> = [];
  try {
    const repliesRes = await fetch(
      `${SLACK_API_URL}/conversations.replies?channel=${channelId}&ts=${threadTs}&inclusive=true&limit=100`,
      { headers: { Authorization: `Bearer ${slackBotToken}` } }
    );
    const repliesData = await repliesRes.json();
    if (repliesData.ok && repliesData.messages) {
      for (const msg of repliesData.messages) {
        if (msg.files?.length) {
          for (const f of msg.files) {
            if (f.url_private && f.name && f.mimetype) {
              allFiles.push({ url_private: f.url_private, name: f.name, mimetype: f.mimetype, size: f.size });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to collect thread files:", e);
  }
  console.log(`Collected ${allFiles.length} files from thread ${channelId}/${threadTs}`);
  return allFiles;
}

async function getSettings(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.from("settings").select("*").limit(1).single();
  return data || { intercom_assignee_id: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!SLACK_SIGNING_SECRET) {
    return new Response(JSON.stringify({ error: "SLACK_SIGNING_SECRET not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  try {
    // 1. Read body + verify signature FIRST (cheap, no network calls)
    const rawBody = await req.text();
    const slackSignature = req.headers.get("x-slack-signature");
    const slackTimestamp = req.headers.get("x-slack-request-timestamp");

    const isValid = await verifySlackSignature(rawBody, slackSignature, slackTimestamp, SLACK_SIGNING_SECRET);
    if (!isValid) {
      console.error("Invalid Slack interaction signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Identity guard (cached per isolate — no DB or network on warm requests)
    if (!cachedSettings) {
      cachedSettings = await getSettings(supabase);
    }
    const expectedBotId = cachedSettings.slack_bot_user_id;
    if (expectedBotId) {
      if (!cachedBotUserId) {
        const authCheck = await fetch("https://slack.com/api/auth.test", {
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        const authCheckData = await authCheck.json();
        if (!authCheckData.ok) {
          console.error(`IDENTITY GUARD: auth.test failed: ${authCheckData.error}`);
          return new Response(JSON.stringify({ error: "Bot identity check failed" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        cachedBotUserId = authCheckData.user_id;
      }
      if (cachedBotUserId !== expectedBotId) {
        console.error(`IDENTITY GUARD: Token belongs to ${cachedBotUserId}, expected ${expectedBotId}. Blocking.`);
        return new Response(JSON.stringify({ error: "Bot identity mismatch — refusing to process" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");

    if (!payloadStr) {
      return new Response(JSON.stringify({ error: "No payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(payloadStr);
    console.log("Slack interaction received:", JSON.stringify(payload).substring(0, 500));

    // ===== Handle CSAT remark modal submission =====
    if (payload.type === "view_submission" && payload.view?.callback_id === "csat_remark_modal") {
      try {
        const meta = JSON.parse(payload.view.private_metadata || "{}");
        const remark = payload.view.state?.values?.remark_block?.remark_input?.value?.trim();
        if (meta.mappingId && remark) {
          await supabase
            .from("conversation_mappings")
            .update({ csat_remark: remark } as any)
            .eq("id", meta.mappingId);

          // Surface the remark beyond the silent DB write — best effort, don't block modal close
          const surfaceWork = (async () => {
            try {
              const { data: mapping } = await supabase
                .from("conversation_mappings")
                .select("slack_channel_id, slack_thread_ts, intercom_conversation_id, csat_rating")
                .eq("id", meta.mappingId)
                .maybeSingle();
              if (!mapping) return;
              const rating = (mapping as any).csat_rating;
              const ratingLabel = rating ? `${rating}/5` : "rating";

              // 1. Post into the Slack thread so the support team sees it inline
              try {
                if ((mapping as any).slack_channel_id && (mapping as any).slack_thread_ts) {
                  const text = `💬 Customer remark on ${ratingLabel}: "${remark}"`;
                  await fetch(`${SLACK_API_URL}/chat.postMessage`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      channel: (mapping as any).slack_channel_id,
                      thread_ts: (mapping as any).slack_thread_ts,
                      text,
                      blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
                      ...BOT_IDENTITY,
                    }),
                  });
                }
              } catch (e) {
                console.error("CSAT remark Slack post failed:", e);
              }

              // 2. Add an internal note in Intercom so it's visible alongside the conversation
              try {
                const intercomConvId = (mapping as any).intercom_conversation_id;
                if (intercomConvId) {
                  if (!cachedSettings) cachedSettings = await getSettings(supabase);
                  const adminId = cachedSettings?.intercom_assignee_id;
                  if (adminId) {
                    const noteBody = `<p><strong>CSAT remark (${ratingLabel}):</strong> ${remark.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</p>`;
                    await fetch(`https://api.intercom.io/conversations/${intercomConvId}/reply`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                      },
                      body: JSON.stringify({
                        message_type: "note",
                        type: "admin",
                        admin_id: adminId,
                        body: noteBody,
                      }),
                    });
                  }
                }
              } catch (e) {
                console.error("CSAT remark Intercom note failed:", e);
              }
            } catch (e) {
              console.error("CSAT remark surfacing failed:", e);
            }
          })();
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
            EdgeRuntime.waitUntil(surfaceWork);
          }
        }
      } catch (e) {
        console.error("CSAT remark submission failed:", e);
      }
      return new Response("", { status: 200 });
    }

    // ===== Handle view_submission (modal) =====
    if (payload.type === "view_submission") {
      const metadata = JSON.parse(payload.view.private_metadata || "{}");
      const { channelId, threadTs, promptMessageTs: storedPromptTs } = metadata;

      const values = payload.view.state?.values || {};
      const email = values.email_block?.email_input?.value || "";
      const projectLink = values.project_block?.project_input?.value || "";

      // Fire-and-forget: do heavy work in background so Slack gets the 200 within 3s
      const bgWork = (async () => {
        try {
          // Post the submitted details as a threaded message so they're preserved
          if (email || projectLink) {
            const detailLines: string[] = [];
            if (email) detailLines.push(`*Email:* ${email}`);
            if (projectLink) detailLines.push(`*Project:* ${projectLink}`);
            const detailText = detailLines.join("\n");
            await fetch(`${SLACK_API_URL}/chat.postMessage`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: channelId,
                thread_ts: threadTs,
                text: detailText,
                blocks: [{ type: "section", text: { type: "mrkdwn", text: detailText } }],
                ...BOT_IDENTITY,
              }),
            });
          }

          // Atomic guard: only proceed if status is still awaiting_context
          const { data: updated } = await supabase
            .from("conversation_mappings")
            .update({ status: "processing" })
            .eq("slack_channel_id", channelId)
            .eq("slack_thread_ts", threadTs)
            .eq("status", "awaiting_context")
            .select()
            .maybeSingle();

          if (updated) {
            // Collect and re-host thread files
            const threadFiles = await collectThreadFiles(SLACK_BOT_TOKEN, channelId, threadTs);
            const attachmentUrls = threadFiles.length
              ? await downloadAndUploadFiles(threadFiles, SLACK_BOT_TOKEN, supabase, threadTs)
              : [];

            await createIntercomTicket({
              supabase,
              intercomToken: INTERCOM_API_TOKEN,
              slackBotToken: SLACK_BOT_TOKEN,
              channelId,
              threadTs,
              mappingId: updated.id,
              originalMessage: updated.original_message_text,
              slackUserId: updated.slack_user_id,
              email: email || undefined,
              projectLink: projectLink || undefined,
              attachmentUrls: attachmentUrls.length ? attachmentUrls : undefined,
              promptMessageTs: storedPromptTs,
            });
          }
        } catch (e) {
          console.error("Background view_submission work failed:", e);
          // Reset status so user can retry
          await supabase.from("conversation_mappings")
            .update({ status: "awaiting_context" })
            .eq("slack_channel_id", channelId)
            .eq("slack_thread_ts", threadTs)
            .eq("status", "processing");
          // Restore prompt with buttons
          await restorePromptWithButtons(channelId, threadTs, storedPromptTs);
          // Notify user
          try {
            await fetch(`${SLACK_API_URL}/chat.postMessage`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                channel: channelId,
                thread_ts: threadTs,
                text: "Something went wrong — please try again using the buttons above.",
                ...BOT_IDENTITY,
              }),
            });
          } catch (_) { /* best effort */ }
        }
      })();
      // Keep the isolate alive until background work completes
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(bgWork);
      }

      // Return immediately to close the modal (Slack 3s timeout)
      return new Response("", { status: 200 });
    }

    // ===== Handle view_closed (modal cancelled) =====
    if (payload.type === "view_closed") {
      const meta = JSON.parse(payload.view?.private_metadata || "{}");
      const { channelId, threadTs, promptMessageTs: storedPromptTs } = meta;
      if (channelId && threadTs) {
        const bgWork = (async () => {
          try {
            // Atomic guard: only proceed if status is still awaiting_context
            const { data: updated } = await supabase
              .from("conversation_mappings")
              .update({ status: "processing" })
              .eq("slack_channel_id", channelId)
              .eq("slack_thread_ts", threadTs)
              .eq("status", "awaiting_context")
              .select()
              .maybeSingle();

            if (!updated) {
              console.log("view_closed: mapping already processed or not found, skipping");
              return;
            }

            console.log("view_closed: modal cancelled, proceeding without context");
            // Collect and re-host thread files
            const threadFiles = await collectThreadFiles(SLACK_BOT_TOKEN, channelId, threadTs);
            const attachmentUrls = threadFiles.length
              ? await downloadAndUploadFiles(threadFiles, SLACK_BOT_TOKEN, supabase, threadTs)
              : [];

            await createIntercomTicket({
              supabase,
              intercomToken: INTERCOM_API_TOKEN,
              slackBotToken: SLACK_BOT_TOKEN,
              channelId,
              threadTs,
              mappingId: updated.id,
              originalMessage: updated.original_message_text,
              slackUserId: updated.slack_user_id,
              attachmentUrls: attachmentUrls.length ? attachmentUrls : undefined,
              promptMessageTs: storedPromptTs,
            });
          } catch (err) {
            console.error("view_closed background error:", err);
            // Reset status so user can retry
            await supabase.from("conversation_mappings")
              .update({ status: "awaiting_context" })
              .eq("slack_channel_id", channelId)
              .eq("slack_thread_ts", threadTs)
              .eq("status", "processing");
            // Restore prompt with buttons
            await restorePromptWithButtons(channelId, threadTs, storedPromptTs);
            // Notify user
            try {
              await fetch(`${SLACK_API_URL}/chat.postMessage`, {
                method: "POST",
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  channel: channelId,
                  thread_ts: threadTs,
                  text: "Something went wrong — please try again using the buttons above.",
                  ...BOT_IDENTITY,
                }),
              });
            } catch (_) { /* best effort */ }
          }
        })();
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
          EdgeRuntime.waitUntil(bgWork);
        }
      }
      return new Response("", { status: 200 });
    }

    // ===== Handle block_actions =====
    if (payload.type !== "block_actions") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const action = payload.actions?.[0];
    if (!action) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actionId = action.action_id;

    // ===== Handle CSAT rating click =====
    if (typeof actionId === "string" && actionId.startsWith("csat_")) {
      const rating = parseInt(action.value || actionId.slice(5), 10);
      const channelId = payload.channel?.id;
      const messageTs = payload.message?.ts;
      const triggerId = payload.trigger_id;
      const labels: Record<number, string> = { 1: "😠 Terrible", 2: "🙁 Bad", 3: "😐 OK", 4: "😀 Great", 5: "🤩 Amazing" };
      const label = labels[rating] || `${rating}`;

      if (rating >= 1 && rating <= 5 && channelId && messageTs) {
        const threadTs = payload.message?.thread_ts || messageTs;
        let { data: mapping } = await supabase
          .from("conversation_mappings")
          .select("id, csat_rating")
          .eq("csat_prompt_ts", messageTs)
          .maybeSingle();
        if (!mapping) {
          const res = await supabase
            .from("conversation_mappings")
            .select("id, csat_rating")
            .eq("slack_channel_id", channelId)
            .eq("slack_thread_ts", threadTs)
            .maybeSingle();
          mapping = res.data as any;
        }

        if (mapping) {
          const isFirstRating = !mapping.csat_rating;
          await supabase
            .from("conversation_mappings")
            .update({ csat_rating: rating, csat_rated_at: new Date().toISOString() } as any)
            .eq("id", mapping.id);

          await fetch(`${SLACK_API_URL}/chat.update`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              channel: channelId,
              ts: messageTs,
              text: `Thanks for rating: ${label}`,
              blocks: [{ type: "section", text: { type: "mrkdwn", text: `Thanks for rating: *${label}*` } }],
            }),
          });

          if (triggerId && isFirstRating) {
            try {
              await fetch(`${SLACK_API_URL}/views.open`, {
                method: "POST",
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  trigger_id: triggerId,
                  view: {
                    type: "modal",
                    callback_id: "csat_remark_modal",
                    private_metadata: JSON.stringify({ mappingId: mapping.id }),
                    title: { type: "plain_text", text: "Thanks for your rating" },
                    submit: { type: "plain_text", text: "Submit" },
                    close: { type: "plain_text", text: "Skip" },
                    blocks: [
                      {
                        type: "input",
                        block_id: "remark_block",
                        optional: true,
                        label: { type: "plain_text", text: "Anything else you'd like to share? (optional)" },
                        element: {
                          type: "plain_text_input",
                          action_id: "remark_input",
                          multiline: true,
                          max_length: 2000,
                        },
                      },
                    ],
                  },
                }),
              });
            } catch (e) {
              console.error("Failed to open CSAT remark modal:", e);
            }
          }
        }
      }
      return new Response("", { status: 200 });
    }

    // ===== Helper: get the prompt message ts from the interaction payload =====
    function getPromptMessageTs(): string | undefined {
      return payload.message?.ts || undefined;
    }

    // ===== Helper: update the prompt message to remove buttons (used by Add Details) =====
    async function updatePromptToProcessing(channelId: string) {
      const msgTs = getPromptMessageTs();
      if (!msgTs) return;
      try {
        await fetch(`${SLACK_API_URL}/chat.update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            ts: msgTs,
            text: "⏳ Gathering your details…",
            blocks: [{ type: "section", text: { type: "mrkdwn", text: "⏳ Gathering your details…" } }],
          }),
        });
      } catch (e) {
        console.error("Failed to update prompt message:", e);
      }
    }

    // ===== Helper: restore prompt with buttons after a failure =====
    async function restorePromptWithButtons(channelId: string, threadTs: string, promptMsgTs: string | undefined) {
      if (!promptMsgTs) return;
      const buttonValue = `${channelId}|${threadTs}`;
      const contextPromptText = "👋 Thank you for contacting the Enterprise Support Team. To help us resolve your issue as quickly and accurately as possible, please share your Lovable account email and your workspace or project name (or a link to it). If these aren't relevant to your question, feel free to click *Proceed*.";
      try {
        await fetch(`${SLACK_API_URL}/chat.update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            ts: promptMsgTs,
            text: contextPromptText.replace(/\*/g, ""),
            blocks: [
              { type: "section", text: { type: "mrkdwn", text: contextPromptText } },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Add Details", emoji: true },
                    action_id: "add_details",
                    value: buttonValue,
                    style: "primary",
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Proceed", emoji: true },
                    action_id: "proceed_without_context",
                    value: buttonValue,
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "Cancel", emoji: true },
                    action_id: "cancel_request",
                    value: buttonValue,
                  },
                ],
              },
            ],
          }),
        });
      } catch (e) {
        console.error("Failed to restore prompt with buttons:", e);
      }
    }

    // ===== "Proceed" button =====
    if (actionId === "proceed_without_context") {
      const [channelId, threadTs] = (action.value || "").split("|");
      const promptMsgTs = getPromptMessageTs();

      // Fire-and-forget: do heavy work in background so Slack gets the 200 within 3s
      const bgWork = (async () => {
        try {
          // Atomic guard: only proceed if status is still awaiting_context
          const { data: updated } = await supabase
            .from("conversation_mappings")
            .update({ status: "processing" })
            .eq("slack_channel_id", channelId)
            .eq("slack_thread_ts", threadTs)
            .eq("status", "awaiting_context")
            .select()
            .maybeSingle();

          if (updated) {
            // Collect and re-host thread files
            const threadFiles = await collectThreadFiles(SLACK_BOT_TOKEN, channelId, threadTs);
            const attachmentUrls = threadFiles.length
              ? await downloadAndUploadFiles(threadFiles, SLACK_BOT_TOKEN, supabase, threadTs)
              : [];

            await createIntercomTicket({
              supabase,
              intercomToken: INTERCOM_API_TOKEN,
              slackBotToken: SLACK_BOT_TOKEN,
              channelId,
              threadTs,
              mappingId: updated.id,
              originalMessage: updated.original_message_text,
              slackUserId: updated.slack_user_id,
              attachmentUrls: attachmentUrls.length ? attachmentUrls : undefined,
              promptMessageTs: promptMsgTs,
            });
          }
        } catch (e) {
          console.error("Background proceed work failed:", e);
          // Reset status so user can retry
          await supabase.from("conversation_mappings")
            .update({ status: "awaiting_context" })
            .eq("slack_channel_id", channelId)
            .eq("slack_thread_ts", threadTs)
            .eq("status", "processing");
          // Restore prompt with buttons
          await restorePromptWithButtons(channelId, threadTs, promptMsgTs);
          // Notify user
          try {
            await fetch(`${SLACK_API_URL}/chat.postMessage`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                channel: channelId,
                thread_ts: threadTs,
                text: "Something went wrong — please try again using the buttons above.",
                ...BOT_IDENTITY,
              }),
            });
          } catch (_) { /* best effort */ }
        }
      })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(bgWork);
      }

      return new Response("", { status: 200 });
    }

    // ===== "Cancel" button =====
    if (actionId === "cancel_request") {
      const [channelId, threadTs] = (action.value || "").split("|");
      const promptMsgTs = getPromptMessageTs();

      const bgWork = (async () => {
        try {
          // Atomic guard: only cancel if status is still awaiting_context
          const { data: updated } = await supabase
            .from("conversation_mappings")
            .update({ status: "cancelled" })
            .eq("slack_channel_id", channelId)
            .eq("slack_thread_ts", threadTs)
            .eq("status", "awaiting_context")
            .select()
            .maybeSingle();

          if (updated && promptMsgTs) {
            // Load bot messages for cancellation text
            const { data: botMsgRows } = await supabase
              .from("bot_messages")
              .select("message_key, message_text");
            const botMsgs: Record<string, string> = {};
            if (botMsgRows) {
              for (const r of botMsgRows) botMsgs[r.message_key] = r.message_text;
            }
            const cancelText = botMsgs["request_cancelled"] || "✅ Request cancelled. Feel free to reach out again anytime!";

            await fetch(`${SLACK_API_URL}/chat.update`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: channelId,
                ts: promptMsgTs,
                text: cancelText.replace(/\*/g, ""),
                blocks: [{ type: "section", text: { type: "mrkdwn", text: cancelText } }],
              }),
            });
          }
        } catch (e) {
          console.error("Cancel request failed:", e);
        }
      })();
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(bgWork);
      }

      return new Response("", { status: 200 });
    }

    // ===== "Add Details" button — open modal =====
    if (actionId === "add_details") {
      const [channelId, threadTs] = (action.value || "").split("|");
      const promptMsgTs = getPromptMessageTs();

      const triggerId = payload.trigger_id;

      // Open modal first (time-sensitive — Slack trigger_id expires in 3s)
      await fetch(`${SLACK_API_URL}/views.open`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          trigger_id: triggerId,
          view: {
            type: "modal",
            callback_id: "add_details_modal",
            private_metadata: JSON.stringify({ channelId, threadTs, promptMessageTs: promptMsgTs }),
            title: { type: "plain_text", text: "Add Details" },
            submit: { type: "plain_text", text: "Submit" },
            notify_on_close: true,
            close: { type: "plain_text", text: "Cancel" },
            blocks: [
              {
                type: "input",
                block_id: "email_block",
                optional: true,
                element: {
                  type: "email_text_input",
                  action_id: "email_input",
                  placeholder: { type: "plain_text", text: "your@email.com" },
                },
                label: { type: "plain_text", text: "Lovable Account Email" },
              },
              {
                type: "input",
                block_id: "project_block",
                optional: true,
                element: {
                  type: "plain_text_input",
                  action_id: "project_input",
                  placeholder: { type: "plain_text", text: "https://lovable.dev/projects/..." },
                },
                label: { type: "plain_text", text: "Project Link or ID" },
              },
            ],
          },
        }),
      });

      // Update prompt message to remove buttons (not time-sensitive)
      const bgUpdate = updatePromptToProcessing(channelId);
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(bgUpdate);
      }

      return new Response("", { status: 200 });
    }

    // ===== Existing feedback handlers =====
    const conversationId = action.value;
    const channel = payload.channel?.id;
    const threadTs = payload.message?.thread_ts || payload.message?.ts;

    // Fire-and-forget: do heavy work in background so Slack gets the 200 within 3s
    const bgWork = (async () => {
      try {
        // Load bot messages for feedback responses
        const { data: feedbackMsgRows } = await supabase.from("bot_messages").select("message_key, message_text");
        const feedbackBotMsgs: Record<string, string> = {};
        if (feedbackMsgRows) {
          for (const row of feedbackMsgRows) feedbackBotMsgs[row.message_key] = row.message_text;
        }

        // Remove feedback buttons (but keep the message text) when clicked
        if (actionId === "feedback_positive" || actionId === "feedback_negative") {
          const msgTs = payload.message?.ts;
          if (msgTs && payload.message?.blocks) {
            const blocksWithoutActions = payload.message.blocks.filter((b: { type: string }) => b.type !== "actions");
            try {
              await fetch(`${SLACK_API_URL}/chat.update`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel,
                  ts: msgTs,
                  text: payload.message.text || "",
                  blocks: blocksWithoutActions,
                }),
              });
            } catch (e) {
              console.error("Failed to remove feedback buttons:", e);
            }
          }
        }

        // Atomic guard: only the first click proceeds
        const targetStatus = actionId === "feedback_positive" ? "resolved" : "escalated";
        const updatePayload: Record<string, string> = { status: targetStatus };
        if (targetStatus === "resolved") {
          updatePayload.resolved_at = new Date().toISOString();
        }
        const { data: guardResult } = await supabase
          .from("conversation_mappings")
          .update(updatePayload)
          .eq("intercom_conversation_id", conversationId)
          .not("status", "in", "(resolved,cancelled)")
          .select("id, status");

        if (!guardResult || guardResult.length === 0) {
          // Either no mapping for this conversation, or it's already resolved/cancelled
          const { data: currentMapping } = await supabase
            .from("conversation_mappings")
            .select("status")
            .eq("intercom_conversation_id", conversationId)
            .maybeSingle();
          console.log(`Feedback guard: ${actionId} skipped for ${conversationId} — current status=${currentMapping?.status ?? "no-mapping"}`);
          return;
        }

        if (actionId === "feedback_positive") {
          await removeReaction(SLACK_BOT_TOKEN, channel, threadTs, "eyes");
          await removeReaction(SLACK_BOT_TOKEN, channel, threadTs, "hourglass_flowing_sand");
          await addReaction(SLACK_BOT_TOKEN, channel, threadTs, "white_check_mark");

          await fetch(`${SLACK_API_URL}/chat.postMessage`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel,
              thread_ts: threadTs,
              text: feedbackBotMsgs["feedback_positive"] || "Glad to hear your issue is resolved! We'll now close this conversation. Should you need any further assistance, please start a new thread. Replies to a closed conversation won't reach our team. We're always happy to help!",
              ...BOT_IDENTITY,
            }),
          });

          // Close conversation as the actual assignee so the human agent gets credit
          if (!cachedSettings) cachedSettings = await getSettings(supabase);
          let adminId = cachedSettings.intercom_assignee_id || "8430778";
          try {
            const convoRes = await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                Accept: "application/json",
                "Intercom-Version": "2.13",
              },
            });
            if (convoRes.ok) {
              const convoData = await convoRes.json();
              if (convoData.admin_assignee_id) {
                adminId = String(convoData.admin_assignee_id);
                console.log(`Closing conversation ${conversationId} as assignee ${adminId}`);
              }
            }
          } catch (e) {
            console.error("Failed to fetch conversation assignee, falling back to default:", e);
          }
          await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              message_type: "close",
              type: "admin",
              admin_id: adminId,
              body: "Resolved via Slack feedback (👍)",
            }),
          });

          // Post CSAT prompt (idempotent: skip if already rated/prompted)
          try {
            const mappingId = guardResult[0].id;
            const { data: csatCheck } = await supabase
              .from("conversation_mappings")
              .select("csat_rating, csat_prompt_ts")
              .eq("id", mappingId)
              .maybeSingle();
            if (csatCheck && !(csatCheck as any).csat_rating && !(csatCheck as any).csat_prompt_ts) {
              const csatRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel,
                  thread_ts: threadTs,
                  text: "Rate your conversation",
                  blocks: [
                    { type: "section", text: { type: "mrkdwn", text: "*Rate your conversation*" } },
                    {
                      type: "actions",
                      block_id: `csat_${mappingId}`,
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
                await supabase.from("conversation_mappings").update({ csat_prompt_ts: csatData.ts } as any).eq("id", mappingId);
              } else {
                console.error("Failed to post CSAT prompt (slack-interactions):", csatData);
              }
            }
          } catch (e) {
            console.error("CSAT post error (slack-interactions):", e);
          }

        } else if (actionId === "feedback_negative") {
          if (!cachedSettings) cachedSettings = await getSettings(supabase);
          if (cachedSettings.intercom_inbox_id && cachedSettings.intercom_assignee_id) {
            // Route to test inbox if this is a test conversation
            const { data: fbMapping } = await supabase
              .from("conversation_mappings")
              .select("is_test")
              .eq("intercom_conversation_id", conversationId)
              .maybeSingle();
            const fbInboxId = fbMapping?.is_test && cachedSettings.test_intercom_inbox_id
              ? cachedSettings.test_intercom_inbox_id
              : cachedSettings.intercom_inbox_id;

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
                assignee_id: fbInboxId,
                admin_id: cachedSettings.intercom_assignee_id,
                body: "",
              }),
            });
            console.log(`Reassigned conversation ${conversationId} to team inbox ${fbInboxId}`);
          }

          // NOTE: 👎 escalation deliberately does NOT convert the conversation to an
          // Intercom Ticket. Everything the Hub touches stays a Conversation; the
          // reassignment above is the escalation marker. (Removed 2026-09-01.)


          // Post as customer to mark ticket as "Waiting" in Intercom inbox
          try {
            const { data: escalMapping } = await supabase
              .from("conversation_mappings")
              .select("intercom_contact_id")
              .eq("intercom_conversation_id", conversationId)
              .maybeSingle();
            if (escalMapping?.intercom_contact_id) {
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
                  intercom_user_id: escalMapping.intercom_contact_id,
                  body: "This ticket has been escalated — awaiting human support response.",
                }),
              });
              console.log(`Posted customer comment on ${conversationId} to mark as waiting`);
            }
          } catch (e) {
            console.error("Failed to post escalation customer comment:", e);
          }

          await removeReaction(SLACK_BOT_TOKEN, channel, threadTs, "eyes");
          await addReaction(SLACK_BOT_TOKEN, channel, threadTs, "hourglass_flowing_sand");

          await fetch(`${SLACK_API_URL}/chat.postMessage`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel,
              thread_ts: threadTs,
              text: feedbackBotMsgs["escalation_notice"] || "Your query has been escalated to our Enterprise Support Team. A member of the team will follow up with you shortly.",
              ...BOT_IDENTITY,
            }),
          });
        }
      } catch (e) {
        console.error("Background feedback work failed:", e);
      }
    })();
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(bgWork);
    }

    return new Response("", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  } catch (error: unknown) {
    console.error("Error in slack-interactions:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
