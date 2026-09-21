import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";
import { getSettings, invalidateSettings } from "../_shared/settings-cache.ts";
import { ATTACHMENT_BUCKET, attachmentUrl } from "../_shared/attachments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SLACK_API_URL = "https://slack.com/api";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ATTACHMENT_MAX_BYTES = MAX_FILE_SIZE;

// Inline attachment validation (kept in-file on purpose so every upload path
// shows its own allowlist / size enforcement).
const ALLOWED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif", "tiff",
  "mov", "mp4", "webm", "m4v", "avi", "mkv", "mp3", "m4a", "wav", "ogg",
  "pdf", "txt", "log", "md", "rtf", "csv", "tsv", "json", "yaml", "yml", "xml",
  "har", "html", "htm", "eml", "msg",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "numbers", "pages", "key",
  "zip", "gz", "tgz", "tar", "7z", "rar",
]);
const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "msi", "bat", "cmd", "com", "scr", "cpl", "jar", "app", "dmg",
  "pkg", "deb", "rpm", "apk", "sh", "bash", "zsh", "ps1", "vbs", "js", "mjs",
  "cjs", "py", "rb", "pl", "php", "so", "dylib", "bin", "iso",
]);

/** Returns null when the file is acceptable, or a reason string when it is not. */
function rejectAttachment(name: string, mimetype?: string): string | null {
  const i = name.lastIndexOf(".");
  const ext = i === -1 ? "" : name.slice(i + 1).toLowerCase();
  if (!ext) return "missing file extension";
  if (BLOCKED_EXTENSIONS.has(ext)) return `blocked file type .${ext}`;
  if (!ALLOWED_EXTENSIONS.has(ext)) return `file type .${ext} not allowed`;
  const mt = (mimetype ?? "").toLowerCase();
  if (mt.startsWith("application/x-") || mt.includes("executable")) {
    return `blocked content type ${mt}`;
  }
  return null;
}
const BOT_IDENTITY = {
  username: "Ask Lovable",
  icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
};

