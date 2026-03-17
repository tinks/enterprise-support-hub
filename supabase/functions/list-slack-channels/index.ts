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

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let requestBody: unknown = {};
    try {
      requestBody = await req.json();
    } catch {
      requestBody = {};
    }

    const channelIds = Array.isArray((requestBody as { channelIds?: unknown[] })?.channelIds)
      ? [...new Set((requestBody as { channelIds: unknown[] }).channelIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
      : [];

    if (channelIds.length > 0) {
      const resolvedChannels = await Promise.all(
        channelIds.map(async (channelId) => {
          const params = new URLSearchParams({ channel: channelId });
          const res = await fetch(`${SLACK_API_URL}/conversations.info?${params}`, {
            headers: {
              Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            },
          });

          const data = await res.json();
          if (!data.ok || !data.channel) {
            return null;
          }

          return {
            id: data.channel.id,
            name: data.channel.name,
            is_member: data.channel.is_member ?? false,
            num_members: data.channel.num_members ?? 0,
          };
        }),
      );

      return new Response(JSON.stringify({ channels: resolvedChannels.filter(Boolean) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allChannels: { id: string; name: string; is_member: boolean; num_members: number }[] = [];
    let cursor = "";

    do {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "200",
      });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`${SLACK_API_URL}/conversations.list?${params}`, {
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      for (const ch of data.channels || []) {
        allChannels.push({
          id: ch.id,
          name: ch.name,
          is_member: ch.is_member ?? false,
          num_members: ch.num_members ?? 0,
        });
      }

      cursor = data.response_metadata?.next_cursor || "";
    } while (cursor);

    allChannels.sort((a, b) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ channels: allChannels }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error listing channels:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
