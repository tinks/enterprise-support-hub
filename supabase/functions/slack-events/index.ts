import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SLACK_API_URL = "https://slack.com/api";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!SLACK_SIGNING_SECRET) {
    return new Response(
      JSON.stringify({ error: "SLACK_SIGNING_SECRET not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const rawBody = await req.text();

  const slackSignature = req.headers.get("x-slack-signature");
  const slackTimestamp = req.headers.get("x-slack-request-timestamp");

  const isValid = await verifySlackSignature(
    rawBody,
    slackSignature,
    slackTimestamp,
    SLACK_SIGNING_SECRET
  );

  if (!isValid) {
    console.error("Invalid Slack signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = JSON.parse(rawBody);

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.type !== "event_callback") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = body.event;
    if (!event) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Slack event: type=${event.type}, subtype=${event.subtype || "none"}, channel=${event.channel}`);

    const slackHeaders = {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    };

    // Load settings
    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .limit(1)
      .single();

    // Identity guard: verify token matches expected bot
    const expectedBotId = settings?.slack_bot_user_id;
    if (expectedBotId) {
      const authCheck = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      });
      const authCheckData = await authCheck.json();
      if (!authCheckData.ok || authCheckData.user_id !== expectedBotId) {
        console.error(`IDENTITY GUARD: Token belongs to ${authCheckData.user_id || "unknown"}, expected ${expectedBotId}. Blocking.`);
        return new Response(JSON.stringify({ error: "Bot identity mismatch — refusing to process" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!settings) {
      console.error("No settings configured");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const monitoredChannels = (settings.monitored_channels as string)
      .split(",")
      .map((c: string) => c.trim())
      .filter(Boolean);

    // ===== Handle app_mention events =====
    if (event.type === "app_mention") {
      const channelId = event.channel;
      if (!monitoredChannels.includes(channelId)) {
        console.log(`Ignoring mention in non-monitored channel ${channelId}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const threadTs = event.thread_ts || event.ts;
      let slackUserId = event.user;

      // Check if already processed
      const { data: existing } = await supabase
        .from("conversation_mappings")
        .select("id")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .maybeSingle();

      if (existing) {
        console.log(`Already processed ${channelId}/${threadTs}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
            // Attribute ticket to the original poster (first message in thread)
            slackUserId = threadMessages[0].user || slackUserId;

            // Build a full transcript for Intercom context
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

      // Send Block Kit message with buttons
      const buttonValue = `${channelId}|${threadTs}`;
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          text: "Optionally add your Lovable account email and/or project link to improve support. If you don't want to share this, just click Proceed.",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "👋 Optionally add your Lovable account email and/or project link to improve support. If you don't want to share this, just click *Proceed*.",
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
              ],
            },
          ],
        }),
      });

      // Store mapping
      await supabase.from("conversation_mappings").insert({
        slack_channel_id: channelId,
        slack_thread_ts: threadTs,
        intercom_conversation_id: "",
        status: "awaiting_context",
        original_message_text: messageText,
        slack_user_id: slackUserId,
        is_test: settings.testing_mode ?? false,
      });

      console.log(`Created mapping for mention in ${channelId}/${threadTs}`);
    }

    // ===== Handle message events in threads (human reply → escalate to Intercom) =====
    if (event.type === "message" && !event.subtype && event.thread_ts && event.user) {
      const channelId = event.channel;
      const threadTs = event.thread_ts;

      // Ignore bot messages and messages from the bot itself
      if (event.bot_id || event.user === expectedBotId) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if there's an active mapping for this thread
      const { data: mapping } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .maybeSingle();

      if (mapping && mapping.intercom_conversation_id && mapping.status !== "resolved") {
        const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
        if (!INTERCOM_API_TOKEN) {
          console.error("INTERCOM_API_TOKEN not configured");
          return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const replyText = cleanSlackMarkup(event.text || "");
        console.log(`Thread reply in ${channelId}/${threadTs} from ${event.user}: "${replyText.substring(0, 100)}"`);

        // Get Intercom settings for admin ID (used for reassignment)
        const intercomSettings = await supabase.from("settings").select("*").limit(1).single();
        const adminId = intercomSettings.data?.intercom_assignee_id;

        // Forward message to Intercom as the customer (contact)
        if (mapping.intercom_contact_id) {
          const replyRes = await fetch(
            `https://api.intercom.io/conversations/${mapping.intercom_conversation_id}/reply`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Intercom-Version": "2.11",
              },
              body: JSON.stringify({
                message_type: "comment",
                type: "user",
                intercom_user_id: mapping.intercom_contact_id,
                body: replyText,
              }),
            }
          );
          if (!replyRes.ok) {
            console.error(`Failed to forward reply to Intercom: ${await replyRes.text()}`);
          } else {
            console.log(`Forwarded Slack reply as contact ${mapping.intercom_contact_id} to Intercom conversation ${mapping.intercom_conversation_id}`);
          }
        } else if (adminId) {
          // Fallback: no contact ID stored, send as admin
          const replyRes = await fetch(
            `https://api.intercom.io/conversations/${mapping.intercom_conversation_id}/reply`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Intercom-Version": "2.11",
              },
              body: JSON.stringify({
                message_type: "comment",
                type: "admin",
                admin_id: adminId,
                body: replyText,
              }),
            }
          );
          if (!replyRes.ok) {
            console.error(`Failed to forward reply to Intercom: ${await replyRes.text()}`);
          } else {
            console.log(`Forwarded Slack reply as admin to Intercom conversation ${mapping.intercom_conversation_id}`);
          }
        }

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

        // Update status to escalated
        if (mapping.status !== "escalated") {
          await removeReaction(SLACK_BOT_TOKEN, channelId, threadTs, "eyes");
          await addReaction(SLACK_BOT_TOKEN, channelId, threadTs, "hourglass_flowing_sand");

          // Reassign to enterprise team inbox
          if (intercomSettings.data?.intercom_inbox_id && adminId) {
            await fetch(
              `https://api.intercom.io/conversations/${mapping.intercom_conversation_id}/parts`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({
                  message_type: "assignment",
                  type: "team",
                  assignee_id: intercomSettings.data.intercom_inbox_id,
                  admin_id: adminId,
                  body: "",
                }),
              }
            );
          }

          await supabase
            .from("conversation_mappings")
            .update({ status: "escalated" })
            .eq("id", mapping.id);

          // Post escalation notice
          await fetch(`${SLACK_API_URL}/chat.postMessage`, {
            method: "POST",
            headers: slackHeaders,
            body: JSON.stringify({
              channel: channelId,
              thread_ts: threadTs,
              text: "🔄 Your reply has been sent. A member of our Enterprise support team will follow up shortly.",
            }),
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in slack-events:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
