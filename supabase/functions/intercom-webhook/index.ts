import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature",
};

const SLACK_API_URL = "https://slack.com/api";

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

  try {
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
        // Helper to post a single Slack message
        async function postClosedMessage(payload: Record<string, unknown>) {
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

        const BOT_ICON_URL = "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/lovable-logo.png";
        const closedText = "✅ This issue has been marked as resolved. If you need further help, reply in this thread to start the conversation again.";

        await postClosedMessage({
          channel: mapping.slack_channel_id,
          thread_ts: mapping.slack_thread_ts,
          username: "Lovable Support Bot",
          icon_url: BOT_ICON_URL,
          text: closedText,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: closedText } }],
        });

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
    let iconUrl: string | undefined = "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/lovable-smiley-logo.png";
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

    // If human admin, try to find their Slack profile for avatar
    if (isHumanAdmin) {
      try {
        // Look up admin email from Intercom conversation parts
        const lastPart = conversationParts[conversationParts.length - 1];
        const adminEmail = lastPart?.author?.email;
        if (adminEmail) {
          const lookupRes = await fetch(`${SLACK_API_URL}/users.lookupByEmail?email=${encodeURIComponent(adminEmail)}`, {
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
          });
          const lookupData = await lookupRes.json();
          if (lookupData.ok && lookupData.user) {
            iconUrl = lookupData.user.profile?.image_72 || lookupData.user.profile?.image_48;
          }
        }
      } catch (e) {
        console.log("Could not look up Slack user for admin avatar:", e);
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
      username: adminName,
    };
    if (iconUrl) basePayload.icon_url = iconUrl;

    // Send each chunk as a separate threaded message to avoid Slack's "See more" collapse
    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const blocks: Record<string, unknown>[] = [
        { type: "section", text: { type: "mrkdwn", text: chunks[i] } },
      ];

      // Attach feedback buttons to the last message only
      if (isLastChunk && mapping.status !== "escalated") {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
              action_id: "feedback_positive",
              value: conversationId,
              style: "primary",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
              action_id: "feedback_negative",
              value: conversationId,
              style: "danger",
            },
          ],
        });
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
