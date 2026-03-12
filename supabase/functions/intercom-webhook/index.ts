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
    await fetch(`${SLACK_API_URL}/reactions.add`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
  } catch (e) {
    console.error(`Failed to add reaction ${emoji}:`, e);
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
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

        const closedText = "✅ This issue has been marked as resolved. If you need further help, reply in this thread to start the conversation again.";

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
    let adminName = "Lovable Support";
    let adminAvatarUrl: string | null = null;
    let slackUserId: string | null = null;
    let isHumanAdmin = false;

    if (conversationParts && conversationParts.length > 0) {
      const lastPart = conversationParts[conversationParts.length - 1];
      replyText = (lastPart.body || "").replace(/<[^>]*>/g, "").trim();
      const author = lastPart.author;
      if (author) {
        // Intercom author type: "admin" for humans, "bot" for bots
        if (author.type === "admin" && author.name) {
          adminName = author.name;
          isHumanAdmin = true;
          // Grab avatar from webhook payload if available
          if (author.avatar?.image_url) {
            adminAvatarUrl = author.avatar.image_url;
          }
        }
      }
    }

    if (!replyText) {
      console.log("No reply text found");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Strip sign-off lines and AI attribution
    replyText = replyText
      .replace(/\n*This message was composed by Lovable's AI Support Agent\.?\s*$/i, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards),?\n+\w+\s*$/i, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards),?\s*$/i, "")
      .trim();

    // Split long text into chunks at paragraph boundaries to avoid Slack's 3000-char block limit
    const MAX_CHUNK = 2900;
    const chunks: string[] = [];
    if (replyText.length <= MAX_CHUNK) {
      chunks.push(replyText);
    } else {
      let remaining = replyText;
      while (remaining.length > MAX_CHUNK) {
        let splitIdx = remaining.lastIndexOf("\n\n", MAX_CHUNK);
        if (splitIdx <= 0) splitIdx = remaining.lastIndexOf("\n", MAX_CHUNK);
        if (splitIdx <= 0) splitIdx = MAX_CHUNK;
        chunks.push(remaining.substring(0, splitIdx).trim());
        remaining = remaining.substring(splitIdx).trim();
      }
      if (remaining) chunks.push(remaining);
    }

    if (isHumanAdmin) {
      try {
        const lastPart = conversationParts[conversationParts.length - 1];
        const adminEmail = lastPart?.author?.email;
        if (adminEmail) {
          const lookupRes = await fetch(`${SLACK_API_URL}/users.lookupByEmail?email=${encodeURIComponent(adminEmail)}`, {
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          });
          const lookupData = await lookupRes.json();
          if (lookupData.ok && lookupData.user) {
            slackUserId = lookupData.user.id;
            // Use Slack profile picture if available
            const profile = lookupData.user.profile;
            if (profile?.image_192) {
              adminAvatarUrl = profile.image_192;
            } else if (profile?.image_72) {
              adminAvatarUrl = profile.image_72;
            }
          }
        }
        // Fallback: fetch avatar from Intercom API if still missing
        if (!adminAvatarUrl) {
          const adminId = lastPart?.author?.id;
          if (adminId) {
            const adminRes = await fetch(`https://api.intercom.io/admins/${adminId}`, {
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                Accept: "application/json",
              },
            });
            if (adminRes.ok) {
              const adminData = await adminRes.json();
              if (adminData.avatar?.image_url) {
                adminAvatarUrl = adminData.avatar.image_url;
              }
            }
          }
        }
      } catch (e) {
        console.log("Could not look up avatar for admin:", e);
      }
      // Final fallback: use the lovable smiley logo from public assets
      if (!adminAvatarUrl) {
        adminAvatarUrl = `${SUPABASE_URL}/storage/v1/object/public/public-assets/lovable-smiley-logo.png`;
      }
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
      ...(isHumanAdmin && { username: adminName }),
      ...(isHumanAdmin && adminAvatarUrl && { icon_url: adminAvatarUrl }),
    };

    // If testing mode, prepend debug info as first message
    if (testingMode) {
      await postSlackMessage({
        ...basePayload,
        text: `🔧 *Debug:* Intercom Conversation ID: \`${conversationId}\``,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `🔧 *Debug:* Intercom Conversation ID: \`${conversationId}\`` } }],
      });
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
