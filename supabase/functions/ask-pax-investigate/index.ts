// ask-pax-investigate — one-click "ask Pax to look at this ticket".
//
// Narrow, deliberate exception to the v3 read-only posture. It writes exactly
// two things and nothing else:
//   1. a message in the Pax help Slack channel naming the Intercom conversation
//   2. ONE internal note on that Intercom conversation carrying the Slack
//      thread permalink
//
// It never writes a customer-facing reply and never touches an Intercom-owned
// column of intercom_tickets_v3.
//
// Idempotency: `pax_investigations` has the conversation id as PRIMARY KEY.
// A repeat click never posts a second Pax request — it returns the existing
// thread. If Slack succeeded but the Intercom note failed, the row stays at
// note_state='failed' and the UI shows an explicit Retry link action, which
// runs mode="retry_note" and re-attempts ONLY the note.
//
// Attribution: the note is authored as the acting teammate's Intercom admin id,
// never a generic bot admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";
import { callAsAppUser, appUserReconnectRequired } from "../_shared/appUserConnector.ts";
import { getConnectionKeyForUser } from "../_shared/appUserConnections.ts";
import { GATEWAY_BASE_URL, SLACK_CONNECTOR_ID, SLACK_SCOPES } from "../_shared/appUserScopes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13";
const SLACK_API = "https://slack.com/api";
const PAX_CHANNEL_NAME = "pax-ets-help";

const DEFAULT_TEMPLATE =
  "{pax} please take a look at this Intercom conversation.\n{url}\nConversation ID: {id}\nSubject: {subject}";

type Json = Record<string, unknown>;

function json(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function intercomUrl(id: string) {
  return `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;
}

/**
 * Every Slack call runs as the teammate who clicked the button, through their
 * own App User Connector connection. Pax responds differently to a human than
 * to a bot, so there is deliberately NO shared-bot fallback: if the teammate
 * has not connected Slack, the request is refused.
 */
async function slack(key: string, method: string, body: Json) {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: key,
    connectorId: SLACK_CONNECTOR_ID,
    path: `/api/${method}`,
    requiredScopes: SLACK_SCOPES,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    },
  });
  if (await appUserReconnectRequired(res)) {
    throw new Error("SLACK_RECONNECT_REQUIRED");
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Slack ${method} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? res.status}`);
  return data;
}

/** Some Slack methods (chat.getPermalink) only accept query params. */
async function slackGet(key: string, method: string, params: Record<string, string>) {
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: key,
    connectorId: SLACK_CONNECTOR_ID,
    path: `/api/${method}?${new URLSearchParams(params)}`,
    requiredScopes: SLACK_SCOPES,
    init: { method: "GET" },
  });
  if (await appUserReconnectRequired(res)) throw new Error("SLACK_RECONNECT_REQUIRED");
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Slack ${method} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? res.status}`);
  return data;
}

/** Channel id from settings/env, else resolved by name once. */
async function resolveChannel(key: string, configured: string | null): Promise<string> {
  const fromEnv = Deno.env.get("PAX_HELP_CHANNEL_ID");
  if (fromEnv) return fromEnv;
  if (configured) return configured;
  let cursor = "";
  do {
    const params: Record<string, string> = {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;
    const data = await slackGet(key, "conversations.list", params);
    const hit = (data.channels ?? []).find((c: any) => c.name === PAX_CHANNEL_NAME);
    if (hit) return hit.id as string;
    cursor = data.response_metadata?.next_cursor ?? "";
  } while (cursor);
  throw new Error(`Slack channel #${PAX_CHANNEL_NAME} not found for your account`);
}

/**
 * Pax only runs on a real Slack mention — plain "@Pax" text is inert.
 */
