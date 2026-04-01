import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_API_URL = "https://slack.com/api";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
    const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!slackToken || !intercomToken) {
      return new Response(
        JSON.stringify({ error: "Missing required secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { mappingId } = await req.json();

    if (!mappingId) {
      return new Response(
        JSON.stringify({ error: "mappingId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load the conversation mapping
    const { data: mapping, error: mapErr } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("id", mappingId)
      .single();

    if (mapErr || !mapping) {
      return new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (mapping.intercom_conversation_id) {
      return new Response(
        JSON.stringify({ error: "Already has an Intercom conversation", intercomId: mapping.intercom_conversation_id }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Lookup Slack user email
    let email: string | null = null;
    if (mapping.slack_user_id) {
      try {
        const userRes = await fetch(`${SLACK_API_URL}/users.info?user=${mapping.slack_user_id}`, {
          headers: { Authorization: `Bearer ${slackToken}` },
        });
        const userData = await userRes.json();
        if (userData.ok && userData.user?.profile?.email) {
          email = userData.user.profile.email;
        }
      } catch (e) {
        console.error("Failed to lookup Slack user email:", e);
      }
    }

    // Fetch full thread transcript
    const allMessages: any[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({
        channel: mapping.slack_channel_id,
        ts: mapping.slack_thread_ts,
        limit: "200",
        inclusive: "true",
      });
      if (cursor) params.set("cursor", cursor);

      const repliesRes = await fetch(
        `${SLACK_API_URL}/conversations.replies?${params}`,
        { headers: { Authorization: `Bearer ${slackToken}` } }
      );
      const repliesData = await repliesRes.json();
      if (repliesData.ok && repliesData.messages) {
        allMessages.push(...repliesData.messages);
      }
      cursor = repliesData.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Build transcript
    const transcript = allMessages
      .map((m: any) => {
        const ts = new Date(parseFloat(m.ts) * 1000).toISOString();
        return `[${ts}] ${m.user || "bot"}: ${m.text || ""}`;
      })
      .join("\n\n");

    const intercomHeaders = {
      Authorization: `Bearer ${intercomToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    };

    // Find or create Intercom contact
    let contactId: string;
    const searchField = email ? "email" : "external_id";
    const searchValue = email || mapping.slack_user_id;

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
      const createBody: Record<string, string> = { role: "user" };
      if (email) {
        createBody.email = email;
        createBody.name = email;
      } else {
        createBody.external_id = mapping.slack_user_id;
        createBody.name = `Slack User ${mapping.slack_user_id}`;
      }

      const createRes = await fetch("https://api.intercom.io/contacts", {
        method: "POST",
        headers: intercomHeaders,
        body: JSON.stringify(createBody),
      });
      const createResText = await createRes.text();

      if (!createRes.ok) {
        let conflictId: string | null = null;
        try {
          const errData = JSON.parse(createResText);
          const idMatch = (errData.errors?.[0]?.message || "").match(/id=([a-f0-9]+)/);
          if (idMatch) conflictId = idMatch[1];
        } catch (_) {}

        if (conflictId) {
          contactId = conflictId;
        } else {
          return new Response(
            JSON.stringify({ error: `Failed to create contact: ${createResText}` }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        contactId = JSON.parse(createResText).id;
      }
    }

    // Build body with transcript
    const internalNote = "Internal note: This is a manually imported Slack thread. The full thread transcript is included below. Handle this request as you normally would.";
    const body = `${internalNote}\n\nOriginal message: ${mapping.original_message_text}\n\n--- Thread transcript ---\n${transcript}`;

    // Create Intercom conversation
    const convRes = await fetch("https://api.intercom.io/conversations", {
      method: "POST",
      headers: intercomHeaders,
      body: JSON.stringify({
        from: { type: "user", id: contactId },
        body,
      }),
    });

    if (!convRes.ok) {
      const errText = await convRes.text();
      console.error("Failed to create Intercom conversation:", errText);
      return new Response(
        JSON.stringify({ error: `Failed to create Intercom conversation` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const conversation = await convRes.json();
    const conversationId = conversation.conversation_id || conversation.id;

    // Load settings for assignment
    const { data: settings } = await supabase
      .from("settings")
      .select("intercom_assignee_id, intercom_inbox_id, test_intercom_inbox_id")
      .limit(1)
      .single();

    if (settings?.intercom_assignee_id) {
      await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
        method: "POST",
        headers: intercomHeaders,
        body: JSON.stringify({
          message_type: "assignment",
          type: "admin",
          assignee_id: settings.intercom_assignee_id,
          admin_id: settings.intercom_assignee_id,
        }),
      });
    }

    const isTest = mapping.is_test === true;
    const inboxId = isTest && settings?.test_intercom_inbox_id
      ? settings.test_intercom_inbox_id
      : settings?.intercom_inbox_id;

    if (inboxId) {
      await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
        method: "POST",
        headers: intercomHeaders,
        body: JSON.stringify({
          message_type: "assignment",
          type: "team",
          assignee_id: inboxId,
          admin_id: settings?.intercom_assignee_id,
          body: "",
        }),
      });
    }

    // Update mapping
    await supabase
      .from("conversation_mappings")
      .update({
        intercom_conversation_id: conversationId,
        intercom_contact_id: contactId,
      })
      .eq("id", mappingId);

    console.log(`Created Intercom conversation ${conversationId} for imported mapping ${mappingId}`);

    return new Response(
      JSON.stringify({
        success: true,
        intercomConversationId: conversationId,
        contactId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-intercom-from-import error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
