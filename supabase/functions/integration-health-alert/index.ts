// Posts Slack alerts to #enterprise-support-hub-alerts when integrations in the
// `integration_health` table become stale, fail, or hit auth errors. Runs every
// 10 min via pg_cron. De-duplicates so we don't repeatedly nag the channel about
// the same issue — we only re-post if the severity changes or 6+ hours have
// elapsed since the last notification.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALERT_CHANNEL = "#enterprise-support-hub-alerts";
const RENOTIFY_AFTER_HOURS = 6;

type Severity = "ok" | "warn" | "auth" | "error";

interface Config {
  key: string;
  label: string;
  maxStaleMin: number;
}

// Mirror of the per-integration freshness windows used in IntegrationHealthCard.tsx
const INTEGRATIONS: Config[] = [
  { key: "intercom_poll",     label: "Intercom poll",            maxStaleMin: 30 },
  { key: "intercom_webhook",  label: "Intercom webhook",         maxStaleMin: 24 * 60 },
  { key: "intercom_csat",     label: "Intercom CSAT refresh",    maxStaleMin: 3 * 60 },
  { key: "intercom_import",   label: "Manual Intercom import",   maxStaleMin: 30 * 24 * 60 },
  { key: "gmail_poll",        label: "Gmail poll",               maxStaleMin: 30 },
  { key: "v3_closed_sync",    label: "Inbox V3 closed sync",     maxStaleMin: 24 * 60 },
  { key: "slack_closed_won_poll", label: "Closed-won account import", maxStaleMin: 36 * 60 },
  { key: "slack_incidents_poll", label: "Incident feed", maxStaleMin: 30 },
  { key: "parahelp_routing_sync", label: "Parahelp routing queue", maxStaleMin: 36 * 60 },
  { key: "notion_registry_publish", label: "Notion domain page", maxStaleMin: 36 * 60 },
  { key: "reconcile-v3-open", label: "Transferred-out reconciliation", maxStaleMin: 180 },
  { key: "intercom_fields_sync", label: "Intercom field options", maxStaleMin: 48 * 60 },
];

interface HealthRow {
  integration: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_status: string | null;
  last_error: string | null;
  consecutive_failures: number | null;
  last_alerted_status: string | null;
  last_alerted_at: string | null;
}

function severityFor(row: HealthRow | undefined, maxStaleMin: number): Severity {
  if (!row) return "warn"; // never recorded yet — surface as stale once
  if (row.last_status === "auth_error") return "auth";
  if (row.last_status === "error" && (row.consecutive_failures || 0) >= 2) return "error";
  const lastOk = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  const ageMin = lastOk ? (Date.now() - lastOk) / 60000 : Infinity;
  if (ageMin > maxStaleMin) return "warn";
  return "ok";
}

function severityEmoji(sev: Severity) {
  return sev === "auth" ? "🔐" : sev === "error" ? "🚨" : sev === "warn" ? "⚠️" : "✅";
}

function severityLabel(sev: Severity) {
  return sev === "auth" ? "Auth error" : sev === "error" ? "Failing" : sev === "warn" ? "Stale (no recent success)" : "Healthy";
}

async function postSlack(token: string, text: string, blocks?: unknown[]) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: ALERT_CHANNEL, text, blocks, username: "Support Hub Health", icon_emoji: ":satellite_antenna:" }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("[integration-health-alert] Slack post failed", data);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Test mode: post a one-off message confirming Slack wiring, then exit.
  // Triggered from the Settings → Integration health "Send test alert" button.
  let test = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      test = body?.test === true;
    } else {
      test = new URL(req.url).searchParams.get("test") === "1";
    }
  } catch { /* ignore */ }

  if (test) {
    const text = `:satellite_antenna: *Test alert* from Integration health — Slack wiring to ${ALERT_CHANNEL} is working. (Sent ${new Date().toISOString()})`;
    const resp = await postSlack(SLACK_BOT_TOKEN, text);
    return new Response(JSON.stringify({ ok: !!resp?.ok, slack: resp }), {
      status: resp?.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: rowsRaw } = await sb.from("integration_health").select("*");
  const rows = (rowsRaw || []) as HealthRow[];
  const byKey = new Map(rows.map((r) => [r.integration, r]));


  const renotifyMs = RENOTIFY_AFTER_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  const alerted: Array<{ key: string; sev: Severity }> = [];
  const recovered: Array<{ key: string; label: string }> = [];

  for (const cfg of INTEGRATIONS) {
    const row = byKey.get(cfg.key);
    const sev = severityFor(row, cfg.maxStaleMin);

    if (sev === "ok") {
      // Recovery: if we previously alerted that this integration was bad, post a one-time recovery message.
      if (row && row.last_alerted_status && row.last_alerted_status !== "ok") {
        recovered.push({ key: cfg.key, label: cfg.label });
        await sb.from("integration_health").update({
          last_alerted_status: "ok",
          last_alerted_at: new Date().toISOString(),
        }).eq("integration", cfg.key);
      }
      continue;
    }

    // Skip if we already alerted at this severity recently
    const lastAlertedAtMs = row?.last_alerted_at ? new Date(row.last_alerted_at).getTime() : 0;
    const sameSeverity = row?.last_alerted_status === sev;
    if (sameSeverity && lastAlertedAtMs && now - lastAlertedAtMs < renotifyMs) {
      continue;
    }

    alerted.push({ key: cfg.key, sev });

    const lines: string[] = [];
    lines.push(`${severityEmoji(sev)} *${cfg.label}* — ${severityLabel(sev)}`);
    if (row?.last_success_at) {
      const ageMin = Math.round((now - new Date(row.last_success_at).getTime()) / 60000);
      lines.push(`Last successful sync: ${ageMin} min ago`);
    } else {
      lines.push("No successful sync recorded yet");
    }
    if (row?.last_error) lines.push(`Last error: \`${row.last_error.slice(0, 250)}\``);
    if (sev === "auth") {
      lines.push("→ Re-paste the API token in Settings → Integration health.");
    }
    const text = lines.join("\n");

    await postSlack(SLACK_BOT_TOKEN, text);

    await sb.from("integration_health").upsert({
      integration: cfg.key,
      last_alerted_status: sev,
      last_alerted_at: new Date().toISOString(),
    }, { onConflict: "integration" });
  }

  if (recovered.length > 0) {
    const text = `✅ Recovered: ${recovered.map((r) => `*${r.label}*`).join(", ")}`;
    await postSlack(SLACK_BOT_TOKEN, text);
  }

  return new Response(JSON.stringify({
    ok: true,
    alerted: alerted.length,
    recovered: recovered.length,
    details: { alerted, recovered },
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
