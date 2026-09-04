// Poll the #incidents Slack channel (C07TMQ5E6SC) where the incident.io app
// posts ONE announcement per incident and EDITS it in place as the incident
// moves (Investigating -> Fixing -> Reviewing -> ...). We therefore re-read a
// rolling window every run and upsert by incident number; a wide window is
// idempotent and status changes land as updates, never as duplicates.
//
// Why Slack and not the incident.io API: the API connection is deliberately
// deferred (backlog, 4 Sep 2026). The Slack announcement is also the ONLY
// source that reveals customer impact — incident.io exposes no status-page
// endpoint (/v1/status_pages and /v1/status_page_incidents both 404), while
// the announcement carries a public statuspage.incident.io button when, and
// only when, the incident was published to customers.
//
// Health: every non-dry run writes integration_health.slack_incidents_poll.
// Diagnostics: POST { lookbackDays?, full?, dryRun? }.
// See .lovable/project-knowledge.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordIntegrationHealth } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CHANNEL_ID = "C07TMQ5E6SC";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const DEFAULT_LOOKBACK_DAYS = 2;
const CHANNEL_NAME_LOOKUP_CAP = 10;

// incident.io status -> lifecycle bucket. Anything not listed stays "unknown"
// and is reported, never guessed into "live" or "closed".
const STATUS_CATEGORY: Record<string, "live" | "post_incident" | "closed"> = {
  triage: "live",
  investigating: "live",
  identified: "live",
  fixing: "live",
  monitoring: "live",
  mitigated: "live",
  documenting: "post_incident",
  reviewing: "post_incident",
  "post-incident": "post_incident",
  resolved: "closed",
  closed: "closed",
  declined: "closed",
  canceled: "closed",
  cancelled: "closed",
  merged: "closed",
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 1,
  major: 2,
  minor: 3,
  maintenance: 4,
};

export interface ParsedIncident {
  incident_number: number;
  reference: string;
  title: string;
  severity: string | null;
  severity_rank: number | null;
  status: string | null;
  status_category: "live" | "post_incident" | "closed" | "unknown";
  is_customer_impacting: boolean;
  status_page_url: string | null;
  incident_url: string | null;
  internal_status_url: string | null;
  incident_channel_id: string | null;
  declared_at: string;
  last_update_at: string | null;
  slack_message_ts: string;
}

