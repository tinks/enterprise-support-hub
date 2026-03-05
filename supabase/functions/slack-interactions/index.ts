import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SLACK_API_URL = "https://slack.com/api";

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
    // Read raw body for signature verification
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

    // Slack sends interaction payloads as application/x-www-form-urlencoded
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

    const conversationId = action.value;
    const actionId = action.action_id;
    const channel = payload.channel?.id;
    const threadTs = payload.message?.thread_ts || payload.message?.ts;

    if (actionId === "feedback_positive") {
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channel,
          thread_ts: threadTs,
          username: "Lovable Support Bot",
          icon_emoji: ":heart:",
          text: "✅ Glad that helped! Marking as resolved.",
        }),
      });

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
          admin_id: (await getSettings(supabase)).intercom_assignee_id,
          body: "Resolved via Slack feedback (👍)",
        }),
      });

      await supabase
        .from("conversation_mappings")
        .update({ status: "resolved" })
        .eq("intercom_conversation_id", conversationId);

    } else if (actionId === "feedback_negative") {
      const settings = await getSettings(supabase);

      await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message_type: "assignment",
          type: "admin",
          assignee_id: "0",
          admin_id: settings.intercom_assignee_id,
          body: "Escalated to human support via Slack feedback (👎)",
        }),
      });

      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channel,
          thread_ts: threadTs,
          username: "Lovable Support Bot",
          icon_emoji: ":heart:",
          text: "🔄 Routing to a human support agent. Someone will follow up shortly.",
        }),
      });

      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("intercom_conversation_id", conversationId);
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

async function getSettings(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.from("settings").select("*").limit(1).single();
  return data || { intercom_assignee_id: "" };
}
