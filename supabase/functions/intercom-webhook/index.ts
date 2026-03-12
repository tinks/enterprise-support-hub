import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature",
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
  const hubSignature = req.headers.get("x-hub-signature");

  const isValid = await verifyIntercomSignature(rawBody, hubSignature, INTERCOM_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid Intercom webhook signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  // Fetch settings for testing_mode
  const { data: appSettings } = await supabase.from("settings").select("*").limit(1).single();
  const testingMode = appSettings?.testing_mode === true;

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

    const REPLY_TOPICS = ["conversation.admin.replied", "conversation.admin.single.reply"];
    const CLOSED_TOPICS = ["conversation.admin.closed"];

    if (!REPLY_TOPICS.includes(topic) && !CLOSED_TOPICS.includes(topic)) {
      console.log(`Ignoring topic: ${topic}`);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conversationId = body.data?.item?.id;
    if (!conversationId) {
      console.error("No conversation ID found in webhook payload");
      return new Response(JSON.stringify({ error: "No conversation ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: mapping } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("intercom_conversation_id", String(conversationId))
      .maybeSingle();

    if (!mapping) {
      console.log(`No mapping found for Intercom conversation ${conversationId}`);
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
        const closedText = closedMsgRows?.message_text || "✅ This issue has been marked as resolved. If you need further help, reply in this thread to start the conversation again.";

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
          .update({ status: "resolved" })
          .eq("id", mapping.id);

        console.log(`Marked conversation ${conversationId} as resolved and notified Slack`);
      } else {
        console.log(`Conversation ${conversationId} already resolved, skipping`);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if conversation is already resolved (for reply topics)
    if (mapping.status === "resolved") {
      console.log(`Ignoring reply for ${conversationId} — status is already resolved`);
      return new Response(JSON.stringify({ ok: true, message: "Already closed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conversationParts = body.data?.item?.conversation_parts?.conversation_parts;
    let replyText = "";
    let adminName = "";
    let isHumanAdmin = false;

    if (conversationParts && conversationParts.length > 0) {
      const lastPart = conversationParts[conversationParts.length - 1];
      replyText = (lastPart.body || "").replace(/<[^>]*>/g, "").trim();
      const author = lastPart.author;
      // Intercom AI bots have type "bot"; human teammates have type "admin"
      if (author && author.type === "admin" && author.name) {
        adminName = author.name;
        isHumanAdmin = true;
      }
    }

    if (!replyText) {
      console.log("No reply text found");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip sign-off lines and AI attribution (handle various Intercom AI footers)
    replyText = replyText
      .replace(/\n*This message was.*$/is, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\n+\w+\s*$/i, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\s*$/i, "")
      .trim();

    // Prepend admin name for human replies so users know who responded
    if (isHumanAdmin && adminName) {
      replyText = `*${adminName}:*\n${replyText}`;
    }

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
    };

    // For human admin replies, fetch their avatar and override Slack identity
    if (isHumanAdmin && adminName && INTERCOM_API_TOKEN) {
      const lastPart = conversationParts[conversationParts.length - 1];
      const adminId = lastPart.author?.id;
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
    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const blocks: Record<string, unknown>[] = [
        { type: "section", text: { type: "mrkdwn", text: chunks[i] } },
      ];

      // Always show 👍 resolve button; show 👎 escalate only if not already escalated
      if (isLastChunk) {
        const actionElements: Record<string, unknown>[] = [
          {
            type: "button",
            text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
            action_id: "feedback_positive",
            value: conversationId,
            style: "primary",
          },
        ];

        if (mapping.status !== "escalated") {
          actionElements.push({
            type: "button",
            text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
            action_id: "feedback_negative",
            value: conversationId,
            style: "danger",
          });
        }

        blocks.push({ type: "actions", elements: actionElements });
      }

      await postSlackMessage({ ...basePayload, text: chunks[i], blocks });
    }

    console.log(
      `Sent reply to Slack channel ${mapping.slack_channel_id}, thread ${mapping.slack_thread_ts}`
    );

    // No reassignment after AI response — leave ticket as-is in Intercom

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in intercom-webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