function walkBlocks(blocks: any[], visit: (node: any) => void) {
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    visit(node);
    for (const key of Object.keys(node)) {
      const v = (node as any)[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  blocks.forEach(walk);
}

/**
 * Parse one incident.io announcement. Returns null when the message is not an
 * incident announcement (a human comment in the channel, a bot post without an
 * incident homepage link, etc.) — those are counted, not force-fitted.
 */
export function parseAnnouncement(msg: any): ParsedIncident | null {
  const blocks: any[] = Array.isArray(msg?.blocks) ? msg.blocks : [];
  const urls: string[] = [];
  const sectionTexts: string[] = [];
  let headerText = "";

  walkBlocks(blocks, (node) => {
    if (typeof node.url === "string") urls.push(node.url);
    if (node.type === "header" && typeof node.text?.text === "string") {
      headerText = node.text.text;
    }
    if (node.type === "section" && typeof node.text?.text === "string") {
      sectionTexts.push(node.text.text);
    }
  });

  const homepage = urls.find((u) => /\/incidents\/\d+/.test(u) && !/\/status\//.test(u));
  const numMatch = homepage?.match(/\/incidents\/(\d+)/);
  if (!numMatch) return null;
  const incident_number = Number(numMatch[1]);
  if (!Number.isFinite(incident_number)) return null;

  const rawText: string = typeof msg?.text === "string" ? msg.text : "";
  const sevMatch = rawText.match(/^\s*\[([^\]]+)\]/);
  let severity = sevMatch ? sevMatch[1].trim() : null;

  const section = sectionTexts.join("\n");
  const headerEmoji = (headerText.match(/^\s*:([a-z0-9_+-]+):/i)?.[1] ?? "").toLowerCase();
  const headerPlain = headerText.replace(/^\s*(:[a-z0-9_+-]+:\s*)+/i, "").trim();

  // Older / terminal announcements replace the whole card: the header becomes
  // "Incident declined" (or closed/resolved/merged) and the real title moves to
  // the quoted line of the section. Without this the title would read
  // "Incident declined" for every declined incident and the status would be null.
  const lifecycleMatch = headerPlain.match(
    /^Incident\s+(declined|closed|resolved|cancell?ed|merged)\b/i,
  );

  // Title: prefer the header block with its leading emoji shortcode stripped,
  // fall back to the plain text minus the severity prefix.
  let title = headerPlain;
  if (lifecycleMatch) {
    const quoted = section.match(/(?:^|\n)\s*(?:&gt;|>)\s*(.+)/);
    title = (quoted?.[1] ?? "").trim();
  }
  if (!title) title = rawText.replace(/^\s*\[[^\]]+\]\s*/, "").trim();
  if (!title) return null;

  const statusMatch = section.match(/\*Status\*:\s*([^\n*]+)/i);
  let status = statusMatch
    ? statusMatch[1].trim()
    : lifecycleMatch
    ? lifecycleMatch[1][0].toUpperCase() + lifecycleMatch[1].slice(1).toLowerCase()
    : null;

  // Some cards append the severity to the status ("Documenting (Minor)").
  // Split it so the lifecycle bucket still resolves, and use it as a severity
  // fallback when the message text carried no [Severity] prefix.
  if (status) {
    const withSev = status.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (withSev) {
      status = withSev[1].trim();
      if (!severity) severity = withSev[2].trim();
    }
  }

  // Cards posted before ~Oct 2025 carry no "*Status*:" line at all: the only
  // lifecycle signal is the header emoji. We map ONLY the resolved tick, which
  // incident.io uses unambiguously for a finished incident; every other emoji
  // stays unknown rather than being guessed into a live/closed bucket.
  if (!status && headerEmoji === "white_check_mark") status = "Closed";

  const status_category = status
    ? (STATUS_CATEGORY[status.toLowerCase()] ?? "unknown")
    : "unknown";


  const chanMatch = section.match(/\*Channel\*:\s*<#([A-Z0-9]+)(?:\|[^>]*)?>/i);

  const status_page_url = urls.find((u) => /statuspage\.incident\.io\//i.test(u)) ?? null;
  const internal_status_url = urls.find((u) => /\/status\/incidents\/\d+/.test(u)) ?? null;

  const declared_at = new Date(Number(msg.ts) * 1000).toISOString();
  const editedTs = Number(msg?.edited?.ts);
  const last_update_at = Number.isFinite(editedTs) && editedTs > 0
    ? new Date(editedTs * 1000).toISOString()
    : null;

  return {
    incident_number,
    reference: `INC-${incident_number}`,
    title,
    severity,
    severity_rank: severity ? (SEVERITY_RANK[severity.toLowerCase()] ?? null) : null,
    status,
    status_category,
    is_customer_impacting: !!status_page_url,
    status_page_url,
    incident_url: homepage ?? null,
    internal_status_url,
    incident_channel_id: chanMatch ? chanMatch[1] : null,
    declared_at,
    last_update_at,
    slack_message_ts: String(msg.ts),
  };
}

async function slackGet(
  method: string,
  params: URLSearchParams,
  lovableKey: string,
  slackKey: string,
): Promise<{ status: number; body: string; data: any }> {
  let res!: Response;
  let body = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${GATEWAY_URL}/${method}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": slackKey,
      },
    });
    body = await res.text();
    if (res.status !== 429 || attempt === 3) break;
    const retryAfter = Number(res.headers.get("retry-after")) || (attempt + 1) * 5;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
  }
  let data: any = null;
  try { data = JSON.parse(body); } catch { /* caller handles */ }
  return { status: res.status, body, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  // Same key resolution as poll-slack-closed-won: the live connection injects
  // SLACK_API_KEY_1; SLACK_API_KEY is a stale leftover kept as a fallback.
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY_1") ?? Deno.env.get("SLACK_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!LOVABLE_API_KEY || !SLACK_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    const missing = [
      !LOVABLE_API_KEY && "LOVABLE_API_KEY",
      !SLACK_API_KEY && "SLACK_API_KEY",
      !SUPABASE_URL && "SUPABASE_URL",
      !SERVICE_ROLE && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean).join(", ");
    console.error("poll-slack-incidents missing env:", missing);
    if (SUPABASE_URL && SERVICE_ROLE) {
      try {
        await recordIntegrationHealth(
          createClient(SUPABASE_URL, SERVICE_ROLE),
          "slack_incidents_poll",
          "auth_error",
          `Missing required environment variables: ${missing}`,
        );
      } catch { /* best effort */ }
    }
    return new Response(JSON.stringify({ error: "Missing required environment variables", missing }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let lookbackDays = DEFAULT_LOOKBACK_DAYS;
  let full = false;
  let dryRun = false;
  try {
    const b = await req.json();
    if (b && typeof b === "object") {
      if (typeof b.lookbackDays === "number" && b.lookbackDays > 0 && b.lookbackDays <= 3650) {
        lookbackDays = Math.floor(b.lookbackDays);
      }
      if (b.full === true) full = true;
      if (b.dryRun === true) dryRun = true;
    }
  } catch { /* no body */ }

  const oldest = full ? 0 : Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  try {
    // 1. Page through the announcement history.
    const messages: any[] = [];
    let cursor = "";
    let pages = 0;
    do {
      const params = new URLSearchParams({ channel: CHANNEL_ID, limit: "200" });
      if (oldest > 0) params.set("oldest", String(oldest));
      if (cursor) params.set("cursor", cursor);

      const { status, body, data } = await slackGet("conversations.history", params, LOVABLE_API_KEY, SLACK_API_KEY);
      if (!data) {
        if (!dryRun) {
          await recordIntegrationHealth(supabase, "slack_incidents_poll", "error", `Slack gateway returned non-JSON (${status}): ${body.slice(0, 200)}`);
        }
        return new Response(JSON.stringify({ error: "Slack gateway returned non-JSON", status, details: body.slice(0, 500) }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status < 200 || status >= 300 || !data.ok) {
        console.error(`conversations.history failed [${status}]:`, body.slice(0, 500));
        if (!dryRun) {
          await recordIntegrationHealth(
            supabase,
            "slack_incidents_poll",
            status === 401 || status === 403 ? "auth_error" : "error",
            `Slack API error (${status}): ${data?.error ?? body.slice(0, 200)}`,
          );
        }
        return new Response(JSON.stringify({ error: "Slack API error", status, details: data?.error ?? body.slice(0, 500) }), {
          status: status || 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      messages.push(...(data.messages ?? []));
      cursor = data.response_metadata?.next_cursor ?? "";
      pages++;
    } while (cursor && pages < 60);

    // 2. Parse. Newest wins per incident number (the channel can, in theory,
    //    carry a re-posted announcement for the same incident).
    const byNumber = new Map<number, ParsedIncident>();
    let skipped_not_announcement = 0;
    const unknown_status: string[] = [];
    for (const m of messages) {
      const p = parseAnnouncement(m);
      if (!p) { skipped_not_announcement++; continue; }
      if (p.status_category === "unknown" && p.status && unknown_status.length < 10) {
        unknown_status.push(`${p.reference}: "${p.status}"`);
      }
      const prev = byNumber.get(p.incident_number);
      if (!prev || Number(p.slack_message_ts) > Number(prev.slack_message_ts)) {
        byNumber.set(p.incident_number, p);
      }
    }
    const parsed = [...byNumber.values()];

    // 3. Resolve incident channel names for live incidents only (a handful per
    //    run) — resolving all of them would be hundreds of extra Slack calls.
    const nameByChannel = new Map<string, string>();
    const liveChannels = parsed
      .filter((p) => p.status_category === "live" && p.incident_channel_id)
      .slice(0, CHANNEL_NAME_LOOKUP_CAP);
    for (const p of liveChannels) {
      const { data } = await slackGet(
        "conversations.info",
        new URLSearchParams({ channel: p.incident_channel_id! }),
        LOVABLE_API_KEY,
        SLACK_API_KEY,
      );
      if (data?.ok && data.channel?.name) nameByChannel.set(p.incident_channel_id!, data.channel.name);
    }

    // 4. Existing rows, so resolved_at is stamped exactly once — on the first
    //    run that observes a non-live status — and never overwritten later.
    const numbers = parsed.map((p) => p.incident_number);
    const existing = new Map<number, any>();
    for (let i = 0; i < numbers.length; i += 500) {
      const { data, error } = await supabase
        .from("incidents")
        .select("incident_number, status_category, resolved_at, incident_channel_name")
        .in("incident_number", numbers.slice(i, i + 500));
      if (error) throw error;
      for (const r of data ?? []) existing.set(r.incident_number, r);
    }

    const nowIso = new Date().toISOString();
    const rows = parsed.map((p) => {
      const prior = existing.get(p.incident_number);
      const wasLive = !prior || prior.status_category === "live";
      const resolved_at = prior?.resolved_at
        ?? (p.status_category !== "live" && p.status_category !== "unknown" && wasLive && prior
          ? (p.last_update_at ?? nowIso)
          : null);
      return {
        incident_number: p.incident_number,
        reference: p.reference,
        title: p.title,
        severity: p.severity,
        severity_rank: p.severity_rank,
        status: p.status,
        status_category: p.status_category,
        is_customer_impacting: p.is_customer_impacting,
        status_page_url: p.status_page_url,
        incident_url: p.incident_url,
        internal_status_url: p.internal_status_url,
        incident_channel_id: p.incident_channel_id,
        incident_channel_name:
          (p.incident_channel_id ? nameByChannel.get(p.incident_channel_id) : null)
          ?? prior?.incident_channel_name
          ?? null,
        declared_at: p.declared_at,
        last_update_at: p.last_update_at,
        resolved_at,
        last_synced_at: nowIso,
        slack_channel_id: CHANNEL_ID,
        slack_message_ts: p.slack_message_ts,
      };
    });

    const summary = {
      lookbackDays: full ? null : lookbackDays,
      full,
      dryRun,
      scanned: messages.length,
      parsed: rows.length,
      skipped_not_announcement,
      new_incidents: rows.filter((r) => !existing.has(r.incident_number)).length,
      updated: rows.filter((r) => existing.has(r.incident_number)).length,
      live: rows.filter((r) => r.status_category === "live").length,
      customer_impacting: rows.filter((r) => r.is_customer_impacting).length,
      unknown_status,
      upserted: 0,
      errors: [] as string[],
    };

    if (!dryRun && rows.length) {
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const { error } = await supabase
          .from("incidents")
          .upsert(chunk, { onConflict: "incident_number" });
        if (error) {
          console.error("incidents upsert failed:", error.message);
          summary.errors.push(error.message);
        } else {
          summary.upserted += chunk.length;
        }
      }
    }

    console.log("poll-slack-incidents:", summary);

    if (!dryRun) {
      const problems = [
        ...summary.errors.map((e) => `upsert: ${e}`),
        ...(unknown_status.length ? [`unrecognised status ${unknown_status.join(", ")}`] : []),
      ];
      await recordIntegrationHealth(
        supabase,
        "slack_incidents_poll",
        problems.length ? "error" : "ok",
        problems.length ? problems.join("; ").slice(0, 400) : null,
      );
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("poll-slack-incidents fatal:", msg);
    if (!dryRun) {
      try { await recordIntegrationHealth(supabase, "slack_incidents_poll", "error", msg.slice(0, 400)); } catch { /* best effort */ }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
