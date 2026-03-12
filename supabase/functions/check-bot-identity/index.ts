const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Call auth.test to get token identity
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const authData = await authRes.json();

    if (!authData.ok) {
      return new Response(
        JSON.stringify({ error: `auth.test failed: ${authData.error}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call users.info to get the bot user's profile
    const userRes = await fetch(
      `https://slack.com/api/users.info?user=${authData.user_id}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    );
    const userData = await userRes.json();

    const profile = userData.user?.profile || {};
    const identity = {
      ok: true,
      app_id: authData.app_id || null,
      bot_user_id: authData.user_id,
      team_id: authData.team_id,
      team_name: authData.team,
      bot_name: userData.user?.real_name || authData.user,
      display_name: profile.display_name || profile.real_name || authData.user,
      icon_url: profile.image_72 || profile.image_48 || null,
      mention_format: `<@${authData.user_id}>`,
    };

    return new Response(JSON.stringify(identity), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
