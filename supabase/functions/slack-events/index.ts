import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SLACK_API_URL = "https://slack.com/api";
const BOT_USERNAME = "Lovable Support Bot";
const BOT_ICON_URL = "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/lovable-logo.png";

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
      const slackUserId = event.user;

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

      const messageText = cleanSlackMarkup(event.text || "");

      // Send Block Kit message with buttons
      const buttonValue = `${channelId}|${threadTs}`;
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          username: BOT_USERNAME,
          icon_emoji: BOT_ICON,
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
      });

      console.log(`Created mapping for mention in ${channelId}/${threadTs}`);
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
