import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

type PollErrorCategory =
  | "connector_credentials"
  | "scope_permission"
  | "gmail_transport"
  | "database";

class PollError extends Error {
  category: PollErrorCategory;
  status?: number;
  stage: "preflight" | "list" | "message" | "insert";

  constructor(
    message: string,
    params: {
      category: PollErrorCategory;
      stage: "preflight" | "list" | "message" | "insert";
      status?: number;
    },
  ) {
    super(message);
    this.name = "PollError";
    this.category = params.category;
    this.stage = params.stage;
    this.status = params.status;
  }
}

const classifyGatewayError = (
  status: number,
  body: string,
): { category: PollErrorCategory; hint: string } => {
  const normalized = body.toLowerCase();

  if (
    status === 401 &&
    (normalized.includes("credential not found") ||
      normalized.includes("unauthorized"))
  ) {
    return {
      category: "connector_credentials",
      hint:
        "Gmail connector credentials are not resolving in the gateway. Reconnect the same Gmail mailbox and retry.",
    };
  }

  if (
    status === 403 ||
    normalized.includes("insufficient") ||
    normalized.includes("permission") ||
    normalized.includes("scope")
  ) {
    return {
      category: "scope_permission",
      hint:
        "Gmail permissions are insufficient. Ensure the connection includes gmail.modify scope.",
    };
  }

  return {
    category: "gmail_transport",
    hint: "Gmail API request failed. Retry and inspect gateway/Gmail status.",
  };
};

const parseGatewayBody = async (res: Response): Promise<string> => {
  const text = await res.text();
  return text.length > 700 ? `${text.slice(0, 700)}…` : text;
};

const makeGatewayRequest = async (
  path: string,
  stage: "preflight" | "list" | "message",
  headers: Record<string, string>,
) => {
  const res = await fetch(`${GATEWAY_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await parseGatewayBody(res);
    const { category, hint } = classifyGatewayError(res.status, body);
    throw new PollError(
      `Gmail ${stage} failed [${res.status}]: ${body}. ${hint}`,
      { category, stage, status: res.status },
    );
  }
  return res;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("poll-gmail: LOVABLE_API_KEY secret is missing from project");
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const GOOGLE_MAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!GOOGLE_MAIL_API_KEY) {
    console.error("poll-gmail: GOOGLE_MAIL_API_KEY secret is missing — is the Gmail connector linked?");
    return new Response(JSON.stringify({ error: "GOOGLE_MAIL_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  console.log("poll-gmail: secrets loaded, calling Gmail API…");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const gatewayHeaders = {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
  };

  try {
    const preflightRes = await makeGatewayRequest(
      "/users/me/profile",
      "preflight",
      gatewayHeaders,
    );
    const profile = await preflightRes.json();
    console.log(
      `poll-gmail: preflight ok for mailbox ${profile.emailAddress ?? "unknown"}`,
    );

    const listRes = await makeGatewayRequest(
      "/users/me/messages?maxResults=100&q=newer_than:1d",
      "list",
      gatewayHeaders,
    );

    const listData = await listRes.json();
    const messageIds: string[] = (listData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      console.log("No new messages found");
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;

    for (const msgId of messageIds) {
      const msgRes = await makeGatewayRequest(
        `/users/me/messages/${msgId}?format=metadata`,
        "message",
        gatewayHeaders,
      );

      const msg = await msgRes.json();
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || null;

      const fromRaw = getHeader("From") || "";
      // Parse "Name <email>" format
      const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
      const fromName = fromMatch ? fromMatch[1].replace(/^"|"$/g, "").trim() : fromRaw;
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw;

      const subject = getHeader("Subject") || "(no subject)";
      const dateStr = getHeader("Date");
      const dateCandidate = dateStr
        ? new Date(dateStr)
        : new Date(Number(msg.internalDate));
      const receivedAt = Number.isNaN(dateCandidate.getTime())
        ? new Date().toISOString()
        : dateCandidate.toISOString();

      const { error } = await supabase.from("gmail_conversations").insert({
        gmail_message_id: msgId,
        gmail_thread_id: msg.threadId || null,
        from_email: fromEmail,
        from_name: fromName,
        subject,
        received_at: receivedAt,
        snippet: msg.snippet || null,
      });

      if (error) {
        // Unique constraint violation = already exists, skip
        if (error.code === "23505") continue;
        throw new PollError(`Insert error for ${msgId}: ${error.message}`, {
          category: "database",
          stage: "insert",
        });
      }
      inserted++;
    }

    // Update high-water mark
    await supabase
      .from("settings")
      .update({ gmail_last_polled_at: new Date().toISOString() })
      .not("id", "is", null);

    console.log(`Processed ${messageIds.length} messages, inserted ${inserted} new`);

    return new Response(
      JSON.stringify({ ok: true, processed: messageIds.length, inserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof PollError ? err : null;
    const category = error?.category ?? "gmail_transport";
    const stage = error?.stage ?? "list";
    const status = error?.status;

    console.error("poll-gmail error:", {
      category,
      stage,
      status,
      message: err instanceof Error ? err.message : "Unknown error",
    });

    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        category,
        stage,
        status,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
