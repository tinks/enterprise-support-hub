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
const BOT_ICON = ":heart:";

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

  // Reject requests older than 5 minutes
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

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return new Response(
      JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const rawBody = await req.text();

  // Verify Slack signature
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

      // Send auto-reply
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          username: BOT_USERNAME,
          icon_emoji: BOT_ICON,
          text: "👋 Thanks for reaching out! To help us assist you faster, please reply in this thread with:\n\n• *Lovable account email* (optional)\n• *Project link or ID* (optional)\n• *Detailed description of your issue*",
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

    // ===== Handle message events in threads (context replies) =====
    if (event.type === "message" && !event.subtype && event.thread_ts) {
      const channelId = event.channel;
      const threadTs = event.thread_ts;
      const userId = event.user;

      // Check if we have a pending mapping for this thread
      const { data: mapping } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .eq("status", "awaiting_context")
        .maybeSingle();

      if (!mapping) {
        // Not a thread we're tracking, or already processed
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Only process replies from the original user
      if (userId !== mapping.slack_user_id) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const replyText = cleanSlackMarkup(event.text || "");

      // Extract context
      let contextEmail = "";
      let contextProjectLink = "";

      const emailMatch = replyText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (emailMatch) contextEmail = emailMatch[0];

      const projectMatch = replyText.match(
        /(?:https?:\/\/[^\s]*lovable[^\s]*|[a-f0-9-]{36})/i
      );
      if (projectMatch) contextProjectLink = projectMatch[0];

      // Build Intercom body
      const bodyParts: string[] = [];
      bodyParts.push(`Original message: ${mapping.original_message_text}`);
      if (contextEmail) bodyParts.push(`Lovable account email: ${contextEmail}`);
      if (contextProjectLink) bodyParts.push(`Project: ${contextProjectLink}`);
      bodyParts.push(`Additional context: ${replyText}`);
      const fullBody = bodyParts.join("\n\n");

      // Find or create Intercom contact
      const slackUserId = mapping.slack_user_id as string;
      let contactId: string;

      if (contextEmail) {
        const contactRes = await fetch("https://api.intercom.io/contacts/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: { field: "email", operator: "=", value: contextEmail },
          }),
        });
        const contactData = await contactRes.json();
        if (contactData.data?.length > 0) {
          contactId = contactData.data[0].id;
        } else {
          const createRes = await fetch("https://api.intercom.io/contacts", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              role: "user",
              external_id: slackUserId,
              email: contextEmail,
              name: contextEmail,
            }),
          });
          if (!createRes.ok) {
            console.error(`Failed to create Intercom contact: ${await createRes.text()}`);
            return new Response(JSON.stringify({ ok: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          contactId = (await createRes.json()).id;
        }
      } else {
        const contactRes = await fetch("https://api.intercom.io/contacts/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: { field: "external_id", operator: "=", value: slackUserId },
          }),
        });
        const contactData = await contactRes.json();
        if (contactData.data?.length > 0) {
          contactId = contactData.data[0].id;
        } else {
          const createRes = await fetch("https://api.intercom.io/contacts", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              role: "user",
              external_id: slackUserId,
              name: `Slack User ${slackUserId}`,
            }),
          });
          if (!createRes.ok) {
            console.error(`Failed to create Intercom contact: ${await createRes.text()}`);
            return new Response(JSON.stringify({ ok: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          contactId = (await createRes.json()).id;
        }
      }

      // Create Intercom conversation
      const convRes = await fetch("https://api.intercom.io/conversations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: { type: "user", id: contactId },
          body: fullBody,
        }),
      });

      if (!convRes.ok) {
        console.error(`Failed to create Intercom conversation: ${await convRes.text()}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const conversation = await convRes.json();
      const conversationId = conversation.conversation_id || conversation.id;

      // Assign if configured
      if (settings.intercom_assignee_id) {
        await fetch(
          `https://api.intercom.io/conversations/${conversationId}/parts`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              message_type: "assignment",
              type: "admin",
              assignee_id: settings.intercom_assignee_id,
              admin_id: settings.intercom_assignee_id,
            }),
          }
        );
      }

      // Update mapping
      await supabase
        .from("conversation_mappings")
        .update({
          intercom_conversation_id: conversationId,
          status: "active",
        })
        .eq("id", mapping.id);

      console.log(`Created Intercom conversation ${conversationId} from thread reply in ${channelId}/${threadTs}`);
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
