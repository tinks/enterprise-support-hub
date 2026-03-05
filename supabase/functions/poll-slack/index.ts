import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_API_URL = "https://slack.com/api";

const BOT_USERNAME = "Lovable Support Bot";
const BOT_ICON = ":heart:";

function cleanSlackMarkup(text: string): string {
  return text
    .replace(/<mailto:([^|>]+)\|[^>]+>/g, '$1')
    .replace(/<(https?:\/\/[^|>]+)\|[^>]+>/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<@[A-Z0-9]+>/g, '')
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const slackHeaders = {
    Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    // Load settings
    const { data: settings, error: settingsErr } = await supabase
      .from("settings")
      .select("*")
      .limit(1)
      .single();

    if (settingsErr || !settings) {
      return new Response(JSON.stringify({ error: "No settings configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const monitoredChannels = (settings.monitored_channels as string)
      .split(",")
      .map((c: string) => c.trim())
      .filter(Boolean);

    const targetUserId = settings.slack_bot_user_id as string;
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "No slack_bot_user_id configured in settings" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastPolledTs = (settings.last_polled_ts as string) || "0";
    const results: Array<{ channel: string; thread_ts: string; action: string }> = [];

    // ==================== PASS 1: Detect new mentions, send auto-reply ====================
    for (const channelId of monitoredChannels) {
      const historyRes = await fetch(
        `${SLACK_API_URL}/conversations.history?channel=${channelId}&oldest=${lastPolledTs}&limit=100`,
        { method: "GET", headers: slackHeaders }
      );

      if (!historyRes.ok) {
        console.error(`Slack history failed for ${channelId} [${historyRes.status}]: ${await historyRes.text()}`);
        continue;
      }

      const historyData = await historyRes.json();
      if (!historyData.ok || !historyData.messages) {
        console.error(`Slack history not ok for ${channelId}:`, historyData);
        continue;
      }

      const mentionPattern = `<@${targetUserId}>`;
      const mentionMessages = historyData.messages.filter(
        (msg: { text?: string; subtype?: string }) =>
          msg.text?.includes(mentionPattern) && !msg.subtype
      );

      for (const msg of mentionMessages) {
        const threadTs = msg.thread_ts || msg.ts;

        // Check if already processed
        const { data: existing } = await supabase
          .from("conversation_mappings")
          .select("id")
          .eq("slack_channel_id", channelId)
          .eq("slack_thread_ts", threadTs)
          .maybeSingle();

        if (existing) continue;

        const messageText = cleanSlackMarkup(msg.text as string);
        const slackUserId = msg.user as string;

        // Send auto-reply asking for context
        const autoReplyRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
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

        if (!autoReplyRes.ok) {
          console.error(`Failed to send auto-reply [${autoReplyRes.status}]: ${await autoReplyRes.text()}`);
        }

        // Store mapping with awaiting_context status
        await supabase.from("conversation_mappings").insert({
          slack_channel_id: channelId,
          slack_thread_ts: threadTs,
          intercom_conversation_id: "",
          status: "awaiting_context",
          original_message_text: messageText,
          slack_user_id: slackUserId,
        });

        results.push({ channel: channelId, thread_ts: threadTs, action: "auto_reply_sent" });
        console.log(`Sent auto-reply for ${channelId}/${threadTs}`);
      }
    }

    // ==================== PASS 2: Check awaiting_context threads for replies ====================
    const { data: pendingMappings } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("status", "awaiting_context");

    if (pendingMappings && pendingMappings.length > 0) {
      for (const mapping of pendingMappings) {
        const repliesRes = await fetch(
          `${SLACK_API_URL}/conversations.replies?channel=${mapping.slack_channel_id}&ts=${mapping.slack_thread_ts}&limit=50`,
          { method: "GET", headers: slackHeaders }
        );

        if (!repliesRes.ok) {
          console.error(`Failed to fetch replies for ${mapping.slack_channel_id}/${mapping.slack_thread_ts}`);
          continue;
        }

        const repliesData = await repliesRes.json();
        if (!repliesData.ok || !repliesData.messages) continue;

        const userReplies = repliesData.messages.filter(
          (m: { user?: string; bot_id?: string; ts: string }) =>
            m.user === mapping.slack_user_id && m.ts !== mapping.slack_thread_ts && !m.bot_id
        );

        const threadAge = Date.now() / 1000 - parseFloat(mapping.slack_thread_ts);
        const hasTimedOut = threadAge > 600;

        if (userReplies.length === 0 && !hasTimedOut) continue;

        let contextEmail = "";
        let contextProjectLink = "";
        const allReplyText: string[] = [];

        for (const reply of userReplies) {
          const text = cleanSlackMarkup((reply.text || "") as string);
          allReplyText.push(text);

          const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
          if (emailMatch && !contextEmail) contextEmail = emailMatch[0];

          const projectMatch = text.match(/(?:https?:\/\/[^\s]*lovable[^\s]*|[a-f0-9-]{36})/i);
          if (projectMatch && !contextProjectLink) contextProjectLink = projectMatch[0];
        }

        const contextDescription = allReplyText.join("\n").trim();

        const bodyParts: string[] = [];
        bodyParts.push(`Original message: ${mapping.original_message_text}`);
        if (contextEmail) bodyParts.push(`Lovable account email: ${contextEmail}`);
        if (contextProjectLink) bodyParts.push(`Project: ${contextProjectLink}`);
        if (contextDescription) bodyParts.push(`Additional context: ${contextDescription}`);
        if (hasTimedOut && userReplies.length === 0) {
          bodyParts.push("(No additional context provided — auto-created after timeout)");
        }
        const fullBody = bodyParts.join("\n\n");

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
              console.error(`Failed to create Intercom contact [${createRes.status}]: ${await createRes.text()}`);
              continue;
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
              console.error(`Failed to create Intercom contact [${createRes.status}]: ${await createRes.text()}`);
              continue;
            }
            contactId = (await createRes.json()).id;
          }
        }

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
          console.error(`Failed to create Intercom conversation [${convRes.status}]: ${await convRes.text()}`);
          continue;
        }

        const conversation = await convRes.json();
        const conversationId = conversation.conversation_id || conversation.id;

        if (settings.intercom_assignee_id) {
          const assignRes = await fetch(
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

          if (!assignRes.ok) {
            console.error(`Failed to assign conversation [${assignRes.status}]: ${await assignRes.text()}`);
          }
        }

        await supabase
          .from("conversation_mappings")
          .update({
            intercom_conversation_id: conversationId,
            status: "active",
          })
          .eq("id", mapping.id);

        results.push({ channel: mapping.slack_channel_id, thread_ts: mapping.slack_thread_ts, action: `intercom_created_${conversationId}` });
        console.log(`Created Intercom conversation ${conversationId} from ${mapping.slack_channel_id}/${mapping.slack_thread_ts} (email: ${contextEmail || "none"})`);
      }
    }

    // Update last_polled_ts
    const nowTs = (Date.now() / 1000).toString();
    await supabase
      .from("settings")
      .update({ last_polled_ts: nowTs })
      .eq("id", settings.id);

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, conversations: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in poll-slack:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
