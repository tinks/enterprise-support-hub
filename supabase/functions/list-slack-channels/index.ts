const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_API_URL = "https://slack.com/api";
const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

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
    const channelIdSet = channelIds.length > 0 ? new Set(channelIds) : null;

    const allChannels: { id: string; name: string; is_member: boolean; num_members: number }[] = [];
    let cursor = "";
    let channelTypes = "public_channel,private_channel";

    do {
      const params = new URLSearchParams({
        types: channelTypes,
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
        if (data.error === "missing_scope" && channelTypes.includes("private_channel")) {
          // Some workspaces don't grant private-channel scopes to the bot.
          // Retry gracefully with public channels only instead of failing.
          channelTypes = "public_channel";
          cursor = "";
          allChannels.length = 0;
          continue;
        }
        throw new Error(`Slack API error: ${data.error}`);
      }

      for (const ch of data.channels || []) {
        if (channelIdSet && !channelIdSet.has(ch.id)) {
          continue;
        }

        allChannels.push({
          id: ch.id,
          name: ch.name,
          is_member: ch.is_member ?? false,
          num_members: ch.num_members ?? 0,
        });
      }

      if (channelIdSet && allChannels.length >= channelIdSet.size) {
        break;
      }

      cursor = data.response_metadata?.next_cursor || "";
    } while (cursor);

    if (channelIdSet) {
      const unresolvedIds = [...channelIdSet].filter((id) => !allChannels.some((ch) => ch.id === id));

      if (unresolvedIds.length > 0) {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");

        if (LOVABLE_API_KEY && SLACK_API_KEY) {
          const fallbackChannels = await Promise.all(
            unresolvedIds.map(async (channelId) => {
              const res = await fetch(`${SLACK_GATEWAY_URL}/conversations.info`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "X-Connection-Api-Key": SLACK_API_KEY,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ channel: channelId }),
              });

              const data = await res.json();
              if (!res.ok || !data?.ok || !data.channel) {
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

          for (const channel of fallbackChannels) {
            if (channel) {
              allChannels.push(channel);
            }
          }
        }
      }
    }

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
