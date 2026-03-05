import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!SLACK_API_KEY) {
    return new Response(JSON.stringify({ error: "SLACK_API_KEY not configured" }), {
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
    const results: Array<{ channel: string; thread_ts: string; intercom_id: string }> = [];

    for (const channelId of monitoredChannels) {
      // Fetch recent messages using Slack connector gateway
      const historyRes = await fetch(
        `${SLACK_GATEWAY_URL}/conversations.history?channel=${channelId}&oldest=${lastPolledTs}&limit=100`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": SLACK_API_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      if (!historyRes.ok) {
        const errBody = await historyRes.text();
        console.error(`Slack history failed for ${channelId} [${historyRes.status}]: ${errBody}`);
        continue;
      }

      const historyData = await historyRes.json();
      if (!historyData.ok || !historyData.messages) {
        console.error(`Slack history not ok for ${channelId}:`, historyData);
        continue;
      }

      // Filter messages mentioning the target user
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

        // Strip the mention and create Intercom conversation
        const messageText = (msg.text as string).replace(/<@[A-Z0-9]+>/g, "").trim();
        const slackUserId = msg.user as string;

        // Find or create Intercom contact
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
        let contactId: string;

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
            const errBody = await createRes.text();
            console.error(`Failed to create Intercom contact [${createRes.status}]: ${errBody}`);
            continue;
          }

          const newContact = await createRes.json();
          contactId = newContact.id;
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
            body: messageText,
          }),
        });

        if (!convRes.ok) {
          const errBody = await convRes.text();
          console.error(`Failed to create Intercom conversation [${convRes.status}]: ${errBody}`);
          continue;
        }

        const conversation = await convRes.json();
        const conversationId = conversation.conversation_id || conversation.id;

        // Assign to bot if configured
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
            const errBody = await assignRes.text();
            console.error(`Failed to assign conversation [${assignRes.status}]: ${errBody}`);
          }
        }

        // Store mapping
        await supabase.from("conversation_mappings").insert({
          slack_channel_id: channelId,
          slack_thread_ts: threadTs,
          intercom_conversation_id: conversationId,
        });

        results.push({ channel: channelId, thread_ts: threadTs, intercom_id: conversationId });
        console.log(`Created Intercom conversation ${conversationId} from Slack ${channelId}/${threadTs}`);
      }
    }

    // Update last_polled_ts to now
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
