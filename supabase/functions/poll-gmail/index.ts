import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordIntegrationHealth } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

type PollErrorCategory =
  | "oauth_tokens"
  | "token_refresh"
  | "scope_permission"
  | "gmail_transport"
  | "database";

class PollError extends Error {
  category: PollErrorCategory;
  status?: number;
  stage: "auth" | "preflight" | "list" | "message" | "insert";

  constructor(
    message: string,
    params: {
      category: PollErrorCategory;
      stage: "auth" | "preflight" | "list" | "message" | "insert";
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

/** Refresh the access token using the stored refresh token */
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
    throw new PollError(
      `Token refresh failed [${res.status}]: ${body.slice(0, 500)}`,
      { category: "token_refresh", stage: "auth", status: res.status },
    );
  }

  return res.json();
}

/** Make an authenticated Gmail API request */
async function gmailRequest(
  path: string,
  accessToken: string,
  stage: "preflight" | "list" | "message",
): Promise<Response> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    const normalized = body.toLowerCase();

    let category: PollErrorCategory = "gmail_transport";
    if (res.status === 401) category = "oauth_tokens";
    else if (
      res.status === 403 ||
      normalized.includes("insufficient") ||
      normalized.includes("scope")
    )
      category = "scope_permission";

    throw new PollError(
      `Gmail ${stage} failed [${res.status}]: ${body.slice(0, 500)}`,
      { category, stage, status: res.status },
    );
  }

  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    console.error("poll-gmail: GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET not configured");
    return new Response(
      JSON.stringify({ error: "Gmail OAuth credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Load stored OAuth tokens
    const { data: tokenRows, error: tokenError } = await supabase
      .from("gmail_oauth_tokens")
      .select("*")
      .limit(1)
      .order("created_at", { ascending: false });

    if (tokenError || !tokenRows?.length) {
      throw new PollError(
        "No Gmail OAuth tokens found. Please complete the Gmail OAuth flow first.",
        { category: "oauth_tokens", stage: "auth" },
      );
    }

    let tokenRow = tokenRows[0];
    let accessToken = tokenRow.access_token;

    // 2. Refresh token if expired (or within 2 min of expiry)
    const expiresAt = new Date(tokenRow.token_expires_at).getTime();
    if (Date.now() > expiresAt - 120_000) {
      console.log("poll-gmail: access token expired, refreshing…");
      const refreshed = await refreshAccessToken(
        tokenRow.refresh_token,
        clientId,
        clientSecret,
      );

      accessToken = refreshed.access_token;
      const newExpiresAt = new Date(
        Date.now() + refreshed.expires_in * 1000,
      ).toISOString();

      await supabase
        .from("gmail_oauth_tokens")
        .update({
          access_token: accessToken,
          token_expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", tokenRow.id);

      console.log("poll-gmail: token refreshed successfully");
    }

    // 3. Preflight check
    const preflightRes = await gmailRequest(
      "/users/me/profile",
      accessToken,
      "preflight",
    );
    const profile = await preflightRes.json();
    console.log(
      `poll-gmail: preflight ok for mailbox ${profile.emailAddress ?? "unknown"}`,
    );

    // 4. List recent messages
    const listRes = await gmailRequest(
      "/users/me/messages?maxResults=100&q=newer_than:1d",
      accessToken,
      "list",
    );

    const listData = await listRes.json();
    const messageIds: string[] = (listData.messages || []).map(
      (m: any) => m.id,
    );

    if (messageIds.length === 0) {
      console.log("No new messages found");
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Fetch and insert each message
    let inserted = 0;

    for (const msgId of messageIds) {
      const msgRes = await gmailRequest(
        `/users/me/messages/${msgId}?format=metadata`,
        accessToken,
        "message",
      );

      const msg = await msgRes.json();
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find(
          (h: any) => h.name.toLowerCase() === name.toLowerCase(),
        )?.value || null;

      const fromRaw = getHeader("From") || "";
      const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
      const fromName = fromMatch
        ? fromMatch[1].replace(/^"|"$/g, "").trim()
        : fromRaw;
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw;

      const subject = getHeader("Subject") || "(no subject)";
      const toEmails = getHeader("To") || null;
      const ccEmails = getHeader("Cc") || null;
      const dateStr = getHeader("Date");
      const dateCandidate = dateStr
        ? new Date(dateStr)
        : new Date(Number(msg.internalDate));
      const receivedAt = Number.isNaN(dateCandidate.getTime())
        ? new Date().toISOString()
        : dateCandidate.toISOString();

      // Inherit metadata from existing sibling in same thread
      let inherited: Record<string, any> = {};
      if (msg.threadId) {
        const { data: sibling } = await supabase
          .from("gmail_conversations")
          .select("owner, classification, product_area, is_bug, is_feature_request, intercom_conversation_id")
          .eq("gmail_thread_id", msg.threadId)
          .not("owner", "is", null)
          .order("received_at", { ascending: false })
          .limit(1);
        if (sibling?.length) {
          inherited = {
            owner: sibling[0].owner,
            classification: sibling[0].classification,
            product_area: sibling[0].product_area,
            is_bug: sibling[0].is_bug,
            is_feature_request: sibling[0].is_feature_request,
            intercom_conversation_id: sibling[0].intercom_conversation_id,
          };
        }
      }

      const { error } = await supabase.from("gmail_conversations").insert({
        ...inherited,
        gmail_message_id: msgId,
        gmail_thread_id: msg.threadId || null,
        from_email: fromEmail,
        from_name: fromName,
        subject,
        received_at: receivedAt,
        snippet: msg.snippet || null,
        to_emails: toEmails,
        cc_emails: ccEmails,
      });

      if (error) {
        if (error.code === "23505") continue;
        throw new PollError(`Insert error for ${msgId}: ${error.message}`, {
          category: "database",
          stage: "insert",
        });
      }
      inserted++;
    }

    // 6. Update high-water mark
    await supabase
      .from("settings")
      .update({ gmail_last_polled_at: new Date().toISOString() })
      .not("id", "is", null);

    // 7. Reconcile pending Intercom links — close the webhook→poll race window.
    // For every queued pending row, look for a Gmail thread with the same normalized
    // subject whose received_at is within ±15 min of the Intercom created_at. If found,
    // stamp the Gmail thread with intercom_conversation_id and delete the pending row.
    let reconciled = 0;
    try {
      const { data: pending } = await supabase
        .from("pending_intercom_links")
        .select("id, intercom_conversation_id, normalized_subject, intercom_created_at, resolved_owner");

      if (pending && pending.length > 0) {
        const normalize = (s: string) =>
          (s || "").replace(/^(Re|Fwd|Fw):\s*/gi, "").replace(/\s+/g, " ").toLowerCase().trim();

        for (const p of pending) {
          const icMs = new Date(p.intercom_created_at).getTime();
          const windowStart = new Date(icMs - 15 * 60 * 1000).toISOString();
          const windowEnd = new Date(icMs + 15 * 60 * 1000).toISOString();

          const { data: candidates } = await supabase
            .from("gmail_conversations")
            .select("id, gmail_thread_id, subject, intercom_conversation_id, received_at")
            .gte("received_at", windowStart)
            .lte("received_at", windowEnd)
            .order("received_at", { ascending: false })
            .limit(50);

          const matched = (candidates || []).filter(
            (r) => normalize(String(r.subject || "")) === p.normalized_subject,
          );
          if (matched.length === 0) continue;

          // If any sibling on the matched thread is already linked to a different
          // Intercom ticket, log a conflict and delete the pending row (duplicate).
          const threadId = matched[0].gmail_thread_id;
          if (!threadId) continue;

          const { data: siblings } = await supabase
            .from("gmail_conversations")
            .select("intercom_conversation_id")
            .eq("gmail_thread_id", threadId)
            .not("intercom_conversation_id", "is", null);

          const conflicting = (siblings || []).find(
            (s) =>
              s.intercom_conversation_id &&
              s.intercom_conversation_id !== p.intercom_conversation_id,
          );

          if (conflicting) {
            console.warn(
              `[pending-reconcile-conflict] Pending Intercom ${p.intercom_conversation_id} matched Gmail thread ${threadId} already linked to ${conflicting.intercom_conversation_id}; dropping pending row.`,
            );
            await supabase.from("pending_intercom_links").delete().eq("id", p.id);
            continue;
          }

          const updatePayload: Record<string, unknown> = {
            intercom_conversation_id: p.intercom_conversation_id,
          };
          if (p.resolved_owner) updatePayload.owner = p.resolved_owner;

          const { error: stampErr } = await supabase
            .from("gmail_conversations")
            .update(updatePayload)
            .eq("gmail_thread_id", threadId)
            .or(
              `intercom_conversation_id.is.null,intercom_conversation_id.eq.${p.intercom_conversation_id}`,
            );

          if (stampErr) {
            console.error("[pending-reconcile-stamp-error]", p.id, stampErr);
            continue;
          }

          await supabase.from("pending_intercom_links").delete().eq("id", p.id);
          reconciled++;
          console.log(
            `[pending-reconcile-ok] Linked Intercom ${p.intercom_conversation_id} to Gmail thread ${threadId} via subject "${p.normalized_subject}"`,
          );
        }
      }
    } catch (reconcileErr) {
      console.error("[pending-reconcile-fatal]", reconcileErr);
    }

    console.log(
      `Processed ${messageIds.length} messages, inserted ${inserted} new, reconciled ${reconciled} pending Intercom links`,
    );
    await recordIntegrationHealth(supabase, "gmail_poll", "ok");


    return new Response(
      JSON.stringify({
        ok: true,
        processed: messageIds.length,
        inserted,
        reconciled,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

    const healthStatus = category === "oauth_tokens" || category === "token_refresh" || category === "scope_permission" ? "auth_error" : "error";
    await recordIntegrationHealth(supabase, "gmail_poll", healthStatus, `${category}/${stage} ${status ?? ""}: ${err instanceof Error ? err.message.slice(0, 200) : ""}`);


    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        category,
        stage,
        status,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
