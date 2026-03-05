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

    if (
      topic !== "conversation.admin.replied" &&
      topic !== "conversation.admin.single.reply"
    ) {
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

    const conversationParts = body.data?.item?.conversation_parts?.conversation_parts;
    let replyText = "";

    if (conversationParts && conversationParts.length > 0) {
      const lastPart = conversationParts[conversationParts.length - 1];
      replyText = (lastPart.body || "").replace(/<[^>]*>/g, "").trim();
    }

    if (!replyText) {
      console.log("No reply text found");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send threaded reply to Slack with feedback buttons
    const slackResponse = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: mapping.slack_channel_id,
        thread_ts: mapping.slack_thread_ts,
        username: "Lovable Support Bot",
        icon_emoji: ":heart:",
        text: replyText,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: replyText,
            },
          },
          {
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
          },
        ],
      }),
    });

    const slackData = await slackResponse.json();
    if (!slackResponse.ok || !slackData.ok) {
      throw new Error(
        `Slack API call failed [${slackResponse.status}]: ${JSON.stringify(slackData)}`
      );
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
