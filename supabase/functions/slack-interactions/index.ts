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
}) {
  const {
    supabase, intercomToken, slackBotToken,
    channelId, threadTs, mappingId,
    originalMessage, slackUserId, email, projectLink,
  } = opts;

  const intercomHeaders = {
    Authorization: `Bearer ${intercomToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

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
      username: BOT_USERNAME,
      icon_url: BOT_ICON_URL,
      text: "✅ Thanks! Generating a response... Should take about 3-4 minutes.",
    }),
  });

  // Build body
  const bodyParts: string[] = [`Message: ${originalMessage}`];
  if (email) bodyParts.push(`Lovable account email: ${email}`);
  if (projectLink) bodyParts.push(`Project: ${projectLink}`);
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
    if (!createRes.ok) {
      console.error(`Failed to create Intercom contact: ${await createRes.text()}`);
      return;
    }
    contactId = (await createRes.json()).id;
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

  // Update mapping
  await supabase
    .from("conversation_mappings")
    .update({ intercom_conversation_id: conversationId, status: "active" })
    .eq("id", mappingId);

  // Tag conversation with "Slack" in Intercom
  try {
    await fetch("https://api.intercom.io/tags", {
      method: "POST",
      headers: intercomHeaders,
      body: JSON.stringify({
        name: "Slack",
        conversations: [{ id: conversationId }],
      }),
    });
    console.log(`Tagged Intercom conversation ${conversationId} with "Slack"`);
  } catch (tagErr) {
    console.error(`Failed to tag conversation ${conversationId}:`, tagErr);
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
        username: BOT_USERNAME,
        icon_url: BOT_ICON_URL,
        text: `🔧 *Debug:* Intercom Conversation ID: \`${conversationId}\``,
      }),
    });
  }
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

      // Look up mapping
      const { data: mapping } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .maybeSingle();

      if (mapping) {
        await createIntercomTicket({
          supabase,
          intercomToken: INTERCOM_API_TOKEN,
          slackBotToken: SLACK_BOT_TOKEN,
          channelId,
          threadTs,
          mappingId: mapping.id,
          originalMessage: mapping.original_message_text,
          slackUserId: mapping.slack_user_id,
          email: email || undefined,
          projectLink: projectLink || undefined,
        });
      }

      // Must return empty 200 to close the modal
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
    async function removeButtonsFromMessage(channelId: string, messageTs: string) {
      const msgTs = payload.message?.ts;
      if (!msgTs) return;
      try {
        // Get original message text to preserve it
        const originalText = payload.message?.blocks?.[0]?.text?.text || payload.message?.text || "";
        await fetch(`${SLACK_API_URL}/chat.update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            ts: msgTs,
            text: originalText,
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: originalText },
              },
            ],
          }),
        });
      } catch (e) {
        console.error("Failed to remove buttons:", e);
      }
    }

    // ===== "Proceed" button =====
    if (actionId === "proceed_without_context") {
      const [channelId, threadTs] = (action.value || "").split("|");

      await removeButtonsFromMessage(channelId, payload.message?.ts);

      const { data: mapping } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .maybeSingle();

      if (mapping) {
        await createIntercomTicket({
          supabase,
          intercomToken: INTERCOM_API_TOKEN,
          slackBotToken: SLACK_BOT_TOKEN,
          channelId,
          threadTs,
          mappingId: mapping.id,
          originalMessage: mapping.original_message_text,
          slackUserId: mapping.slack_user_id,
        });
      }

      return new Response("", { status: 200 });
    }

    // ===== "Add Details" button — open modal =====
    if (actionId === "add_details") {
      const [channelId, threadTs] = (action.value || "").split("|");

      await removeButtonsFromMessage(channelId, payload.message?.ts);
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
            close: { type: "plain_text", text: "Cancel" },
            blocks: [
              {
                type: "input",
                block_id: "email_block",
                optional: true,
                element: {
                  type: "plain_text_input",
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

    // Remove feedback buttons when clicked
    if (actionId === "feedback_positive" || actionId === "feedback_negative") {
      await removeButtonsFromMessage(channel, payload.message?.ts);

      // Reassign to enterprise team inbox on any feedback click
      const settings = await getSettings(supabase);
      if (settings.intercom_inbox_id && settings.intercom_assignee_id) {
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
            assignee_id: settings.intercom_inbox_id,
            admin_id: settings.intercom_assignee_id,
            body: "",
          }),
        });
        console.log(`Reassigned conversation ${conversationId} to team inbox ${settings.intercom_inbox_id}`);
      }
    }

    if (actionId === "feedback_positive") {
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          thread_ts: threadTs,
          username: BOT_USERNAME,
           icon_url: BOT_ICON_URL,
          text: "✅ Glad that helped! Marking as resolved.",
        }),
      });

      // Close conversation as unassigned using settings admin ID
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

      await supabase
        .from("conversation_mappings")
        .update({ status: "resolved" })
        .eq("intercom_conversation_id", conversationId);

    } else if (actionId === "feedback_negative") {
      // No Intercom changes — just notify human in Slack
      await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel,
          thread_ts: threadTs,
          username: BOT_USERNAME,
          icon_url: BOT_ICON_URL,
          text: "🔄 Escalating to human support. <@U091GANMA2U> will follow up shortly.",
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
