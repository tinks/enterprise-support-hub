import { requireUser } from "../_shared/require-user.ts";
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

  const auth = await requireUser(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  let includeDeactivated = url.searchParams.get("include_deactivated") === "true";

  // Also accept from JSON body (for supabase.functions.invoke calls)
  if (!includeDeactivated && req.method === "POST") {
    try {
      const body = await req.json();
      if (body?.include_deactivated === true) includeDeactivated = true;
    } catch { /* no body or not JSON */ }
  }

  try {
    const allUsers: {
      id: string;
      name: string;
      real_name: string;
      display_name: string;
      is_guest: boolean;
      is_deactivated: boolean;
    }[] = [];
    let cursor = "";

    do {
      const params = new URLSearchParams({ limit: "200" });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`${SLACK_API_URL}/users.list?${params}`, {
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        },
      });

      const data = await res.json();
      if (!data.ok) {
        throw new Error(`Slack API error: ${data.error}`);
      }

      for (const member of data.members || []) {
        if (member.is_bot || member.id === "USLACKBOT") continue;
        if (member.deleted && !includeDeactivated) continue;
        allUsers.push({
          id: member.id,
          name: member.name,
          real_name: member.real_name || member.name,
          display_name: member.profile?.display_name || member.real_name || member.name,
          is_guest: !!(member.is_restricted || member.is_ultra_restricted),
          is_deactivated: !!member.deleted,
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
