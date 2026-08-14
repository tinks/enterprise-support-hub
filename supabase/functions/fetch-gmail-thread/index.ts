import { requireUser } from "../_shared/require-user.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function extractBody(payload: any): string {
  // Try to find text/plain part first, then text/html
  if (payload.parts) {
    // Recurse into multipart
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return stripHtml(decodeBase64Url(part.body.data));
      }
    }
    // Recurse deeper (e.g. multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  // Single-part message
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(decoded) : decoded;
  }

  return "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const auth = await requireUser(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: "Gmail OAuth not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { threadId } = await req.json();
  if (!threadId) {
    return new Response(JSON.stringify({ error: "threadId is required" }), {
      status: 400,
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

    // Fetch full thread
    const res = await fetch(
      `${GMAIL_API}/users/me/threads/${threadId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`Gmail thread fetch failed [${res.status}]:`, body.slice(0, 500));
      return new Response(JSON.stringify({ error: `Gmail API error: ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const thread = await res.json();
    const messages = (thread.messages || []).map((msg: any) => {
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || null;

      const fromRaw = getHeader("From") || "";
      const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
      const from_name = fromMatch ? fromMatch[1].replace(/^"|"$/g, "").trim() : fromRaw;
      const from_email = fromMatch ? fromMatch[2] : fromRaw;

      const dateStr = getHeader("Date");
      const date = dateStr
        ? new Date(dateStr).toISOString()
        : new Date(Number(msg.internalDate)).toISOString();

      const body = extractBody(msg.payload);

      return {
        id: msg.id,
        from_name,
        from_email,
        date,
        body,
        snippet: msg.snippet || "",
      };
    });

    // Sort chronologically
    messages.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return new Response(JSON.stringify({ messages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("fetch-gmail-thread error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
