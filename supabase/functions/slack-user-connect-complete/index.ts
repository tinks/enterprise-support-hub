// slack-user-connect-complete — exchanges the one-time OAuth code for the
// per-user connection key and stores it encrypted against the signed-in user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";
import { callAsAppUser, exchangeAppUserOAuthCode } from "../_shared/appUserConnector.ts";
import { saveConnectionKeyForUser } from "../_shared/appUserConnections.ts";
import { GATEWAY_BASE_URL, SLACK_CONNECTOR_ID, SLACK_SCOPES } from "../_shared/appUserScopes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: userData } = await admin.auth.getUser(gate.token);
    const email = userData?.user?.email?.toLowerCase() ?? null;
    if (!email) return json({ error: "Caller has no email" }, 403);

    const { data: teammate } = await admin
      .from("teammates")
      .select("role, active")
      .ilike("email", email)
      .maybeSingle();
    if (!teammate || !teammate.active || teammate.role !== "support") {
      return json({ error: "Only active Enterprise Support teammates can connect Slack." }, 403);
    }

    let code = "";
    try {
      const body = await req.json();
      code = String(body?.code ?? "").trim();
    } catch {
      /* fall through */
    }
    if (!code) return json({ error: "code is required" }, 400);

    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, code);
    if (connectorId !== SLACK_CONNECTOR_ID) {
      return json({ error: "OAuth completion returned the wrong connector" }, 400);
    }

    // Identify who Slack thinks we are, so the UI can show it back.
    let slackUserId: string | null = null;
    let slackTeamId: string | null = null;
    try {
      const res = await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey,
        connectorId: SLACK_CONNECTOR_ID,
        path: "/api/auth.test",
        init: { method: "POST" },
        requiredScopes: SLACK_SCOPES,
      });
      const data = await res.json();
      if (data?.ok) {
        slackUserId = data.user_id ?? null;
        slackTeamId = data.team_id ?? null;
      }
    } catch (e) {
      console.error("auth.test after connect failed:", e);
    }

    await saveConnectionKeyForUser(gate.userId, connectorId, connectionAPIKey, {
      slack_user_id: slackUserId,
      slack_team_id: slackTeamId,
      connected_email: email,
    });

    return json({ ok: true, slackUserId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    console.error("slack-user-connect-complete error:", msg);
    return json({ error: msg }, 500);
  }
});
