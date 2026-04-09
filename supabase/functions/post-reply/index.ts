import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function encodeBase64Url(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { conversationId, source, message } = await req.json();
    if (!conversationId || !source || !message?.trim()) {
      return err("conversationId, source, and message are required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load settings for admin IDs
    const { data: settings } = await supabase
      .from("settings")
      .select("intercom_assignee_id, slack_bot_user_id")
      .limit(1)
      .single();

    // ─── INTERCOM ───
    if (source === "manual" || source === "intercom") {
      // Manual conversations go through Intercom
      const { data: conv } = await supabase
        .from("manual_conversations")
        .select("intercom_conversation_id")
        .eq("id", conversationId)
        .single();
      const intercomConvId = conv?.intercom_conversation_id;
      if (!intercomConvId) return err("No Intercom conversation linked");

      const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
      if (!intercomToken) return err("INTERCOM_API_TOKEN not configured", 500);

      const adminId = settings?.intercom_assignee_id;
      if (!adminId) return err("No intercom_assignee_id in settings", 500);

      const res = await fetch(
        `https://api.intercom.io/conversations/${intercomConvId}/reply`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${intercomToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Intercom-Version": "2.11",
          },
          body: JSON.stringify({
            message_type: "comment",
            type: "admin",
            admin_id: adminId,
            body: message,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        console.error("Intercom reply failed:", body.slice(0, 500));
        return err(`Intercom API error: ${res.status}`, 502);
      }

      // Insert into manual_messages
      await supabase.from("manual_messages").insert({
        conversation_id: conversationId,
        message_text: message,
        sender_name: "Support",
        role: "admin",
      });

      // Update status to awaiting_customer
      await supabase
        .from("manual_conversations")
        .update({ status: "awaiting_customer" })
        .eq("id", conversationId);

      return ok({ success: true, platform: "intercom" });
    }

    // ─── SLACK ───
    if (source === "slack") {
      const { data: conv } = await supabase
        .from("conversation_mappings")
        .select("slack_channel_id, slack_thread_ts, intercom_conversation_id")
        .eq("id", conversationId)
        .single();
      if (!conv) return err("Conversation not found");

      const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
      if (!slackToken) return err("SLACK_BOT_TOKEN not configured", 500);

      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: conv.slack_channel_id,
          thread_ts: conv.slack_thread_ts,
          text: message,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error("Slack postMessage failed:", data.error);
        return err(`Slack API error: ${data.error}`, 502);
      }

      // Also reply in Intercom if linked
      if (conv.intercom_conversation_id) {
        const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
        const adminId = settings?.intercom_assignee_id;
        if (intercomToken && adminId) {
          await fetch(
            `https://api.intercom.io/conversations/${conv.intercom_conversation_id}/reply`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${intercomToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Intercom-Version": "2.11",
              },
              body: JSON.stringify({
                message_type: "comment",
                type: "admin",
                admin_id: adminId,
                body: message,
              }),
            },
          );
        }
      }

      // Update status
      await supabase
        .from("conversation_mappings")
        .update({ status: "awaiting_customer" })
        .eq("id", conversationId);

      return ok({ success: true, platform: "slack" });
    }

    // ─── GMAIL ───
    if (source === "gmail") {
      const { data: conv } = await supabase
        .from("gmail_conversations")
        .select("gmail_thread_id, gmail_message_id, from_email, subject, intercom_conversation_id")
        .eq("id", conversationId)
        .single();
      if (!conv) return err("Conversation not found");

      const clientId = Deno.env.get("GMAIL_CLIENT_ID");
      const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
      if (!clientId || !clientSecret) return err("Gmail OAuth not configured", 500);

      // Get OAuth tokens
      const { data: tokenRows } = await supabase
        .from("gmail_oauth_tokens")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!tokenRows?.length) return err("No Gmail OAuth tokens", 500);

      let tokenRow = tokenRows[0];
      let accessToken = tokenRow.access_token;

      // Refresh if needed
      const expiresAt = new Date(tokenRow.token_expires_at).getTime();
      if (Date.now() > expiresAt - 120_000) {
        const refreshed = await refreshAccessToken(tokenRow.refresh_token, clientId, clientSecret);
        accessToken = refreshed.access_token;
        await supabase
          .from("gmail_oauth_tokens")
          .update({
            access_token: accessToken,
            token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", tokenRow.id);
      }

      // Build RFC 2822 reply email
      const toEmail = conv.from_email || "";
      const subject = conv.subject || "";
      const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
      const messageId = conv.gmail_message_id;
      const emailAddress = tokenRow.email_address || "";

      const rawLines = [
        `From: ${emailAddress}`,
        `To: ${toEmail}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: <${messageId}>`,
        `References: <${messageId}>`,
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        message,
      ];
      const raw = encodeBase64Url(rawLines.join("\r\n"));

      const sendBody: Record<string, string> = { raw };
      if (conv.gmail_thread_id) sendBody.threadId = conv.gmail_thread_id;

      const res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(sendBody),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        console.error("Gmail send failed:", body.slice(0, 500));
        return err(`Gmail API error: ${res.status}`, 502);
      }

      // Also reply in Intercom if linked
      if (conv.intercom_conversation_id) {
        const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
        const adminId = settings?.intercom_assignee_id;
        if (intercomToken && adminId) {
          await fetch(
            `https://api.intercom.io/conversations/${conv.intercom_conversation_id}/reply`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${intercomToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "Intercom-Version": "2.11",
              },
              body: JSON.stringify({
                message_type: "comment",
                type: "admin",
                admin_id: adminId,
                body: message,
              }),
            },
          );
        }
      }

      // Update status
      await supabase
        .from("gmail_conversations")
        .update({ status: "awaiting_customer" })
        .eq("id", conversationId);

      return ok({ success: true, platform: "gmail" });
    }

    return err(`Unknown source: ${source}`);
  } catch (e) {
    console.error("post-reply error:", e);
    return err(e instanceof Error ? e.message : "Internal server error", 500);
  }
});
