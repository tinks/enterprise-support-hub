import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SlackMessage {
  text: string;
  user_name: string;
  user_avatar: string;
  ts: string;
  is_bot: boolean;
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

    const { channelId, threadTs } = await req.json();
    if (!channelId || !threadTs) {
      return new Response(
        JSON.stringify({ error: "channelId and threadTs are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch bot user ID from settings
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: settings } = await supabase
      .from("settings")
      .select("slack_bot_user_id")
      .limit(1)
      .single();
    const botUserId = settings?.slack_bot_user_id || "";

    // Fetch all thread replies with pagination
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

      const res = await fetch(
        `https://slack.com/api/conversations.replies?${params}`,
        { headers: { Authorization: `Bearer ${slackToken}` } }
      );
      const data = await res.json();

      if (!data.ok) {
        console.error("Slack API error:", data.error);
        return new Response(
          JSON.stringify({ error: `Slack API error: ${data.error}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (data.messages) allMessages.push(...data.messages);
      cursor = data.has_more ? data.response_metadata?.next_cursor : undefined;
    } while (cursor);

    // Resolve unique user IDs
    const userIds = [...new Set(allMessages.map((m: any) => m.user).filter(Boolean))];
    const userCache: Record<string, { name: string; avatar: string }> = {};

    await Promise.all(
      userIds.map(async (uid) => {
        try {
          const res = await fetch(
            `https://slack.com/api/users.info?user=${uid}`,
            { headers: { Authorization: `Bearer ${slackToken}` } }
          );
          const data = await res.json();
          if (data.ok && data.user) {
            const u = data.user;
            userCache[uid] = {
              name: u.profile?.display_name || u.real_name || u.name || uid,
              avatar: u.profile?.image_48 || "",
            };
          } else {
            userCache[uid] = { name: uid, avatar: "" };
          }
        } catch {
          userCache[uid] = { name: uid, avatar: "" };
        }
      })
    );

    // Map to response format
    const messages: SlackMessage[] = allMessages.map((m: any) => {
      const userId = m.user || "";
      const cached = userCache[userId] || { name: m.username || "Unknown", avatar: "" };
      const isBot = userId === botUserId || !!m.bot_id;

      return {
        text: m.text || "",
        user_name: isBot ? (m.username || "Ask Lovable") : cached.name,
        user_avatar: isBot ? "" : cached.avatar,
        ts: m.ts,
        is_bot: isBot,
      };
    });

    return new Response(JSON.stringify({ messages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-thread-messages error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
