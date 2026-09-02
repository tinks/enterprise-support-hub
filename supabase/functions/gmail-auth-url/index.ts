import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Minting a Google consent URL starts a flow that can REPLACE the Hub's
  // Gmail tokens, so only signed-in editors may do it.
  const auth = await requireEditor(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  if (!clientId) {
    return new Response(JSON.stringify({ error: "GMAIL_CLIENT_ID not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;

  // Single-use CSRF nonce: the callback refuses any code that does not carry a
  // state we minted here and have not already consumed.
  const state = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { error: stateError } = await admin
    .from("gmail_oauth_states")
    .insert({ state, created_by: auth.userId });

  if (stateError) {
    console.error("Failed to store OAuth state:", stateError);
    return new Response(JSON.stringify({ error: "Could not start OAuth flow" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Response(JSON.stringify({ url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
