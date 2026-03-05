import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!SLACK_API_KEY) {
    return new Response(JSON.stringify({ error: "SLACK_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const allUsers: { id: string; name: string; real_name: string; display_name: string }[] = [];
    let cursor = "";

    do {
      const params = new URLSearchParams({ limit: "200" });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`${GATEWAY_URL}/users.list?${params}`, {
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": SLACK_API_KEY,
        },
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      for (const member of data.members || []) {
        if (member.deleted || member.is_bot || member.id === "USLACKBOT") continue;
        allUsers.push({
          id: member.id,
          name: member.name,
          real_name: member.real_name || member.name,
          display_name: member.profile?.display_name || member.real_name || member.name,
        });
      }

      cursor = data.response_metadata?.next_cursor || "";
    } while (cursor);

    allUsers.sort((a, b) => a.real_name.localeCompare(b.real_name));

    return new Response(JSON.stringify({ users: allUsers }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error listing users:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
