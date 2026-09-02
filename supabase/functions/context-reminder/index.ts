import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_API_URL = "https://slack.com/api";
const BOT_IDENTITY = { username: "Ask Lovable", icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/lovable-logo.png" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SLACK_BOT_TOKEN || !INTERCOM_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const slackHeaders = { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" };
  const intercomHeaders = {
    Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Intercom-Version": "2.13",
  };

  // Load bot messages
  const { data: botMsgRows } = await supabase.from("bot_messages").select("message_key, message_text");
  const botMsgs: Record<string, string> = {};
  if (botMsgRows) for (const r of botMsgRows) botMsgs[r.message_key] = r.message_text;

  // Load settings
  const { data: settingsRows } = await supabase.from("settings").select("*").limit(1);
  const settings = settingsRows?.[0];

  // Find conversations stuck in awaiting_context for 15+ minutes
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: staleRows, error } = await supabase
    .from("conversation_mappings")
    .select("*")
    .eq("status", "awaiting_context")
    .lt("created_at", fifteenMinAgo)
    .not("prompt_message_ts", "is", null)
    .is("intercom_conversation_id", null);

  if (error) {
    console.error("Failed to query stale conversations:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  if (!staleRows || staleRows.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  console.log(`Found ${staleRows.length} stale awaiting_context conversations`);
  let reminded = 0;
  let autoProceeded = 0;

  for (const row of staleRows) {
    const createdAt = new Date(row.created_at).getTime();
    const isOverThirtyMin = createdAt < new Date(thirtyMinAgo).getTime();

    if (isOverThirtyMin) {
      // ===== AUTO-PROCEED (30+ minutes) =====
      console.log(`Auto-proceeding ${row.slack_channel_id}/${row.slack_thread_ts} (${row.id})`);

      // Atomic status guard: only proceed if still awaiting_context
      const { data: updated, error: updateErr } = await supabase
        .from("conversation_mappings")
        .update({ status: "processing" })
        .eq("id", row.id)
        .eq("status", "awaiting_context")
        .select()
        .maybeSingle();

      if (!updated || updateErr) {
        console.log(`Skipping ${row.id} — status already changed`);
        continue;
      }

      // Update the prompt message if we have its timestamp
      if (row.prompt_message_ts) {
        const autoMsg = "⏳ No response received — automatically proceeding to create your support ticket...";
        await fetch(`${SLACK_API_URL}/chat.update`, {
          method: "POST",
          headers: slackHeaders,
          body: JSON.stringify({
            channel: row.slack_channel_id,
            ts: row.prompt_message_ts,
            text: autoMsg,
            ...BOT_IDENTITY,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: autoMsg } }],
          }),
        });
      }

      // Auto-lookup Slack user email
      let resolvedEmail: string | undefined;
      try {
        const userRes = await fetch(`${SLACK_API_URL}/users.info?user=${row.slack_user_id}`, {
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        const userData = await userRes.json();
        if (userData.ok && userData.user?.profile?.email) {
          resolvedEmail = userData.user.profile.email;
          console.log(`Auto-resolved email for ${row.slack_user_id}: ${resolvedEmail}`);
        }
      } catch (e) {
        console.error("Failed to lookup Slack user email:", e);
      }

      // ===== Create Intercom ticket (same logic as "Proceed" in slack-interactions) =====

      // Add eyes reaction
      await fetch(`${SLACK_API_URL}/reactions.add`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({ channel: row.slack_channel_id, timestamp: row.slack_thread_ts, name: "eyes" }),
      });

      // Find or create Intercom contact
      let contactId: string | undefined;
      const displayName = resolvedEmail?.split("@")[0] || `Slack User ${row.slack_user_id}`;

      if (resolvedEmail) {
        // Search by email
        const searchRes = await fetch("https://api.intercom.io/contacts/search", {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify({ query: { field: "email", operator: "=", value: resolvedEmail } }),
        });
        const searchData = await searchRes.json();
        if (searchData.data?.length > 0) {
          contactId = searchData.data[0].id;
        }
      }

      if (!contactId) {
        // Create contact
        const createBody: Record<string, string> = { role: "user", name: displayName };
        if (resolvedEmail) createBody.email = resolvedEmail;
        const createRes = await fetch("https://api.intercom.io/contacts", {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify(createBody),
        });
        const createData = await createRes.json();
        if (createRes.status === 409 && createData.errors?.[0]?.message) {
          const match = createData.errors[0].message.match(/id=([a-f0-9]+)/);
          if (match) contactId = match[1];
        } else {
          contactId = createData.id;
        }
      }

      if (!contactId) {
        console.error(`Failed to find/create Intercom contact for ${row.id}`);
        // Reset status so it can be retried
        await supabase.from("conversation_mappings").update({ status: "awaiting_context" }).eq("id", row.id);
        continue;
      }

      // Update mapping with contact ID
      await supabase
        .from("conversation_mappings")
        .update({ intercom_contact_id: contactId })
        .eq("id", row.id);

      // Build conversation body
      const internalNote = botMsgs["internal_note"] || "This enterprise user reached out via Slack Enterprise Support.";
      const bodyParts = [internalNote, row.original_message_text || "(no message)"];
      const conversationBody = bodyParts.join("\n\n---\n\n");

      // Create Intercom conversation
      const convoRes = await fetch("https://api.intercom.io/conversations", {
        method: "POST",
        headers: intercomHeaders,
        body: JSON.stringify({
          from: { type: "user", id: contactId },
          body: conversationBody,
        }),
      });
      const convoData = await convoRes.json();
      const conversationId = convoData.conversation_id || convoData.id;

      if (!conversationId) {
        console.error(`Failed to create Intercom conversation for ${row.id}:`, convoData);
        await supabase.from("conversation_mappings").update({ status: "awaiting_context" }).eq("id", row.id);
        continue;
      }

      // Update mapping with conversation ID
      await supabase
        .from("conversation_mappings")
        .update({ intercom_conversation_id: conversationId, status: "active" })
        .eq("id", row.id);

      // Assign to AI agent (Sam) — route to test inbox if is_test
      if (settings?.intercom_assignee_id) {
        await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify({
            message_type: "assignment",
            type: "admin",
            admin_id: settings.intercom_assignee_id,
            assignee_id: settings.intercom_assignee_id,
          }),
        });
      }

      // Also move to enterprise inbox so it's visible to the team from the start
      const inboxId = row.is_test && settings?.test_intercom_inbox_id
        ? settings.test_intercom_inbox_id
        : settings?.intercom_inbox_id;
      if (inboxId && settings?.intercom_assignee_id) {
        await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify({
            message_type: "assignment",
            type: "team",
            assignee_id: inboxId,
            admin_id: settings.intercom_assignee_id,
            body: "",
          }),
        });
      }

      // Set custom attributes — tag as Test if is_test
      const supportTier = row.is_test ? "Test" : "Enterprise Support";

      // Set custom attributes
      try {
        // Channel name lookup
        const channelInfoRes = await fetch(`${SLACK_API_URL}/conversations.info?channel=${row.slack_channel_id}`, {
          headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
        });
        const channelInfo = await channelInfoRes.json();
        const channelName = channelInfo.ok ? channelInfo.channel?.name || row.slack_channel_id : row.slack_channel_id;

        await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
          method: "PUT",
          headers: intercomHeaders,
          body: JSON.stringify({
            custom_attributes: {
              "Slack Channel": `#${channelName}`,
              "Enterprise Support": !row.is_test,
              support_tier: supportTier,
            },
          }),
        });
      } catch (e) {
        console.error("Failed to set custom attributes:", e);
      }

      // Post ack in Slack
      const ackText = botMsgs["auto_proceed_ack"] || "We've gone ahead and connected you with Sam, Lovable's AI Support Agent. Sam may take 3–4 minutes to respond. Hang tight!";
      if (row.prompt_message_ts) {
        await fetch(`${SLACK_API_URL}/chat.update`, {
          method: "POST",
          headers: slackHeaders,
          body: JSON.stringify({
            channel: row.slack_channel_id,
            ts: row.prompt_message_ts,
            text: ackText,
            ...BOT_IDENTITY,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: ackText } }],
          }),
        });
      } else {
        await fetch(`${SLACK_API_URL}/chat.postMessage`, {
          method: "POST",
          headers: slackHeaders,
          body: JSON.stringify({
            channel: row.slack_channel_id,
            thread_ts: row.slack_thread_ts,
            text: ackText,
            ...BOT_IDENTITY,
          }),
        });
      }

      autoProceeded++;
      console.log(`Auto-proceeded ${row.id} → Intercom conversation ${conversationId}`);

    } else if (!row.reminder_sent_at) {
      // ===== SEND REMINDER (15-30 minutes, no reminder yet) =====
      const reminderText = botMsgs["context_reminder"] || "Hey! Just a reminder — click *Add Details* to share your email/project info, or *Proceed* to continue without it. If no action is taken, we'll automatically proceed in 15 minutes.";

      const postRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: slackHeaders,
        body: JSON.stringify({
          channel: row.slack_channel_id,
          thread_ts: row.slack_thread_ts,
          text: reminderText.replace(/\*/g, ""),
          ...BOT_IDENTITY,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: reminderText } }],
        }),
      });
      const postData = await postRes.json();

      if (postData.ok) {
        await supabase
          .from("conversation_mappings")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        reminded++;
        console.log(`Sent reminder for ${row.id}`);
      } else {
        console.error(`Failed to send reminder for ${row.id}:`, postData.error);
      }
    }
  }

  return new Response(
    JSON.stringify({ ok: true, reminded, autoProceeded }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
