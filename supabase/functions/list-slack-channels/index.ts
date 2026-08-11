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
      let unresolvedIds = [...channelIdSet].filter((id) => !allChannels.some((ch) => ch.id === id));

      // Tier 2: Direct conversations.info with SLACK_BOT_TOKEN
      if (unresolvedIds.length > 0) {
        console.log(`Tier 2: attempting direct conversations.info for ${unresolvedIds.length} unresolved IDs:`, unresolvedIds);
        const directResults = await Promise.all(
          unresolvedIds.map(async (channelId) => {
            try {
              const res = await fetch(`${SLACK_API_URL}/conversations.info?channel=${channelId}`, {
                headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
              });
              const data = await res.json();
              console.log(`Tier 2 conversations.info for ${channelId}:`, JSON.stringify(data));
              if (!data.ok || !data.channel) return null;
              return {
                id: data.channel.id,
                name: data.channel.name,
                is_member: data.channel.is_member ?? false,
                num_members: data.channel.num_members ?? 0,
              };
            } catch (err) {
              console.error(`Tier 2 error for ${channelId}:`, err);
              return null;
            }
          }),
        );
        for (const ch of directResults) {
          if (ch) allChannels.push(ch);
        }

        unresolvedIds = unresolvedIds.filter((id) => !allChannels.some((ch) => ch.id === id));
      }

      // Tier 3: Connector gateway fallback
      if (unresolvedIds.length > 0) {
        console.log(`Tier 3: attempting connector gateway for ${unresolvedIds.length} unresolved IDs:`, unresolvedIds);
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        // The linked Slack connection injects SLACK_API_KEY_1; SLACK_API_KEY is a
        // stale legacy secret kept only as a fallback.
        const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY_1") ?? Deno.env.get("SLACK_API_KEY");

        if (LOVABLE_API_KEY && SLACK_API_KEY) {
          const fallbackChannels = await Promise.all(
            unresolvedIds.map(async (channelId) => {
              try {
                const url = new URL(`${SLACK_GATEWAY_URL}/conversations.info`);
                url.searchParams.set("channel", channelId);
                const res = await fetch(url.toString(), {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${LOVABLE_API_KEY}`,
                    "X-Connection-Api-Key": SLACK_API_KEY,
                  },
                });

                const data = await res.json();
                console.log(`Tier 3 gateway response for ${channelId}: status=${res.status}`, JSON.stringify(data));
                if (!res.ok || !data?.ok || !data.channel) return null;

                return {
                  id: data.channel.id,
                  name: data.channel.name,
                  is_member: data.channel.is_member ?? false,
                  num_members: data.channel.num_members ?? 0,
                };
              } catch (err) {
                console.error(`Tier 3 error for ${channelId}:`, err);
                return null;
              }
            }),
          );

          for (const channel of fallbackChannels) {
            if (channel) allChannels.push(channel);
          }
        } else {
          console.log("Tier 3: skipped — missing LOVABLE_API_KEY or SLACK_API_KEY");
        }
      }
    }

    // Resolve DM channel names — fetch the other user's display name
    const SLACK_BOT_TOKEN_VAL = SLACK_BOT_TOKEN;
    for (const ch of allChannels) {
      if (!ch.name && ch.id.startsWith("D")) {
        // Try to get the DM user via conversations.info
        try {
          const infoRes = await fetch(`${SLACK_API_URL}/conversations.info?channel=${ch.id}`, {
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN_VAL}` },
          });
          const infoData = await infoRes.json();
          if (infoData.ok && infoData.channel?.user) {
            const userRes = await fetch(`${SLACK_API_URL}/users.info?user=${infoData.channel.user}`, {
              headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN_VAL}` },
            });
            const userData = await userRes.json();
            if (userData.ok && userData.user) {
              ch.name = `DM: ${userData.user.profile?.display_name || userData.user.real_name || userData.user.name || "Unknown"}`;
            }
          }
        } catch (err) {
          console.error(`DM name resolution failed for ${ch.id}:`, err);
        }
        if (!ch.name) ch.name = "Direct message";
      }
    }

    allChannels.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

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
