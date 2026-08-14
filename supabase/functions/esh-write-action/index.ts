// esh-write-action — the single choke point for every Hub-originated write to a
// ticket. Nothing else in the app is allowed to call Intercom or to write the
// Intercom-owned columns of intercom_tickets_v3.
//
// Contract (write-through, until authority flips):
//   1. authenticate the caller and resolve them to a teammate + Intercom admin id
//   2. check the global kill switch and the per-action allowlist
//   3. call Intercom AS THAT TEAMMATE, wait for the 2xx
//   4. re-read the conversation from Intercom
//   5. only then update the local row from what Intercom actually returned
//
// If Intercom rejects, the local row is NOT touched and the caller gets the
// provider status + body. Every attempt — succeeded, blocked, failed — writes an
// append-only row to esh_ticket_actions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13"; // pinned to match the v3 sync functions

// Step 1 ships exactly one action. Anything else is refused by name, even if a
// caller guesses the shape.
const KNOWN_ACTIONS = ["set_severity"] as const;
type Action = (typeof KNOWN_ACTIONS)[number];

const SEVERITY_VALUES = ["1", "2", "3", "4"];

type Json = Record<string, unknown>;

function json(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Audit is best-effort but never skipped for a real attempt.
  let audit: Json = {};
  const log = async (
    outcome: "succeeded" | "blocked" | "failed",
    extra: Json = {},
  ) => {
    try {
      await supabase.from("esh_ticket_actions").insert({
        outcome,
        ...audit,
        ...extra,
      });
    } catch (e) {
      console.error("audit insert failed:", e);
    }
  };

  try {
    // ─── 1. who is calling ───
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await anon.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    const claims = claimsData?.claims;
    if (claimsErr || !claims?.sub) return json({ error: "Unauthorized" }, 401);

    const actorUserId = claims.sub as string;
    const actorEmail = (claims.email as string | undefined)?.toLowerCase() ?? null;

    // ─── 2. what are they asking for ───
    let body: Json;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const conversationId = String(body.conversationId ?? "").trim();
    const action = String(body.action ?? "").trim() as Action;
    const payload = (body.payload ?? {}) as Json;

    if (!conversationId) return json({ error: "conversationId is required" }, 400);
    if (!action) return json({ error: "action is required" }, 400);

    audit = {
      intercom_conversation_id: conversationId,
      action,
      actor_user_id: actorUserId,
      actor_email: actorEmail,
      payload,
    };

    if (!KNOWN_ACTIONS.includes(action)) {
      await log("blocked", { error: `Unknown action: ${action}` });
      return json({ error: `Unknown action: ${action}`, blocked: true }, 400);
    }

    // ─── 3. kill switch + allowlist ───
    const { data: settings } = await supabase
      .from("settings")
      .select("esh_write_enabled, esh_write_allowed_actions")
      .limit(1)
      .maybeSingle();

    if (!settings?.esh_write_enabled) {
      const msg = "Hub writes are disabled (kill switch off)";
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }
    const allowed: string[] = settings.esh_write_allowed_actions ?? [];
    if (!allowed.includes(action)) {
      const msg = `Action '${action}' is not in the allowlist`;
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }

    // ─── 4. resolve the acting teammate ───
    // Writes must be attributed to the human, not to a generic bot admin, or the
    // SLA actor classification starts measuring the Hub instead of the team.
    if (!actorEmail) {
      const msg = "Caller has no email claim; cannot attribute the write";
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }
    const { data: teammate } = await supabase
      .from("teammates")
      .select("name, intercom_admin_id, active")
      .ilike("email", actorEmail)
      .maybeSingle();

    if (!teammate?.intercom_admin_id || !teammate.active) {
      const msg = `No active teammate with an Intercom admin id for ${actorEmail}`;
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }
    audit = {
      ...audit,
      actor_teammate_name: teammate.name,
      actor_intercom_admin_id: teammate.intercom_admin_id,
    };

    const token = Deno.env.get("INTERCOM_API_TOKEN");
    if (!token) {
      await log("failed", { error: "INTERCOM_API_TOKEN not configured" });
      return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": INTERCOM_VERSION,
    };

    // ─── 5. build the Intercom call ───
    let request: { method: string; path: string; body: Json };

    if (action === "set_severity") {
      const severity = String(payload.severity ?? "").trim();
      if (!SEVERITY_VALUES.includes(severity)) {
        const msg = `severity must be one of ${SEVERITY_VALUES.join(", ")}`;
        await log("blocked", { error: msg });
        return json({ error: msg, blocked: true }, 400);
      }
      request = {
        method: "PUT",
        path: `/conversations/${conversationId}`,
        body: { custom_attributes: { Severity: severity } },
      };
    } else {
      const msg = `Action '${action}' has no handler`;
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 400);
    }

    // ─── 6. write through to Intercom ───
    const res = await fetch(`${INTERCOM_BASE}${request.path}`, {
      method: request.method,
      headers,
      body: JSON.stringify(request.body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`Intercom ${request.method} ${request.path} [${res.status}]: ${text.slice(0, 500)}`);
      await log("failed", {
        intercom_status: res.status,
        error: text.slice(0, 2000),
      });
      // Local row deliberately untouched — the Hub never records a value
      // Intercom refused.
      return json(
        { error: "Intercom rejected the write", status: res.status, details: text.slice(0, 2000) },
        502,
      );
    }

    // ─── 7. re-read, then mirror what Intercom actually holds ───
    const readRes = await fetch(`${INTERCOM_BASE}/conversations/${conversationId}`, { headers });
    const readText = await readRes.text();
    if (!readRes.ok) {
      await log("failed", {
        intercom_status: readRes.status,
        error: `write succeeded but re-read failed: ${readText.slice(0, 1000)}`,
      });
      return json(
        {
          error: "Write succeeded but the verification read failed; local row not updated",
          status: readRes.status,
          details: readText.slice(0, 1000),
        },
        502,
      );
    }
    const conv = JSON.parse(readText);
    const attrs = conv?.custom_attributes ?? {};

    const { error: updErr } = await supabase
      .from("intercom_tickets_v3")
      .update({
        custom_attributes: attrs,
        state: conv?.state ?? undefined,
        intercom_updated_at: conv?.updated_at
          ? new Date(conv.updated_at * 1000).toISOString()
          : undefined,
        last_synced_at: new Date().toISOString(),
      })
      .eq("intercom_conversation_id", conversationId);

    if (updErr) {
      await log("failed", {
        intercom_status: res.status,
        error: `Intercom accepted the write but the local mirror update failed: ${updErr.message}`,
      });
      return json(
        { error: "Intercom updated, local mirror did not. Next sync will reconcile.", details: updErr.message },
        500,
      );
    }

    await log("succeeded", {
      intercom_status: res.status,
      intercom_response: { custom_attributes: attrs, state: conv?.state ?? null },
    });

    return json({
      success: true,
      action,
      conversationId,
      actor: teammate.name,
      custom_attributes: attrs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    console.error("esh-write-action error:", msg);
    await log("failed", { error: msg });
    return json({ error: msg }, 500);
  }
});
