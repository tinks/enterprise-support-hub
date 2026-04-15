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
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
    const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!intercomToken) {
      return new Response(
        JSON.stringify({ error: "Missing Intercom API token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { mappingId, source = "slack" } = await req.json();

    if (!mappingId) {
      return new Response(
        JSON.stringify({ error: "mappingId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const intercomHeaders = {
      Authorization: `Bearer ${intercomToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    };

    let email: string | null = null;
    let contactName: string | null = null;
    let body = "";
    let tableName = "conversation_mappings";
    let existingIntercomId: string | null = null;

    if (source === "gmail") {
      tableName = "gmail_conversations";
      const { data: gmail, error: gmailErr } = await supabase
        .from("gmail_conversations")
        .select("*")
        .eq("id", mappingId)
        .single();

      if (gmailErr || !gmail) {
        return new Response(
          JSON.stringify({ error: "Gmail conversation not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (gmail.intercom_conversation_id) {
        return new Response(
          JSON.stringify({ error: "Already has an Intercom conversation", intercomId: gmail.intercom_conversation_id }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      email = gmail.from_email || null;
      contactName = gmail.from_name || gmail.from_email || "Gmail contact";
      const internalNote = "Internal note: This is a Gmail email imported into Intercom. Handle this request as you normally would.";
      body = `${internalNote}\n\nSubject: ${gmail.subject || "(no subject)"}\nFrom: ${gmail.from_name || ""} <${gmail.from_email || "unknown"}>\n\n${gmail.snippet || ""}`;

    } else if (source === "manual") {
      tableName = "manual_conversations";
      const { data: manual, error: manualErr } = await supabase
        .from("manual_conversations")
        .select("*")
        .eq("id", mappingId)
        .single();

      if (manualErr || !manual) {
        return new Response(
          JSON.stringify({ error: "Manual conversation not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (manual.intercom_conversation_id) {
        return new Response(
          JSON.stringify({ error: "Already has an Intercom conversation", intercomId: manual.intercom_conversation_id }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      contactName = manual.contact_name || "Manual contact";

      // Fetch messages for transcript
      const { data: msgs } = await supabase
        .from("manual_messages")
        .select("*")
        .eq("conversation_id", mappingId)
        .order("created_at", { ascending: true });

      const transcript = (msgs || [])
        .map((m: any) => `[${new Date(m.created_at).toISOString()}] ${m.sender_name || m.role}: ${m.message_text || ""}`)
        .join("\n\n");

      const internalNote = `Internal note: This is a manually logged ${manual.source} conversation. Handle this request as you normally would.`;
      body = `${internalNote}\n\nSubject: ${manual.subject || "(no subject)"}\nContact: ${contactName}\nSource: ${manual.source}\n\n--- Transcript ---\n${transcript}`;

    } else {
      // Default: slack
      if (!slackToken) {
        return new Response(
          JSON.stringify({ error: "Missing Slack bot token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

      const transcript = allMessages
        .map((m: any) => {
          const ts = new Date(parseFloat(m.ts) * 1000).toISOString();
          return `[${ts}] ${m.user || "bot"}: ${m.text || ""}`;
        })
        .join("\n\n");

      const internalNote = "Internal note: This is a manually imported Slack thread. The full thread transcript is included below. Handle this request as you normally would.";
      body = `${internalNote}\n\nOriginal message: ${mapping.original_message_text}\n\n--- Thread transcript ---\n${transcript}`;

      if (!email) {
        contactName = `Slack User ${mapping.slack_user_id}`;
      }
    }

    // Find or create Intercom contact
    let contactId: string;
    const searchField = email ? "email" : "external_id";
    const searchValue = email || `${source}-${mappingId}`;

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
        createBody.name = contactName || email;
      } else {
        createBody.external_id = `${source}-${mappingId}`;
        createBody.name = contactName || `${source} contact`;
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

    // Determine if test — check the source row
    let isTest = false;
    if (source === "slack") {
      const { data: m } = await supabase.from("conversation_mappings").select("is_test").eq("id", mappingId).single();
      isTest = m?.is_test === true;
    } else if (source === "gmail") {
      const { data: g } = await supabase.from("gmail_conversations").select("is_test").eq("id", mappingId).single();
      isTest = g?.is_test === true;
    } else {
      const { data: mc } = await supabase.from("manual_conversations").select("is_test").eq("id", mappingId).single();
      isTest = mc?.is_test === true;
    }

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

    // Update the source table with intercom IDs
    const updateData: Record<string, string> = { intercom_conversation_id: conversationId };
    if (source === "slack") {
      (updateData as any).intercom_contact_id = contactId;
    }
    await supabase.from(tableName).update(updateData).eq("id", mappingId);

    console.log(`Created Intercom conversation ${conversationId} for ${source} ${mappingId}`);

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
