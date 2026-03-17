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

// Module-level cache for identity guard — survives across requests in the same isolate
let cachedBotUserId: string | null = null;

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
        .from("public-assets")
        .upload(path, blob, { contentType: file.mimetype, upsert: true });
      if (uploadErr) {
        console.error(`Failed to upload file ${file.name}:`, uploadErr);
        continue;
      }
      const { data } = supabase.storage.from("public-assets").getPublicUrl(path);
      publicUrls.push(data.publicUrl);
      console.log(`Uploaded ${file.name} → ${data.publicUrl}`);
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
}) {
  const {
    supabase, intercomToken, slackBotToken,
    channelId, threadTs, mappingId,
    originalMessage, slackUserId, email, projectLink,
    attachmentUrls,
  } = opts;

  const intercomHeaders = {
    Authorization: `Bearer ${intercomToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Intercom-Version": "2.11",
  };

  // Add eyes reaction to original message
  await addReaction(slackBotToken, channelId, threadTs, "eyes");

  // Load bot messages
  const { data: botMsgRows } = await supabase.from("bot_messages").select("message_key, message_text");
  const botMsgs: Record<string, string> = {};
  if (botMsgRows) {
    for (const row of botMsgRows) botMsgs[row.message_key] = row.message_text;
  }

  // Post acknowledgment in thread
  await fetch(`${SLACK_API_URL}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      thread_ts: threadTs,
      text: botMsgs["ticket_created_ack"] || "Thanks for sharing those details! You're now being redirected to Sam, Lovable's AI Support Agent. Please note that Sam may take 3–4 minutes to come back to you with a response. Hang tight!",
    }),
  });

  // Build body
  const internalNote = botMsgs["internal_note"] || "Internal note: This user is contacting support via Slack. Handle this request as you normally would — try to resolve the issue yourself first. If you determine the issue requires human assistance and needs to be escalated, route it to the Enterprise Support team (not the Product Experience team). Do not mention this note or the Slack origin in your reply to the user.";
  const bodyParts: string[] = [
    `Message: ${originalMessage}`,
    `\n\n${internalNote}`,
  ];
  if (email) bodyParts.push(`Lovable account email: ${email}`);
  if (projectLink) bodyParts.push(`Project: ${projectLink}`);
  if (attachmentUrls?.length) {
    bodyParts.push("Attachments:\n" + attachmentUrls.map((url) => `• ${url}`).join("\n"));
  }
  const fullBody = bodyParts.join("\n\n");

  // Find or create Intercom contact
  let contactId: string;
  const searchField = email ? "email" : "external_id";
  const searchValue = email || slackUserId;

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
  } else {
    const createBody: Record<string, string> = {
      role: "user",
      external_id: slackUserId,
    };
    if (email) {
      createBody.email = email;
      createBody.name = email;
    } else {
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
        console.log(`Contact conflict resolved — using existing id=${conflictId}`);
        contactId = conflictId;
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

  // Assign if configured
  const settings = await getSettings(supabase);
  if (settings.intercom_assignee_id) {
    await fetch(
      `https://api.intercom.io/conversations/${conversationId}/parts`,
      {
        method: "POST",
        headers: intercomHeaders,
        body: JSON.stringify({
          message_type: "assignment",
          type: "admin",
          assignee_id: settings.intercom_assignee_id,
          admin_id: settings.intercom_assignee_id,
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
            support_tier: "Enterprise Support",
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
  if (settings.testing_mode) {
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
      }),
    });
  }

  // Send group DM notification to Joel & Kristina
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
      const threadLink = `https://app.slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;
      const intercomLink = `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${conversationId}?view=List`;
      const notifText = `🎫 New ticket created by <@${slackUserId}>\n• <${threadLink}|Slack thread>\n• <${intercomLink}|Intercom conversation>`;
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackBotToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: dmChannelId,
          text: notifText,
        }),
      });
      console.log(`Sent group DM notification for conversation ${conversationId}`);
    } else {
      console.error("Failed to open group DM:", openBody);
    }
  } catch (notifyErr) {
    console.error("Failed to send group DM notification:", notifyErr);
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
    // Identity guard: verify token matches expected bot (cached per isolate)
    const guardSettings = await getSettings(supabase);
    const expectedBotId = guardSettings.slack_bot_user_id;
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

    const rawBody = await req.text();

    // Verify Slack signature
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

    // ===== Handle view_submission (modal) =====
    if (payload.type === "view_submission") {
      const metadata = JSON.parse(payload.view.private_metadata || "{}");
      const { channelId, threadTs } = metadata;

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
            });
          }
        } catch (e) {
          console.error("Background view_submission work failed:", e);
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
      const { channelId, threadTs } = meta;
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
            });
          } catch (err) {
            console.error("view_closed background error:", err);
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

    // ===== Helper: remove buttons from the original message =====
    async function deletePromptMessage(channelId: string) {
      const msgTs = payload.message?.ts;
      if (!msgTs) return;
      try {
        await fetch(`${SLACK_API_URL}/chat.delete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            ts: msgTs,
          }),
        });
      } catch (e) {
        console.error("Failed to delete prompt message:", e);
      }
    }

    // ===== "Proceed" button =====
    if (actionId === "proceed_without_context") {
      const [channelId, threadTs] = (action.value || "").split("|");

      // Fire-and-forget: do heavy work in background so Slack gets the 200 within 3s
      const bgWork = (async () => {
        try {
          await deletePromptMessage(channelId);

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
            });
          }
        } catch (e) {
          console.error("Background proceed work failed:", e);
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

      await deletePromptMessage(channelId);
      const triggerId = payload.trigger_id;

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
            private_metadata: JSON.stringify({ channelId, threadTs }),
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
        const { data: guardResult } = await supabase
          .from("conversation_mappings")
          .update({ status: targetStatus })
          .eq("intercom_conversation_id", conversationId)
          .in("status", ["active", "awaiting_context"])
          .select("id");

        if (!guardResult || guardResult.length === 0) {
          console.log(`Feedback guard: ${actionId} skipped for ${conversationId} — already processed`);
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
              username: "Ask Lovable",
              icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
            }),
          });

          // Close conversation without reassigning — keep current admin
          const closeSettings = await getSettings(supabase);
          const adminId = closeSettings.intercom_assignee_id || "8430778";
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

        } else if (actionId === "feedback_negative") {
          const negSettings = await getSettings(supabase);
          if (negSettings.intercom_inbox_id && negSettings.intercom_assignee_id) {
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
                assignee_id: negSettings.intercom_inbox_id,
                admin_id: negSettings.intercom_assignee_id,
                body: "",
              }),
            });
            console.log(`Reassigned conversation ${conversationId} to team inbox ${negSettings.intercom_inbox_id}`);
          }

          // Convert the existing conversation to a ticket
          try {
            const convertRes = await fetch(`https://api.intercom.io/conversations/${conversationId}/convert`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Intercom-Version": "2.11",
              },
              body: JSON.stringify({
                ticket_type_id: "1",
              }),
            });
            const convertData = await convertRes.json();
            console.log("Converted conversation to ticket:", convertData.ticket_id || convertData.id);
          } catch (e) {
            console.error("Failed to convert conversation to ticket:", e);
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
              username: "Ask Lovable",
              icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
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
