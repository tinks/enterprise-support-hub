import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function parseSlackUrl(url: string): { channelId: string; threadTs: string } | null {
  try {
    const archiveMatch = url.match(/archives\/([CGD][A-Z0-9]+)\/p(\d+)/);
    if (archiveMatch) {
      const channelId = archiveMatch[1];
      const raw = archiveMatch[2];
      const threadTs = raw.slice(0, raw.length - 6) + "." + raw.slice(raw.length - 6);
      const urlObj = new URL(url);
      const explicitTs = urlObj.searchParams.get("thread_ts");
      return { channelId, threadTs: explicitTs || threadTs };
    }

    const clientMatch = url.match(/thread\/([CGD][A-Z0-9]+)-(\d+\.\d+)/);
    if (clientMatch) {
      return { channelId: clientMatch[1], threadTs: clientMatch[2] };
    }

    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
    if (!slackToken) {
      return new Response(JSON.stringify({ error: "Missing SLACK_BOT_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const parsed = parseSlackUrl(url.trim());
    if (!parsed) {
      return new Response(
        JSON.stringify({ error: "Could not parse Slack thread URL. Supported formats: https://*.slack.com/archives/CXXXX/pXXXX or thread URLs" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { channelId, threadTs } = parsed;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for duplicates
    const { data: existing } = await supabase
      .from("conversation_mappings")
      .select("id")
      .eq("slack_channel_id", channelId)
      .eq("slack_thread_ts", threadTs)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ error: "This thread has already been imported", existingId: existing[0].id }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch ALL thread replies (paginated)
    const allMessages: any[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({
        channel: channelId,
        ts: threadTs,
        limit: "200",
        inclusive: "true",
      });
      if (cursor) params.set("cursor", cursor);

      const repliesRes = await fetch(
        `https://slack.com/api/conversations.replies?${params}`,
        { headers: { Authorization: `Bearer ${slackToken}` } }
      );
      const repliesData = await repliesRes.json();

      if (!repliesData.ok) {
        return new Response(
          JSON.stringify({ error: `Slack API error: ${repliesData.error}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (repliesData.messages) {
        allMessages.push(...repliesData.messages);
      }
      cursor = repliesData.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const parentMsg = allMessages[0];
    if (!parentMsg) {
      return new Response(
        JSON.stringify({ error: "No message found at this thread timestamp" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const slackUserId = parentMsg.user || "";
    const messageText = parentMsg.text || "";

    // Fetch bot user ID from settings to identify admin vs user
    const { data: settingsRow } = await supabase
      .from("settings")
      .select("slack_bot_user_id")
      .limit(1)
      .single();
    const botUserId = settingsRow?.slack_bot_user_id || "";

    // Compute response time: first reply NOT from the original poster and NOT the bot
    const replies = allMessages.filter(
      (m: any) => m.ts !== threadTs && m.user !== botUserId
    );
    const firstAdminReply = replies.find((m: any) => m.user !== slackUserId);
    let firstResponseSec: number | null = null;
    if (firstAdminReply) {
      firstResponseSec = parseFloat(firstAdminReply.ts) - parseFloat(threadTs);
    }

    // Last message timestamp for potential resolution time
    const lastMsg = allMessages[allMessages.length - 1];
    const threadDurationSec = lastMsg
      ? parseFloat(lastMsg.ts) - parseFloat(threadTs)
      : null;

    // Fetch channel info
    const channelRes = await fetch(
      `https://slack.com/api/conversations.info?channel=${channelId}`,
      { headers: { Authorization: `Bearer ${slackToken}` } }
    );
    const channelData = await channelRes.json();
    const channelName = channelData.ok ? channelData.channel?.name || channelId : channelId;

    // Insert into conversation_mappings
    const { data: inserted, error: insertError } = await supabase
      .from("conversation_mappings")
      .insert({
        slack_channel_id: channelId,
        slack_thread_ts: threadTs,
        slack_user_id: slackUserId,
        original_message_text: messageText,
        status: "active",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: `Failed to insert: ${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        conversation: inserted,
        channelName,
        slackUserId,
        replyCount: allMessages.length - 1,
        firstResponseSec,
        threadDurationSec,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("import-slack-thread error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
