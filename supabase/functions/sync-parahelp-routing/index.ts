// Parahelp routing sync — step 2 of the closed-won automation.
// ---------------------------------------------------------------------------
// Reads `pending` rows from public.parahelp_routing_sync (enqueued by the
// parahelp_enqueue_new_domains trigger on v3_customer_accounts) and tries to
// register each domain with Parahelp so mail from that domain to
// enterprise-support@lovable.dev routes into the Enterprise inbox.
//
// DELIBERATELY DECOUPLED: this function never writes v3_customer_accounts and
// never runs inside poll-slack-closed-won. A Parahelp outage can only leave
// rows pending — it can never block or corrupt a registry update.
//
// API leg: DORMANT until Parahelp confirms an endpoint. It activates only when
// BOTH PARAHELP_API_KEY and PARAHELP_ROUTING_URL secrets exist. Until then the
// function still runs daily and posts the pending-domain digest to Slack, which
// is the manual working path (Admin → Customers → Parahelp routing).
//
// Health key: `parahelp_routing_sync` (Settings → Integration health).
// See .lovable/project-knowledge.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { recordIntegrationHealth } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLACK_API_URL = "https://slack.com/api";
const DEFAULT_CHANNEL = "C0BPDU4JH71"; // #enterprise-support-tickets
const MAX_ATTEMPTS = 5;
const BATCH = 50;

type Row = {
  id: string;
  domain: string;
  account_key: string | null;
  attempts: number;
  created_at: string;
};

/**
 * Push one domain to Parahelp. Returns null on success, an error string on
 * failure. Throws nothing. The request shape is a placeholder until Parahelp
 * confirms their endpoint — enabling it is a change to this function only.
 */
async function pushDomain(
  url: string,
  apiKey: string,
  row: Row,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domain: row.domain,
        account_key: row.account_key,
        inbox: "enterprise",
      }),
    });
    const body = await res.text();
    if (!res.ok) return `HTTP ${res.status}: ${body.slice(0, 500)}`;
    return null;
  } catch (e) {
    return `request failed: ${(e as Error).message}`;
  }
}

async function postSlackDigest(
  pending: Row[],
  failed: number,
  apiEnabled: boolean,
): Promise<void> {
  const token = Deno.env.get("SLACK_BOT_TOKEN");
  if (!token) return;
  if (pending.length === 0 && failed === 0) return;
  const channel = Deno.env.get("NEW_TICKET_ALERT_CHANNEL") || DEFAULT_CHANNEL;

  const list = pending
    .slice(0, 15)
    .map((r) => `• \`${r.domain}\`${r.account_key ? ` — ${r.account_key}` : ""}`)
    .join("\n");
  const more = pending.length > 15 ? `\n_…and ${pending.length - 15} more._` : "";

  const lines = [
    `:mailbox_with_mail: *Parahelp routing — ${pending.length} domain(s) awaiting setup*`,
    apiEnabled
      ? "_Automatic push is enabled; these did not complete._"
      : "_No Parahelp API configured — these need adding by hand._",
    list,
  ];
  if (more) lines.push(more);
  if (failed > 0) lines.push(`:warning: ${failed} row(s) in failed state.`);
  lines.push("Work the queue in Admin → Customers → Parahelp routing.");

  try {
    const res = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        text: lines.join("\n"),
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error(`[parahelp-routing] slack error: ${data.error}`);
  } catch (e) {
    console.error(`[parahelp-routing] slack threw: ${(e as Error).message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional diagnostic overrides: { dryRun?: boolean, silent?: boolean }
  let dryRun = false;
  let silent = false;
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (typeof b?.dryRun === "boolean") dryRun = b.dryRun;
      if (typeof b?.silent === "boolean") silent = b.silent;
    } catch {
      // no body — normal cron invocation
    }
  }

  const apiKey = Deno.env.get("PARAHELP_API_KEY") ?? "";
  const routingUrl = Deno.env.get("PARAHELP_ROUTING_URL") ?? "";
  const apiEnabled = Boolean(apiKey && routingUrl);

  try {
    const { data: rows, error } = await supabase
      .from("parahelp_routing_sync")
      .select("id, domain, account_key, attempts, created_at")
      .in("state", ["pending", "failed"])
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`queue read failed: ${error.message}`);

    const queue = (rows ?? []) as Row[];
    let pushed = 0;
    let failed = 0;
    const stillPending: Row[] = [];

    if (apiEnabled && !dryRun) {
      for (const row of queue) {
        const err = await pushDomain(routingUrl, apiKey, row);
        const nowIso = new Date().toISOString();
        if (err === null) {
          pushed++;
          await supabase
            .from("parahelp_routing_sync")
            .update({
              state: "pushed",
              pushed_at: nowIso,
              last_attempt_at: nowIso,
              attempts: row.attempts + 1,
              last_error: null,
            })
            .eq("id", row.id);
        } else {
          failed++;
          stillPending.push(row);
          await supabase
            .from("parahelp_routing_sync")
            .update({
              state: "failed",
              last_attempt_at: nowIso,
              attempts: row.attempts + 1,
              last_error: err,
            })
            .eq("id", row.id);
        }
      }
    } else {
      stillPending.push(...queue);
    }

    if (!silent && !dryRun) await postSlackDigest(stillPending, failed, apiEnabled);

    // A dormant API leg is not a failure — pending rows are the expected steady
    // state until Parahelp credentials exist. Only real push failures degrade
    // health, and only when the API leg is actually on.
    if (!dryRun) {
      if (apiEnabled && failed > 0) {
        await recordIntegrationHealth(
          supabase,
          "parahelp_routing_sync",
          "error",
          `${failed} domain push(es) failed`,
        );
      } else {
        await recordIntegrationHealth(supabase, "parahelp_routing_sync", "ok");
      }
    }

    return new Response(
      JSON.stringify({
        apiEnabled,
        dryRun,
        scanned: queue.length,
        pushed,
        failed,
        pending: stillPending.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[parahelp-routing] ${msg}`);
    if (!dryRun) {
      await recordIntegrationHealth(supabase, "parahelp_routing_sync", "error", msg);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
