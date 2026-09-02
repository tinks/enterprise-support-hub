import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATE_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    return new Response(`<html><body><h2>OAuth error</h2><p>${escapeHtml(error)}</p></body></html>`, {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code) {
    return new Response(`<html><body><h2>Missing authorization code</h2></body></html>`, {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;

  const supabaseAdmin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // ---- CSRF gate: validate the single-use state BEFORE touching any token ----
  const rejectState = (reason: string) =>
    new Response(
      `<html><body style="font-family:system-ui;text-align:center;padding:60px">
        <h2>Invalid OAuth request</h2><p>${escapeHtml(reason)}</p>
        <p>Start the connection again from the Hub.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );

  if (!state) return rejectState("Missing state parameter.");

  const { data: stateRow, error: stateLookupError } = await supabaseAdmin
    .from("gmail_oauth_states")
    .select("state, created_at, consumed_at")
    .eq("state", state)
    .maybeSingle();

  if (stateLookupError) {
    console.error("State lookup failed:", stateLookupError);
    return rejectState("Could not validate the request.");
  }
  if (!stateRow) return rejectState("Unknown state parameter.");
  if (stateRow.consumed_at) return rejectState("This authorization link was already used.");
  if (Date.now() - new Date(stateRow.created_at).getTime() > STATE_TTL_MS) {
    return rejectState("This authorization link has expired.");
  }
  // ---- end CSRF gate ----

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", tokenData);
    return new Response(
      `<html><body><h2>Token exchange failed</h2><pre>${escapeHtml(JSON.stringify(tokenData, null, 2))}</pre></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  const { access_token, refresh_token, expires_in } = tokenData;
  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000).toISOString();

  // Get email address from userinfo
  let emailAddress: string | null = null;
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      emailAddress = profile.email ?? null;
    }
  } catch (e) {
    console.warn("Could not fetch user profile:", e);
  }

  const supabase = supabaseAdmin;

  // Burn the nonce now that the exchange succeeded — a replay of this callback
  // URL will be rejected by the state gate above.
  await supabase
    .from("gmail_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state);

  // Upsert: keep only one row (delete old, insert new)
  await supabase.from("gmail_oauth_tokens").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  const { error: insertError } = await supabase.from("gmail_oauth_tokens").insert({
    access_token,
    refresh_token,
    token_expires_at: tokenExpiresAt,
    email_address: emailAddress,
  });

  if (insertError) {
    console.error("Failed to store tokens:", insertError);
    return new Response(
      `<html><body><h2>Failed to store tokens</h2><pre>${escapeHtml(insertError.message)}</pre></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }

  return new Response(
    `<html><body style="font-family:system-ui;text-align:center;padding:60px">
      <h2>✅ Gmail connected successfully</h2>
      <p>Connected as <strong>${escapeHtml(emailAddress ?? "unknown")}</strong></p>
      <p>You can close this window and return to the app.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
});