async function downloadAndUploadFiles(
  files: Array<{ url_private: string; name: string; mimetype: string; size?: number }>,
  slackBotToken: string,
  supabase: ReturnType<typeof createClient>,
  threadTs: string
): Promise<string[]> {
  const publicUrls: string[] = [];
  for (const file of files) {
    try {
      const rejection = rejectAttachment(file.name, file.mimetype);
      if (rejection) {
        console.log(`Skipping file ${file.name} — ${rejection}`);
        continue;
      }
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
      if (blob.size > ATTACHMENT_MAX_BYTES) {
        console.log(`Skipping file ${file.name} (${blob.size} bytes downloaded) — exceeds 50 MB limit`);
        continue;
      }
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

function cleanSlackMarkup(text: string): string {
  return text
    .replace(/<mailto:([^|>]+)\|[^>]+>/g, "$1")
    .replace(/<(https?:\/\/[^|>]+)\|[^>]+>/g, "$1")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<@[A-Z0-9]+>/g, "")
    .trim();
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
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(baseString)
  );
  const computed = `v0=${new TextDecoder().decode(hexEncode(new Uint8Array(sig)))}`;
  return computed === signature;
}

/**
 * All Slack event work. Runs AFTER the 200 ack, in background work, so a slow
 * Slack/Intercom call can never produce a 504. Slack will not retry anything
 * that fails in here, so the caller records failures in `slack_event_failures`.
 */
async function processEvent(
  body: any,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  SLACK_BOT_TOKEN: string,
  isSlackRetry: boolean,
  slackRetryNum: string | null,
  slackRetryReason: string,
): Promise<void> {
    const event = body.event;
    if (!event) return;
    if (isSlackRetry) {
      console.log(
        `[RETRY] Slack retry #${slackRetryNum} (reason=${slackRetryReason}) for event ts=${event.ts}`,
      );
    }

    console.log(`Slack event: type=${event.type}, subtype=${event.subtype || "none"}, channel=${event.channel}`);

    const slackHeaders = {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    };

    // Load settings
    const settings = await getSettings(supabase) as any;

    // Load bot messages
    const { data: botMsgRows } = await supabase.from("bot_messages").select("message_key, message_text");
    const botMessages: Record<string, string> = {};
    if (botMsgRows) {
      for (const row of botMsgRows) botMessages[row.message_key] = row.message_text;
    }

    // Identity guard: verify token matches expected bot
    const expectedBotId = settings?.slack_bot_user_id;
    if (expectedBotId) {
      const authCheck = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      });
      const authCheckData = await authCheck.json();
      if (!authCheckData.ok || authCheckData.user_id !== expectedBotId) {
        console.error(`IDENTITY GUARD: Token belongs to ${authCheckData.user_id || "unknown"}, expected ${expectedBotId}. Blocking.`);
        return;
      }
    }

    if (!settings) {
      console.error("No settings configured");
      return;
    }

    let monitoredChannels = (settings.monitored_channels as string)
      .split(",")
      .map((c: string) => c.trim())
      .filter(Boolean);

    // ===== Handle app_mention events =====
    if (event.type === "app_mention") {
      // Ignore mentions from other bots
      if (event.bot_id || event.subtype === "bot_message") {
        console.log(`Ignoring app_mention from bot (bot_id=${event.bot_id}, subtype=${event.subtype})`);
        return;
      }

      // Ignore mentions with no user ID (e.g. integrations without a real Slack user)
      if (!event.user) {
        console.log(`Ignoring app_mention with no user ID`);
        return;
      }

      const channelId = event.channel;

      // Auto-enable new channels on first mention so manual setup isn't required
      if (monitoredChannels.length > 0 && !monitoredChannels.includes(channelId)) {
        const updatedMonitoredChannels = [...new Set([...monitoredChannels, channelId])];
        const { error: autoEnableError } = await supabase
          .from("settings")
          .update({ monitored_channels: updatedMonitoredChannels.join(", ") })
          .eq("id", settings.id);
        invalidateSettings();

        if (autoEnableError) {
          console.error(`Failed to auto-add monitored channel ${channelId}:`, autoEnableError.message);
        } else {
          monitoredChannels = updatedMonitoredChannels;
          console.log(`Auto-added monitored channel ${channelId}`);
        }
      }

      const threadTs = event.thread_ts || event.ts;
      let slackUserId = event.user;

      // Resolve Slack user display name
      let slackUserName: string | null = null;
      if (slackUserId) {
        try {
          const userRes = await fetch(
            `${SLACK_API_URL}/users.info?user=${slackUserId}`,
            { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
          );
          const userData = await userRes.json();
          if (userData.ok && userData.user) {
            const u = userData.user;
            slackUserName = u.profile?.display_name || u.real_name || u.name || null;
          }
        } catch (e) {
          console.error("Failed to resolve Slack user name:", e);
        }
      }

      // Atomic claim: INSERT first, send message second (prevents TOCTOU race)
      const { data: claimed } = await supabase
        .from("conversation_mappings")
        .upsert(
          {
            slack_channel_id: channelId,
            slack_thread_ts: threadTs,
            intercom_conversation_id: "",
            status: "awaiting_context",
            original_message_text: cleanSlackMarkup(event.text || ""),
            slack_user_id: slackUserId,
            slack_user_name: slackUserName,
            is_test: settings.testing_mode ?? false,
          },
          { onConflict: "slack_channel_id,slack_thread_ts", ignoreDuplicates: true }
        )
        .select("id");

      if (!claimed || claimed.length === 0) {
        console.log(`app_mention already_processed ${channelId}/${threadTs}`);
        return;
      }

      const claimedId = claimed[0].id;

      // Auto-detect Lovable employees via email domain
      try {
        const empRes = await fetch(`${SLACK_API_URL}/users.info?user=${slackUserId}`, {
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        const empData = await empRes.json();
        const empEmail = empData.user?.profile?.email || "";
        if (empEmail.endsWith("@lovable.dev") && settings.auto_mark_employee_test) {
          await supabase.from("conversation_mappings").update({ is_test: true }).eq("id", claimedId);
          console.log(`Auto-marked ${slackUserId} (${empEmail}) as test — Lovable employee`);
        }
      } catch (e) {
        console.error("Failed to check Lovable employee status:", e);
      }

      let messageText = cleanSlackMarkup(event.text || "");

      // If the mention is a thread reply, fetch the parent message as the actual question
      if (event.thread_ts) {
        console.log(`Mention is a thread reply, fetching full thread for ${event.thread_ts}`);
        try {
          const repliesRes = await fetch(
            `${SLACK_API_URL}/conversations.replies?channel=${channelId}&ts=${event.thread_ts}&inclusive=true`,
            { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
          );
          const repliesData = await repliesRes.json();
          console.log(`conversations.replies response ok=${repliesData.ok}, messages=${repliesData.messages?.length}`);
          if (!repliesData.ok) {
            console.error(`conversations.replies error: ${repliesData.error}, needed: ${repliesData.needed}, metadata: ${JSON.stringify(repliesData.response_metadata)}`);
          }
          const threadMessages = (repliesData.messages || [])
            .filter((m: any) => !m.bot_id && m.subtype !== "bot_message");

          if (threadMessages.length > 0) {
            slackUserId = threadMessages[0].user || slackUserId;
            const transcript = threadMessages
              .map((m: any) => cleanSlackMarkup(m.text || ""))
              .filter(Boolean)
              .join("\n\n");
            messageText = transcript;
            console.log(`Built thread transcript (${threadMessages.length} msgs, ${messageText.length} chars) from user ${slackUserId}`);
          }
        } catch (err) {
          console.error("Failed to fetch thread messages:", err);
          messageText = `[incomplete context] ${messageText}`;
        }
      }

      // Update mapping with full context (thread transcript + real user)
      await supabase
        .from("conversation_mappings")
        .update({ original_message_text: messageText, slack_user_id: slackUserId })
        .eq("id", claimedId);

      // Send Block Kit message with buttons
      const buttonValue = `${channelId}|${threadTs}`;
      const contextPromptText = botMessages["context_prompt"] || "👋 Thank you for contacting the Enterprise Support Team. To help us resolve your issue as quickly and accurately as possible, please share your Lovable account email and your workspace or project name (or a link to it). If these aren't relevant to your question, feel free to click *Proceed*.";
      const promptRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          text: contextPromptText.replace(/\*/g, ""),
          ...BOT_IDENTITY,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: contextPromptText,
              },
            },
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
      const promptData = await promptRes.json();

      if (!promptData.ok) {
        console.error(`app_mention post_failed ${channelId}/${threadTs}: ${promptData.error}`);
      } else if (promptData.ts) {
        // Save the prompt message timestamp so context-reminder can update it later
        await supabase
          .from("conversation_mappings")
          .update({ prompt_message_ts: promptData.ts })
          .eq("id", claimedId);
      }

      console.log(`app_mention accepted ${channelId}/${threadTs}`);
    }

    // ===== Handle DM messages (workspace members only) =====
    if (
      event.type === "message" &&
      event.channel_type === "im" &&
      !event.thread_ts &&
      !event.bot_id &&
      event.user &&
      event.user !== expectedBotId &&
      (!event.subtype || event.subtype === "file_share")
    ) {
      const channelId = event.channel;
      const threadTs = event.ts; // DM message itself becomes the thread root
      const slackUserId = event.user;

      // Resolve Slack user display name for DM
      let slackUserNameDm: string | null = null;
      if (slackUserId) {
        try {
          const userRes = await fetch(
            `${SLACK_API_URL}/users.info?user=${slackUserId}`,
            { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
          );
          const userData = await userRes.json();
          if (userData.ok && userData.user) {
            const u = userData.user;
            slackUserNameDm = u.profile?.display_name || u.real_name || u.name || null;
          }
        } catch (e) {
          console.error("Failed to resolve Slack user name:", e);
        }
      }

      // Atomic claim (same pattern as app_mention)
      const { data: claimed } = await supabase
        .from("conversation_mappings")
        .upsert(
          {
            slack_channel_id: channelId,
            slack_thread_ts: threadTs,
            intercom_conversation_id: "",
            status: "awaiting_context",
            original_message_text: cleanSlackMarkup(event.text || ""),
            slack_user_id: slackUserId,
            slack_user_name: slackUserNameDm,
            is_test: settings.testing_mode ?? false,
          },
          { onConflict: "slack_channel_id,slack_thread_ts", ignoreDuplicates: true }
        )
        .select("id");

      if (!claimed || claimed.length === 0) {
        console.log(`dm already_processed ${channelId}/${threadTs}`);
        return;
      }

      const claimedId = claimed[0].id;

      // Auto-detect Lovable employees via email domain
      try {
        const empRes = await fetch(`${SLACK_API_URL}/users.info?user=${slackUserId}`, {
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        const empData = await empRes.json();
        const empEmail = empData.user?.profile?.email || "";
        if (empEmail.endsWith("@lovable.dev") && settings.auto_mark_employee_test) {
          await supabase.from("conversation_mappings").update({ is_test: true }).eq("id", claimedId);
          console.log(`DM: Auto-marked ${slackUserId} (${empEmail}) as test — Lovable employee`);
        }
      } catch (e) {
        console.error("DM: Failed to check Lovable employee status:", e);
      }

      // Send Block Kit message with buttons (same prompt as app_mention)
      const buttonValue = `${channelId}|${threadTs}`;
      const contextPromptText = botMessages["context_prompt"] || "👋 Thank you for contacting the Enterprise Support Team. To help us resolve your issue as quickly and accurately as possible, please share your Lovable account email and your workspace or project name (or a link to it). If these aren't relevant to your question, feel free to click *Proceed*.";
      const promptRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          text: contextPromptText.replace(/\*/g, ""),
          ...BOT_IDENTITY,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: contextPromptText,
              },
            },
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
      const promptData = await promptRes.json();

      if (!promptData.ok) {
        console.error(`dm post_failed ${channelId}/${threadTs}: ${promptData.error}`);
      } else if (promptData.ts) {
        await supabase
          .from("conversation_mappings")
          .update({ prompt_message_ts: promptData.ts })
          .eq("id", claimedId);
      }

      console.log(`dm accepted ${channelId}/${threadTs}`);
    }

    // ===== Handle message events in threads (human reply → escalate to Intercom) =====
    const isRegularMessage = !event.subtype || event.subtype === "file_share";
    if (event.type === "message" && isRegularMessage && event.thread_ts && event.user) {
      const channelId = event.channel;
      const threadTs = event.thread_ts;
      const eventTs = event.ts;

      // Ignore bot messages and messages from the bot itself
      if (event.bot_id || event.user === expectedBotId) {
        return;
      }

      // Idempotency: atomically claim this event.ts to prevent Slack retries from duplicating work
      const { data: mapping } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .maybeSingle();

      if (mapping && mapping.intercom_conversation_id && mapping.status !== "resolved") {
        // Atomic dedup: use DB function with FOR UPDATE to prevent race conditions
        const { data: claimResult } = await supabase
          .rpc("claim_slack_event", { p_mapping_id: mapping.id, p_event_ts: eventTs });

        if (claimResult === false) {
          console.log(
            `[DEDUP] Event ${eventTs} already claimed/processing for thread ${threadTs} in ${channelId}${isSlackRetry ? ` (slack retry #${slackRetryNum})` : ""} — acking 200`,
          );
          return;
        }
        console.log(`[DEDUP] Successfully claimed event ${eventTs} for thread ${threadTs} in ${channelId} (mapping=${mapping.id}, status=${mapping.status})`);

        // ---- Background: forward reply to Intercom (never blocks the ack) ----
        // If forwarding cannot deliver, release the dedup claim so a Slack
        // retry (or a later delivery) reprocesses instead of the reply being
        // silently lost. Conditional on the claim still being ours, so a
        // concurrent newer event is never clobbered.
        const releaseClaim = async (reason: string) => {
          try {
            const { data: released } = await supabase
              .from("conversation_mappings")
              .update({ last_processed_event_ts: null })
              .eq("id", mapping.id)
              .eq("last_processed_event_ts", eventTs)
              .select("id");
            console.log(
              `[DEDUP] Release claim ${eventTs} (${reason}): released=${!!(released && released.length)}`,
            );
          } catch (e) {
            console.error("Failed to release Slack event claim:", e);
          }
        };

        const forwardWork = async () => {
        console.log(`[BG] Processing thread reply ${eventTs} in ${channelId}/${threadTs} from ${event.user}`);

        try {
          const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
          if (!INTERCOM_API_TOKEN) {
            console.error("INTERCOM_API_TOKEN not configured");
            await releaseClaim("intercom_token_missing");
          } else {
            const replyText = cleanSlackMarkup(event.text || "");
            console.log(`Thread reply in ${channelId}/${threadTs} from ${event.user}: "${replyText.substring(0, 100)}"`);

            // Download and re-host any attached files
            let replyAttachmentUrls: string[] = [];
            if (event.files?.length) {
              replyAttachmentUrls = await downloadAndUploadFiles(event.files, SLACK_BOT_TOKEN, supabase, threadTs);
            }

            // Build reply body with attachment links
            let replyBody = replyText;
            if (replyAttachmentUrls.length) {
              replyBody += "\n\nAttachments:\n" + replyAttachmentUrls.map((url: string) => `• ${url}`).join("\n");
            }

            // Get Intercom settings for admin ID (used for reassignment)
            const adminId = settings?.intercom_assignee_id;

            // Resolve the replying user's identity for sender attribution
            let senderName = "";
            let senderEmail = "";
            try {
              const userInfoRes = await fetch(`${SLACK_API_URL}/users.info?user=${event.user}`, {
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
              });
              const userInfoData = await userInfoRes.json();
              if (userInfoData.ok && userInfoData.user) {
                senderName = userInfoData.user.profile?.display_name || userInfoData.user.real_name || userInfoData.user.name || "";
                senderEmail = userInfoData.user.profile?.email || "";
              }
            } catch (e) {
              console.error("Failed to resolve sender identity:", e);
            }

            const isOriginalRequester = event.user === mapping.slack_user_id;
            const isEmployee = senderEmail.endsWith("@lovable.dev");

            /**
             * Durable relay identity (Option B). Resolve the Slack sender's
             * email against the LIVE `teammates` roster instead of a hardcoded
             * map, so a reply relayed from Slack posts into Intercom under the
             * teammate's own admin id — not under the relay admin (Sam).
             * If the roster has no admin id for this sender we still relay
             * (never drop a reply), but we record the gap so the Action Center
             * surfaces it instead of failing silently.
             */
            // Resolve by slack_user_id FIRST (exact, survives Slack-profile
            // emails that differ from the roster email), then by email.
            let teammateAdminId: string | null = null;
            // Roster row for the sender, regardless of whether they have an
            // Intercom admin id. CSMs are relay-only (role='csm'): they are on
            // the roster so we KNOW who they are, but they have no admin id and
            // their replies never count as First Response (the SLA roster is
            // role='support' only). A relay-only match is NOT a gap.
            let teammateRole: string | null = null;
            {
              const pickId = (row: any) => {
                const id = row?.intercom_admin_id;
                return id ? String(id).trim() : null;
              };
              const bySlack = await supabase
                .from("teammates")
                .select("intercom_admin_id,name,active,role")
                .eq("slack_user_id", event.user)
                .eq("active", true)
                .limit(1)
                .maybeSingle();
              let row: any = bySlack.data ?? null;
              if (!row && senderEmail) {
                const byEmail = await supabase
                  .from("teammates")
                  .select("intercom_admin_id,name,active,role")
                  .ilike("email", senderEmail)
                  .eq("active", true)
                  .limit(1)
                  .maybeSingle();
                row = byEmail.data ?? null;
              }
              teammateAdminId = pickId(row);
              teammateRole = row?.role ? String(row.role) : null;
            }


            const recordRelayGap = async (reason: string) => {
              try {
                const { data: existing } = await supabase
                  .from("relay_attribution_gaps")
                  .select("occurrences")
                  .eq("slack_user_id", event.user)
                  .maybeSingle();
                await supabase.from("relay_attribution_gaps").upsert(
                  {
                    slack_user_id: event.user,
                    slack_email: senderEmail || null,
                    slack_display_name: senderName || null,
                    reason,
                    occurrences: ((existing as any)?.occurrences ?? 0) + 1,
                    last_conversation_id: mapping.intercom_conversation_id ?? null,
                    last_seen_at: new Date().toISOString(),
                    resolved_at: null,
                  },
                  { onConflict: "slack_user_id" },
                );
              } catch (e) {
                console.error("Failed to record relay attribution gap:", e);
              }
            };

            // Machine-readable marker: carry the sender's EMAIL alongside the
            // display name so the SLA engine can attribute historical/relay
            // parts without relying on display-name collisions.
            const relayTag = senderEmail
              ? `${senderName || senderEmail} (${senderEmail})`
              : senderName || event.user;

            // Determine reply type and body based on sender
            let replyPayload: Record<string, any>;

            if (isEmployee && adminId) {
              if (!teammateAdminId && !teammateRole) {
                await recordRelayGap("not_on_roster");
              }
              const prefixedBody = `*[From: ${relayTag} via Slack]*\n\n${replyBody}`;
              replyPayload = {
                message_type: "comment",
                type: "admin",
                admin_id: teammateAdminId || adminId,
                body: prefixedBody,
              };
              console.log(
                `Attributing reply as admin (employee: ${senderEmail}, adminId: ${teammateAdminId || adminId}, resolved=${!!teammateAdminId})`,
              );
            } else if (isOriginalRequester && mapping.intercom_contact_id) {
              replyPayload = {
                message_type: "comment",
                type: "user",
                intercom_user_id: mapping.intercom_contact_id,
                body: replyBody,
              };
              console.log(`Attributing reply as original requester (${event.user})`);
            } else if (mapping.intercom_contact_id) {
              const prefixedBody = `*[From: ${relayTag} via Slack]*\n\n${replyBody}`;
              replyPayload = {
                message_type: "comment",
                type: "user",
                intercom_user_id: mapping.intercom_contact_id,
                body: prefixedBody,
              };
              console.log(`Attributing reply as other user (${senderName || event.user})`);
            } else if (adminId) {
              if (isEmployee && !teammateAdminId && !teammateRole) {
                await recordRelayGap("not_on_roster");
              }
              const prefixedBody = senderName || senderEmail
                ? `*[From: ${relayTag} via Slack]*\n\n${replyBody}`
                : replyBody;
              replyPayload = {
                message_type: "comment",
                type: "admin",
                admin_id: teammateAdminId || adminId,
                body: prefixedBody,
              };
              console.log(`Attributing reply as admin fallback (adminId: ${teammateAdminId || adminId})`);
            } else {
              console.error("No intercom_contact_id or admin_id available to forward reply");
              replyPayload = null as any;
              await releaseClaim("no_reply_target");
            }


            if (replyPayload) {
              if (replyAttachmentUrls.length) {
                replyPayload.attachment_urls = replyAttachmentUrls;
              }

              // Always use conversation_id for replies — ticket IDs are not valid for the /reply endpoint
              const targetId = mapping.intercom_conversation_id;
              console.log(`[ROUTING] Using intercom_conversation_id=${targetId} for reply (ticket_id=${mapping.intercom_ticket_id || "none"}, status=${mapping.status})`);
              const intercomHeaders = {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Intercom-Version": "2.13",
              };

              let replyRes = await fetch(
                `https://api.intercom.io/conversations/${targetId}/reply`,
                { method: "POST", headers: intercomHeaders, body: JSON.stringify(replyPayload) }
              );

              // Retry paths: a user-type reply rejected by a ticket, or a
              // teammate admin id Intercom won't post as (no active seat).
              if (!replyRes.ok) {
                const errText = await replyRes.text();
                console.error(`[ROUTING] Failed to forward reply to ${targetId} (${replyRes.status}): ${errText}`);
                const retryAsRelayAdmin =
                  adminId &&
                  (replyPayload.type === "user" ||
                    (replyPayload.type === "admin" && teammateAdminId && replyPayload.admin_id === teammateAdminId));
                if (retryAsRelayAdmin) {
                  if (replyPayload.type === "admin") {
                    await recordRelayGap(`intercom_rejected_admin_id:${replyRes.status}`);
                  }
                  console.log(`[ROUTING] Retrying as relay admin for ${targetId}`);
                  const adminPayload = {
                    message_type: "comment",
                    type: "admin",
                    admin_id: adminId,
                    body: `*[From: ${relayTag} via Slack]*\n\n${replyBody}`,
                    ...(replyAttachmentUrls.length ? { attachment_urls: replyAttachmentUrls } : {}),
                  };
                  replyRes = await fetch(
                    `https://api.intercom.io/conversations/${targetId}/reply`,
                    { method: "POST", headers: intercomHeaders, body: JSON.stringify(adminPayload) }
                  );
                }
              }


              if (!replyRes.ok) {
                const errText2 = await replyRes.text();
                console.error(`Final failure forwarding reply to Intercom ${targetId} (${replyRes.status}): ${errText2}`);
                // Nothing was delivered — free the claim so a retry can re-run.
                await releaseClaim(`intercom_reply_failed:${replyRes.status}`);
                // Notify the Slack thread that forwarding failed
                await fetch(`${SLACK_API_URL}/chat.postMessage`, {
                  method: "POST",
                  headers: slackHeaders,
                  body: JSON.stringify({
                    channel: channelId,
                    thread_ts: threadTs,
                    text: "⚠️ Failed to forward this reply to the support ticket. Please reply directly in Intercom.",
                    ...BOT_IDENTITY,
                  }),
                });
              } else {
                console.log(`Forwarded Slack reply to Intercom ${targetId} (type: ${replyPayload.type})`);

                // Auto-update status based on who replied
                const newStatus = isEmployee ? "awaiting_customer" : "awaiting_support";
                await supabase
                  .from("conversation_mappings")
                  .update({ status: newStatus })
                  .eq("id", mapping.id)
                  .neq("status", "resolved");
                console.log(`Set conversation ${mapping.id} status to ${newStatus} (Slack reply from ${isEmployee ? "employee" : "customer"})`);
              }
            }
          }
        } catch (err) {
          console.error("Background thread-reply forwarding error:", err);
          await releaseClaim("forwarding_exception");
        }
        };



        // ---- Background: cosmetic work (button removal, status notices) ----
        const cosmeticWork = async () => {
          try {
            // Remove feedback buttons from thread messages
            try {
              const repliesRes = await fetch(
                `${SLACK_API_URL}/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=100`,
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
                      headers: slackHeaders,
                      body: JSON.stringify({
                        channel: channelId,
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

            // Status-based gating: atomically transition status to prevent duplicate notices
            if (mapping.status === "active") {
              const { data: updated } = await supabase
                .from("conversation_mappings")
                .update({ status: "active_pending" })
                .eq("id", mapping.id)
                .eq("status", "active")
                .select("id");

              if (updated && updated.length > 0) {
                await fetch(`${SLACK_API_URL}/chat.postMessage`, {
                  method: "POST",
                  headers: slackHeaders,
                  body: JSON.stringify({
                    channel: channelId,
                    thread_ts: threadTs,
                    text: "⏳ Sam is writing a response...",
                    ...BOT_IDENTITY,
                  }),
                });
              }
            } else if (mapping.status === "escalated") {
              const { data: updated } = await supabase
                .from("conversation_mappings")
                .update({ status: "escalated_pending" })
                .eq("id", mapping.id)
                .eq("status", "escalated")
                .select("id");

              if (updated && updated.length > 0) {
                const replyForwardedText = botMessages["reply_forwarded"] || "Thank you for your reply. We will get back to you as soon as possible.";
                await fetch(`${SLACK_API_URL}/chat.postMessage`, {
                  method: "POST",
                  headers: slackHeaders,
                  body: JSON.stringify({
                    channel: channelId,
                    thread_ts: threadTs,
                    text: replyForwardedText,
                    ...BOT_IDENTITY,
                  }),
                });
              }
            }
          } catch (err) {
            console.error("Background cosmetic work error:", err);
          }
        };

        // Ack Slack in milliseconds; forwarding + cosmetics run after the
        // response. Forwarding first so status transitions are ordered.
        EdgeRuntime.waitUntil(
          (async () => {
            await forwardWork();
            await cosmeticWork();
          })(),
        );
      }
    }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) return json({ error: "SLACK_BOT_TOKEN not configured" }, 500);

  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!SLACK_SIGNING_SECRET) return json({ error: "SLACK_SIGNING_SECRET not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const rawBody = await req.text();

  const isValid = await verifySlackSignature(
    rawBody,
    req.headers.get("x-slack-signature"),
    req.headers.get("x-slack-request-timestamp"),
    SLACK_SIGNING_SECRET,
  );
  if (!isValid) {
    console.error("Invalid Slack signature");
    return json({ error: "Invalid signature" }, 401);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (body.type === "url_verification") return json({ challenge: body.challenge });
  if (body.type !== "event_callback" || !body.event) return json({ ok: true });

  const slackRetryNum = req.headers.get("x-slack-retry-num");
  const isSlackRetry = slackRetryNum !== null;
  const slackRetryReason = req.headers.get("x-slack-retry-reason") || "unknown";

  // Durable idempotency claim. Slack retries carry the same event_id, so a
  // duplicate delivery short-circuits here instead of re-running the work.
  const eventId: string | null =
    body.event_id || (body.event?.ts ? `${body.event?.channel}:${body.event.ts}` : null);

  if (eventId) {
    const { data: claim, error: claimErr } = await supabase
      .from("slack_event_claims")
      .upsert(
        {
          event_id: eventId,
          event_type: body.event.type,
          channel_id: body.event.channel ?? null,
        },
        { onConflict: "event_id", ignoreDuplicates: true },
      )
      .select("event_id");

    if (claimErr) {
      console.error("slack_event_claims claim failed:", claimErr.message);
    } else if (!claim || claim.length === 0) {
      console.log(
        `[DEDUP] event ${eventId} already claimed${isSlackRetry ? ` (slack retry #${slackRetryNum}, ${slackRetryReason})` : ""} — acking 200`,
      );
      return json({ ok: true, deduped: true });
    }
  }

  // Ack Slack immediately; everything else happens after the response.
  EdgeRuntime.waitUntil(
    (async () => {
      const started = Date.now();
      try {
        await processEvent(body, supabase, SLACK_BOT_TOKEN, isSlackRetry, slackRetryNum, slackRetryReason);
        if (eventId) {
          await supabase
            .from("slack_event_claims")
            .update({ status: "done", completed_at: new Date().toISOString() })
            .eq("event_id", eventId);
        }
        console.log(`[TIMING] slack-events processed ${eventId} in ${Date.now() - started}ms`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? (error.stack || error.message) : String(error);
        console.error("slack-events background failure:", msg);
        try {
          await supabase.from("slack_event_failures").insert({
            event_id: eventId,
            event_type: body.event?.type ?? null,
            channel_id: body.event?.channel ?? null,
            error: msg.slice(0, 4000),
            payload: body,
          });
          if (eventId) {
            await supabase
              .from("slack_event_claims")
              .update({ status: "failed", completed_at: new Date().toISOString() })
              .eq("event_id", eventId);
          }
        } catch (e) {
          console.error("Failed to record slack event failure:", e);
        }
      }
    })(),
  );

  return json({ ok: true });
});
