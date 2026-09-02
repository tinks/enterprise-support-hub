import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "Gmail OAuth not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get OAuth tokens
    const { data: tokenRows } = await supabase
      .from("gmail_oauth_tokens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (!tokenRows?.length) {
      return new Response(JSON.stringify({ error: "No Gmail OAuth tokens" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let tokenRow = tokenRows[0];
    let accessToken = tokenRow.access_token;

    // Refresh if needed
    const expiresAt = new Date(tokenRow.token_expires_at).getTime();
    if (Date.now() > expiresAt - 120_000) {
      const refreshed = await refreshAccessToken(tokenRow.refresh_token, clientId, clientSecret);
      accessToken = refreshed.access_token;
      await supabase
        .from("gmail_oauth_tokens")
        .update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", tokenRow.id);
    }

    // Get rows missing to_emails
    const { data: rows, error: fetchErr } = await supabase
      .from("gmail_conversations")
      .select("id, gmail_message_id")
      .is("to_emails", null);

    if (fetchErr) throw fetchErr;
    if (!rows?.length) {
      return new Response(JSON.stringify({ ok: true, updated: 0, message: "Nothing to backfill" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`backfill-gmail-headers: ${rows.length} rows to process`);
    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const res = await fetch(
          `${GMAIL_API}/users/me/messages/${row.gmail_message_id}?format=metadata`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!res.ok) {
          console.warn(`Failed to fetch ${row.gmail_message_id}: ${res.status}`);
          errors++;
          continue;
        }

        const msg = await res.json();
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || null;

        const toEmails = getHeader("To");
        const ccEmails = getHeader("Cc");

        await supabase
          .from("gmail_conversations")
          .update({ to_emails: toEmails, cc_emails: ccEmails })
          .eq("id", row.id);

        updated++;

        // Rate limit: 50ms between requests
        await new Promise((r) => setTimeout(r, 50));
      } catch (e) {
        console.warn(`Error processing ${row.gmail_message_id}:`, e);
        errors++;
      }
    }

    console.log(`backfill-gmail-headers: updated ${updated}, errors ${errors}`);

    return new Response(
      JSON.stringify({ ok: true, total: rows.length, updated, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("backfill-gmail-headers error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
