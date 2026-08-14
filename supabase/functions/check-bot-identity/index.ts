import { requireUser } from "../_shared/require-user.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireUser(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Guess token type from prefix
    const tokenPrefix = SLACK_BOT_TOKEN.substring(0, 4);
    const tokenTypeGuess =
      tokenPrefix === "xoxb" ? "bot" :
      tokenPrefix === "xoxp" ? "user" :
      tokenPrefix === "xoxa" ? "app-level" : "unknown";

    // Call auth.test to get token identity
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const authData = await authRes.json();

    if (!authData.ok) {
      return new Response(
        JSON.stringify({
          error: `auth.test failed: ${authData.error}`,
          token_type_guess: tokenTypeGuess,
          is_bot_token: tokenTypeGuess === "bot",
          hint: tokenTypeGuess !== "bot"
            ? "The token doesn't appear to be a Bot User OAuth Token (xoxb-...). Make sure you're copying from OAuth & Permissions → Bot User OAuth Token."
            : "The token is a bot token but Slack rejected it. It may be revoked or from an uninstalled app.",
        }),
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

    // Load expected bot user ID from settings
    const { data: settings } = await supabase
      .from("settings")
      .select("slack_bot_user_id")
      .limit(1)
      .single();

    const expectedBotUserId = settings?.slack_bot_user_id || "";
    const currentBotUserId = authData.user_id;
    const idMatch = !expectedBotUserId || currentBotUserId === expectedBotUserId;

    let mismatchReason = "";
    if (!idMatch) {
      mismatchReason = `Token authenticates as ${currentBotUserId}, but expected ${expectedBotUserId}. The SLACK_BOT_TOKEN secret likely belongs to a different Slack app.`;
    }

    const botName = userData.user?.real_name || authData.user;
    const displayName = profile.display_name || profile.real_name || authData.user;

    const identity = {
      ok: true,
      token_type_guess: tokenTypeGuess,
      is_bot_token: tokenTypeGuess === "bot",
      app_id: authData.app_id || null,
      bot_user_id: currentBotUserId,
      expected_bot_user_id: expectedBotUserId || null,
      id_match: idMatch,
      mismatch_reason: mismatchReason || null,
      team_id: authData.team_id,
      team_name: authData.team,
      bot_name: botName,
      display_name: displayName,
      icon_url: profile.image_72 || profile.image_48 || null,
      mention_format: `<@${currentBotUserId}>`,
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
