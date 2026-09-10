// slack-user-connection — status ("am I connected?") and disconnect for the
// signed-in teammate's personal Slack connection. Returns no credentials.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";
import { disconnectAppUser } from "../_shared/appUserConnector.ts";
import {
  deleteConnectionForUser,
  getConnectionKeyForUser,
  getConnectionRowForUser,
} from "../_shared/appUserConnections.ts";
import { GATEWAY_BASE_URL, SLACK_CONNECTOR_ID } from "../_shared/appUserScopes.ts";

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

    const { data: teammate } = email
      ? await admin
          .from("teammates")
          .select("name, role, active")
          .ilike("email", email)
          .maybeSingle()
      : { data: null as any };
    const onRoster = Boolean(teammate?.active && teammate?.role === "support");

    let action = "status";
    try {
      const body = await req.json();
      action = String(body?.action ?? "status");
    } catch {
      /* default status */
    }

    if (action === "disconnect") {
      const key = await getConnectionKeyForUser(gate.userId, SLACK_CONNECTOR_ID);
      if (key) {
        try {
          await disconnectAppUser({
            gatewayBaseUrl: GATEWAY_BASE_URL,
            connectionAPIKey: key,
            connectorId: SLACK_CONNECTOR_ID,
          });
        } catch (e) {
          console.error("gateway disconnect failed:", e);
        }
        await deleteConnectionForUser(gate.userId, SLACK_CONNECTOR_ID);
      }
      return json({ connected: false, onRoster });
    }

    const row = await getConnectionRowForUser(gate.userId, SLACK_CONNECTOR_ID);
    return json({
      connected: Boolean(row),
      onRoster,
      slackUserId: row?.slack_user_id ?? null,
      connectedAt: row?.updated_at ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    console.error("slack-user-connection error:", msg);
    return json({ error: msg }, 500);
  }
});
