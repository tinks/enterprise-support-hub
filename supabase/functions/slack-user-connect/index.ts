// slack-user-connect — starts per-person Slack OAuth for the signed-in
// Enterprise Support teammate. Returns only an authorization URL; the
// connection key never touches the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";
import { authorizeAppUserOAuth } from "../_shared/appUserConnector.ts";
import { getConnectionKeyForUser } from "../_shared/appUserConnections.ts";
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

    // Enterprise Support roster only.
    const { data: teammate } = await admin
      .from("teammates")
      .select("name, role, active")
      .ilike("email", email)
      .maybeSingle();
    if (!teammate || !teammate.active || teammate.role !== "support") {
      return json(
        { error: "Only active Enterprise Support teammates can connect Slack.", blocked: true },
        403,
      );
    }

    const clientAPIKey = Deno.env.get("SLACK_APP_USER_CONNECTOR_CLIENT_API_KEY");
    if (!clientAPIKey) {
      return json({ error: "SLACK_APP_USER_CONNECTOR_CLIENT_API_KEY is not set" }, 500);
    }

    let origin = "";
    try {
      const body = await req.json();
      origin = String(body?.origin ?? "");
    } catch {
      /* fall through */
    }
    if (!/^https?:\/\/[^\s/]+$/.test(origin)) {
      return json({ error: "A valid app origin is required" }, 400);
    }
    const returnUrl = new URL("/oauth/slack/return", origin).toString();

    const existingKey = await getConnectionKeyForUser(gate.userId, SLACK_CONNECTOR_ID);

    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: SLACK_CONNECTOR_ID,
      appUserId: gate.userId,
      clientAPIKey,
      returnUrl,
      connectionAPIKey: existingKey ?? undefined,
      credentialsConfiguration: { scopes: SLACK_SCOPES },
    });

    return json({ authorizationUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    console.error("slack-user-connect error:", msg);
    return json({ error: msg }, 500);
  }
});
