import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

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
  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
    if (!slackToken) {
      return new Response(JSON.stringify({ error: "Missing SLACK_BOT_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { url, force, existingId } = body;
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

    // Determine target ID for update
    let targetId: string | null = existingId || null;

    if (!targetId) {
      // Check for duplicates
      const { data: existing } = await supabase
        .from("conversation_mappings")
        .select("id")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .limit(1);

      if (existing && existing.length > 0 && !force) {
        return new Response(
          JSON.stringify({ error: "This thread has already been imported", existingId: existing[0].id }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      targetId = existing && existing.length > 0 ? existing[0].id : null;
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
        if (repliesData.error === "not_in_channel" || repliesData.error === "channel_not_found") {
          // Try to auto-join (works for public channels)
          const joinRes = await fetch("https://slack.com/api/conversations.join", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${slackToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ channel: channelId }),
          });
          const joinData = await joinRes.json();

          if (joinData.ok) {
            // Retry fetching replies after joining
            const retryParams = new URLSearchParams({
              channel: channelId,
              ts: threadTs,
              limit: "200",
              inclusive: "true",
            });
            const retryRes = await fetch(
              `https://slack.com/api/conversations.replies?${retryParams}`,
              { headers: { Authorization: `Bearer ${slackToken}` } }
            );
            const retryData = await retryRes.json();

            if (!retryData.ok) {
              return new Response(
                JSON.stringify({ error: `Slack API error after joining channel: ${retryData.error}` }),
                { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }

            if (retryData.messages) {
              allMessages.push(...retryData.messages);
            }
            cursor = retryData.response_metadata?.next_cursor || undefined;
            continue;
          } else {
            // Can't join — private channel, missing channels:join scope, or bad channel id.
            const why = String(joinData.error || "unknown");
            const hint =
              why === "method_not_supported_for_channel_type" || why === "channel_not_found"
                ? "This looks like a private channel or DM — the bot must be invited manually."
                : why === "missing_scope"
                  ? `The Slack app is missing a scope (needed: ${joinData.needed || "channels:join"}).`
                  : `Slack refused the auto-join (${why}).`;
            return new Response(
              JSON.stringify({
                error: `${hint} Invite the bot by typing /invite @Ask Lovable in the channel, then retry.`,
                slackError: why,
              }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

        }

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

    // Resolve Slack user display name
    let slackUserName: string | null = null;
    if (slackUserId) {
      try {
        const userRes = await fetch(
          `https://slack.com/api/users.info?user=${slackUserId}`,
          { headers: { Authorization: `Bearer ${slackToken}` } }
        );
        const userData = await userRes.json();
        if (userData.ok && userData.user) {
          const u = userData.user;
          slackUserName = u.profile?.display_name || u.real_name || u.name || null;
        }
      } catch (e) {
        console.error("Failed to resolve Slack user name:", e);
      }
    }

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

    // Compute created_at from thread timestamp
    const threadCreatedAt = new Date(parseFloat(threadTs) * 1000).toISOString();

    let inserted: any;
    let insertError: any;

    if (targetId && force) {
      // Remove any conflicting row that already has this channel+thread
      const { data: conflicting } = await supabase
        .from("conversation_mappings")
        .select("id")
        .eq("slack_channel_id", channelId)
        .eq("slack_thread_ts", threadTs)
        .neq("id", targetId)
        .limit(1);

      if (conflicting && conflicting.length > 0) {
        await supabase
          .from("conversation_mappings")
          .delete()
          .eq("id", conflicting[0].id);
      }

      // Force re-import: update existing row with ALL fields
      const { data, error } = await supabase
        .from("conversation_mappings")
        .update({
          slack_channel_id: channelId,
          slack_thread_ts: threadTs,
          slack_user_id: slackUserId,
          slack_user_name: slackUserName,
          original_message_text: messageText,
          created_at: threadCreatedAt,
        })
        .eq("id", targetId)
        .select()
        .single();
      inserted = data;
      insertError = error;
    } else {
      // New insert
      const { data, error } = await supabase
        .from("conversation_mappings")
        .insert({
          slack_channel_id: channelId,
          slack_thread_ts: threadTs,
          slack_user_id: slackUserId,
          slack_user_name: slackUserName,
          original_message_text: messageText,
          status: "active",
          created_at: threadCreatedAt,
        })
        .select()
        .single();
      inserted = data;
      insertError = error;
    }

    if (insertError) {
      console.error("Insert/update error:", insertError);
      return new Response(
        JSON.stringify({ error: `Failed to save: ${insertError.message}` }),
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