async function resolvePaxUserId(key: string, configured: string | null): Promise<string | null> {
  const fromEnv = Deno.env.get("PAX_SLACK_USER_ID");
  if (fromEnv) return fromEnv;
  if (configured) return configured;
  let cursor = "";
  do {
    const params: Record<string, string> = { limit: "200" };
    if (cursor) params.cursor = cursor;
    const data = await slackGet(key, "users.list", params);
    const hit = (data.members ?? []).find((m: any) => {
      if (m.deleted) return false;
      const names = [m.name, m.real_name, m.profile?.display_name, m.profile?.real_name]
        .filter(Boolean)
        .map((n: string) => n.toLowerCase());
      return names.includes("pax");
    });
    if (hit) return hit.id as string;
    cursor = data.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let audit: Json = {};
  const log = async (outcome: "succeeded" | "blocked" | "failed", extra: Json = {}) => {
    try {
      await supabase.from("esh_ticket_actions").insert({ outcome, ...audit, ...extra });
    } catch (e) {
      console.error("audit insert failed:", e);
    }
  };

  try {
    const authHeader = req.headers.get("Authorization")!;
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData } = await anon.auth.getClaims(authHeader.replace("Bearer ", ""));
    const claims = claimsData?.claims;
    if (!claims?.sub) return json({ error: "Unauthorized" }, 401);
    const actorUserId = claims.sub as string;
    const actorEmail = (claims.email as string | undefined)?.toLowerCase() ?? null;

    let body: Json;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    const conversationId = String(body.conversationId ?? "").trim();
    const mode = String(body.mode ?? "start");
    if (!conversationId) return json({ error: "conversationId is required" }, 400);
    if (mode !== "start" && mode !== "retry_note") {
      return json({ error: `Unknown mode '${mode}'`, blocked: true }, 400);
    }

    audit = {
      intercom_conversation_id: conversationId,
      action: mode === "retry_note" ? "pax_retry_note" : "ask_pax_investigate",
      actor_user_id: actorUserId,
      actor_email: actorEmail,
      payload: { mode },
    };

    // Kill switch — the same global switch that gates every other Hub write.
    const { data: settings } = await supabase
      .from("settings")
      .select("id, esh_write_enabled, pax_help_channel_id, pax_request_template, pax_slack_user_id")
      .limit(1)
      .maybeSingle();
    if (!settings?.esh_write_enabled) {
      const msg = "Hub writes are disabled (kill switch off)";
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }

    if (!actorEmail) {
      const msg = "Caller has no email claim; cannot attribute the note";
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }
    const { data: teammate } = await supabase
      .from("teammates")
      .select("name, intercom_admin_id, active, role")
      .ilike("email", actorEmail)
      .maybeSingle();
    if (!teammate?.intercom_admin_id || !teammate.active || teammate.role !== "support") {
      const msg = `Ask Pax is limited to active Enterprise Support teammates (${actorEmail})`;
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true }, 403);
    }
    audit = {
      ...audit,
      actor_teammate_name: teammate.name,
      actor_intercom_admin_id: teammate.intercom_admin_id,
    };

    const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
    if (!intercomToken) {
      const msg = "INTERCOM_API_TOKEN not configured";
      await log("failed", { error: msg });
      return json({ error: msg }, 500);
    }

    // Post as the human who clicked — never as the shared bot.
    const slackKey = await getConnectionKeyForUser(actorUserId, SLACK_CONNECTOR_ID);
    if (!slackKey && mode === "start") {
      const msg = "Connect your Slack account first — Pax only answers people, not bots.";
      await log("blocked", { error: msg });
      return json({ error: msg, blocked: true, slackConnectRequired: true }, 409);
    }
    const icHeaders = {
      Authorization: `Bearer ${intercomToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": INTERCOM_VERSION,
    };

    const { data: existing } = await supabase
      .from("pax_investigations")
      .select("*")
      .eq("intercom_conversation_id", conversationId)
      .maybeSingle();

    // ── retry_note: note only, never a second Pax request ──
    if (mode === "retry_note") {
      if (!existing) {
        const msg = "No Pax investigation exists for this ticket yet";
        await log("blocked", { error: msg });
        return json({ error: msg, blocked: true }, 409);
      }
      if (existing.note_state === "linked") {
        await log("succeeded", { error: null });
        return json({ success: true, alreadyLinked: true, investigation: existing });
      }
    } else if (existing) {
      // Repeat click — surface what already exists, post nothing.
      await log("blocked", { error: "Pax was already asked for this ticket" });
      return json({ success: true, alreadyRequested: true, investigation: existing });
    }

    let row = existing;

    // ── 1. Slack: ask Pax ──
    if (!row) {
      const channel = await resolveChannel(slackKey!, settings.pax_help_channel_id ?? null);

      const { data: ticket } = await supabase
        .from("intercom_tickets_v3")
        .select("subject")
        .eq("intercom_conversation_id", conversationId)
        .maybeSingle();

      // A real mention is what actually triggers Pax; "@Pax" as plain text does nothing.
      const paxUserId = await resolvePaxUserId(slackKey!, (settings as any).pax_slack_user_id ?? null);
      if (!paxUserId) {
        const msg =
          "Could not find the Pax bot in Slack. Set settings.pax_slack_user_id to Pax's member ID.";
        await log("blocked", { error: msg });
        return json({ error: msg, blocked: true }, 409);
      }
      if (!(settings as any).pax_slack_user_id && (settings as any).id) {
        await supabase
          .from("settings")
          .update({ pax_slack_user_id: paxUserId })
          .eq("id", (settings as any).id);
      }
      const mention = `<@${paxUserId}>`;

      const template = (settings.pax_request_template || DEFAULT_TEMPLATE) as string;
      const text = template
        .replaceAll("{pax}", mention)
        .replaceAll("@Pax", mention)
        .replaceAll("{url}", intercomUrl(conversationId))
        .replaceAll("{id}", conversationId)
        .replaceAll("{subject}", ticket?.subject ?? "(no subject)");

      const posted = await slack(slackKey!, "chat.postMessage", {
        channel,
        text,
        link_names: true,
        unfurl_links: false,
        unfurl_media: false,
      });
      const ts = String(posted.ts);

      let permalink: string | null = null;
      try {
        const pl = await slackGet(slackKey!, "chat.getPermalink", { channel, message_ts: ts });
        permalink = String(pl.permalink);
      } catch (e) {
        console.error("permalink lookup failed:", e);
      }

      const { data: inserted, error: insErr } = await supabase
        .from("pax_investigations")
        .insert({
          intercom_conversation_id: conversationId,
          slack_channel_id: channel,
          slack_thread_ts: ts,
          slack_permalink: permalink,
          note_state: "pending",
          requested_by: actorUserId,
          requested_by_name: teammate.name,
          requested_by_email: actorEmail,
        })
        .select()
        .single();
      if (insErr || !inserted) {
        const msg = `Slack request posted but the Hub record failed: ${insErr?.message}`;
        await log("failed", { error: msg });
        return json({ error: msg }, 500);
      }
      row = inserted;
    }

    // ── 2. Intercom: one internal note carrying the Slack thread link ──
    const link = row!.slack_permalink;
    const noteBody =
      `<p><b>Pax investigation requested from the Enterprise Support Hub</b> by ${teammate.name}.</p>` +
      (link
        ? `<p>Slack thread: <a href="${link}">${link}</a></p>`
        : `<p>Slack thread: #${PAX_CHANNEL_NAME} (permalink unavailable, ts ${row!.slack_thread_ts})</p>`) +
      `<p>Bot findings stay in that thread — open it for the full investigation.</p>`;

    const noteRes = await fetch(`${INTERCOM_BASE}/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: icHeaders,
      body: JSON.stringify({
        message_type: "note",
        type: "admin",
        admin_id: teammate.intercom_admin_id,
        body: noteBody,
      }),
    });
    const noteText = await noteRes.text();

    if (!noteRes.ok) {
      const msg = noteText.slice(0, 1000);
      await supabase
        .from("pax_investigations")
        .update({ note_state: "failed", note_error: msg, updated_at: new Date().toISOString() })
        .eq("intercom_conversation_id", conversationId);
      await log("failed", { intercom_status: noteRes.status, error: `note write failed: ${msg}` });
      // Deliberately NOT retried here — the UI shows an explicit retry action.
      return json(
        {
          error: "Pax was asked in Slack, but linking the note into Intercom failed.",
          noteFailed: true,
          status: noteRes.status,
          details: msg,
          investigation: { ...row, note_state: "failed", note_error: msg },
        },
        502,
      );
    }

    const { data: updated } = await supabase
      .from("pax_investigations")
      .update({
        note_state: "linked",
        note_error: null,
        note_linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("intercom_conversation_id", conversationId)
      .select()
      .single();

    await log("succeeded", { intercom_status: noteRes.status });
    return json({ success: true, investigation: updated ?? row, actor: teammate.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal server error";
    console.error("ask-pax-investigate error:", msg);
    await log("failed", { error: msg });
    if (msg === "SLACK_RECONNECT_REQUIRED") {
      return json(
        {
          error: "Your Slack authorisation needs to be renewed before asking Pax.",
          blocked: true,
          slackConnectRequired: true,
        },
        409,
      );
    }
    return json({ error: msg }, 500);
  }
});
