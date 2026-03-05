import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
    const body = await req.json();

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle event callbacks
    if (body.type === "event_callback") {
      const event = body.event;

      // Only handle app_mention events
      if (event.type !== "app_mention") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get settings
      const { data: settings } = await supabase
        .from("settings")
        .select("*")
        .limit(1)
        .single();

      if (!settings) {
        console.error("No settings configured");
        return new Response(JSON.stringify({ error: "No settings configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if this channel is monitored
      const monitoredChannels = settings.monitored_channels
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean);

      if (!monitoredChannels.includes(event.channel)) {
        console.log(`Channel ${event.channel} not monitored, skipping`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Use thread_ts if in a thread, otherwise use the message ts as thread start
      const threadTs = event.thread_ts || event.ts;

      // Check if we already have a mapping for this thread
      const { data: existingMapping } = await supabase
        .from("conversation_mappings")
        .select("*")
        .eq("slack_channel_id", event.channel)
        .eq("slack_thread_ts", threadTs)
        .maybeSingle();

      if (existingMapping) {
        // Thread already mapped — send as reply to existing Intercom conversation
        const replyText = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

        const replyRes = await fetch(
          `https://api.intercom.io/conversations/${existingMapping.intercom_conversation_id}/reply`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              message_type: "comment",
              type: "user",
              body: replyText,
              intercom_user_id: "the_end_user_placeholder",
            }),
          }
        );

        if (!replyRes.ok) {
          const errBody = await replyRes.text();
          console.error(`Intercom reply failed [${replyRes.status}]: ${errBody}`);
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Strip the bot mention from the message text
      const messageText = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

      // Get Slack user info for the message author
      const slackUserId = event.user;

      // Create Intercom conversation via API
      // First, create or find a contact
      const contactRes = await fetch("https://api.intercom.io/contacts/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query: {
            field: "external_id",
            operator: "=",
            value: slackUserId,
          },
        }),
      });

      const contactData = await contactRes.json();
      let contactId: string;

      if (contactData.data && contactData.data.length > 0) {
        contactId = contactData.data[0].id;
      } else {
        // Create a new contact
        const createContactRes = await fetch("https://api.intercom.io/contacts", {
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

        if (!createContactRes.ok) {
          const errBody = await createContactRes.text();
          throw new Error(`Failed to create Intercom contact [${createContactRes.status}]: ${errBody}`);
        }

        const newContact = await createContactRes.json();
        contactId = newContact.id;
      }

      // Create conversation
      const convRes = await fetch("https://api.intercom.io/conversations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: {
            type: "user",
            id: contactId,
          },
          body: messageText,
        }),
      });

      if (!convRes.ok) {
        const errBody = await convRes.text();
        throw new Error(`Failed to create Intercom conversation [${convRes.status}]: ${errBody}`);
      }

      const conversation = await convRes.json();
      const conversationId = conversation.conversation_id || conversation.id;

      // Assign to inbox and bot
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

      // Store the mapping
      await supabase.from("conversation_mappings").insert({
        slack_channel_id: event.channel,
        slack_thread_ts: threadTs,
        intercom_conversation_id: conversationId,
      });

      console.log(`Created Intercom conversation ${conversationId} for Slack thread ${threadTs}`);

      return new Response(JSON.stringify({ ok: true, conversation_id: conversationId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
