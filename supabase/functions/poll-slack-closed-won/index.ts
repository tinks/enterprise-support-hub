// Daily poll of Slack channel C09CL5E028N ("closed-won" feed) via the linked
// bot Slack connection. For each message in the last 7 days, extract
//   Company Name: <name>
//   Company Domain: <domain>
// and insert missing rows into public.v3_customer_accounts. Deduplication is
// by extracted company domain (batch + existing rows), so a wide lookback is
// idempotent. Every non-dry run records into `integration_health` (key
// `slack_closed_won_poll`) so Slack API errors, insert failures, and malformed
// domains surface in Settings → Integration health and the alert channel
// instead of failing silently. See .lovable/project-knowledge.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordIntegrationHealth } from "../_shared/integration-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CHANNEL_ID = "C09CL5E028N";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const LOOKBACK_DAYS = 7;

function collectText(msg: any): string {
  const parts: string[] = [];
  if (typeof msg?.text === "string") parts.push(msg.text);
  for (const a of msg?.attachments ?? []) {
    if (typeof a?.text === "string") parts.push(a.text);
    if (typeof a?.fallback === "string") parts.push(a.fallback);
    for (const f of a?.fields ?? []) {
      if (typeof f?.title === "string") parts.push(f.title);
      if (typeof f?.value === "string") parts.push(f.value);
    }
  }
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") parts.push(node.text);
    if (node.text && typeof node.text === "object" && typeof node.text.text === "string") {
      parts.push(node.text.text);
    }
    for (const key of Object.keys(node)) {
      const v = (node as any)[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  for (const b of msg?.blocks ?? []) walk(b);
  return parts.join("\n");
}

function stripMarkdown(s: string): string {
  return s
    .replace(/^\s*[*_`>]+|[*_`>]+\s*$/g, "")
    .replace(/^<|>$/g, "")
    .trim();
}

// A plausible registrable domain: labels separated by dots, alpha TLD >= 2 chars.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

// NOTE: the domain capture is deliberately restricted to horizontal whitespace
// ([ \t]*) — using \s* lets the match cross a newline when HubSpot posts an
// EMPTY "Company Domain:" line, silently capturing the next line's leading
// emoji shortcode (e.g. AARP captured ":page_facing_up:" from the following
// "Deal Name:" line). A blank domain is reported as `missing`, not malformed.
function extractCompany(text: string): { name: string; domain: string; malformed: boolean; missing: boolean } | null {
  const nameMatch = text.match(/Company Name:[ \t]*(.+)/i);
  const domainMatch = text.match(/Company Domain:[ \t]*(\S*)/i);
  if (!nameMatch || !domainMatch) return null;
  const name = stripMarkdown(nameMatch[1].split("\n")[0]);
  let domain = domainMatch[1].trim().toLowerCase();
  domain = domain.replace(/^<|>$/g, "");
  domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  domain = domain.replace(/[|].*$/, ""); // slack link syntax <https://x.com|x.com>
  if (!name) return null;
  if (!domain) return { name, domain: "", malformed: false, missing: true };
  return { name, domain, malformed: !DOMAIN_RE.test(domain), missing: false };
}

function toAccountKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY_1");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!LOVABLE_API_KEY || !SLACK_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ error: "Missing required environment variables" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Optional diagnostic overrides: { lookbackDays?: number, dryRun?: boolean }
  let lookbackDays = LOOKBACK_DAYS;
  let dryRun = false;
  try {
    const b = await req.json();
    if (b && typeof b === "object") {
      if (typeof b.lookbackDays === "number" && b.lookbackDays > 0 && b.lookbackDays <= 365) {
        lookbackDays = Math.floor(b.lookbackDays);
      }
      if (b.dryRun === true) dryRun = true;
    }
  } catch { /* no body */ }

  const oldest = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  try {
    // 1. Page through conversations.history
    const messages: any[] = [];
    let cursor = "";
    do {
      const params = new URLSearchParams({
        channel: CHANNEL_ID,
        oldest: String(oldest),
        limit: "200",
      });
      if (cursor) params.set("cursor", cursor);

      const res = await fetch(`${GATEWAY_URL}/conversations.history?${params}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": SLACK_API_KEY,
        },
      });
      const body = await res.text();
      let data: any;
      try { data = JSON.parse(body); } catch {
        if (!dryRun) {
          await recordIntegrationHealth(supabase, "slack_closed_won_poll", "error", `Slack gateway returned non-JSON (${res.status}): ${body.slice(0, 200)}`);
        }
        return new Response(
          JSON.stringify({ error: "Slack gateway returned non-JSON", status: res.status, details: body.slice(0, 500) }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!res.ok || !data.ok) {
        console.error(`conversations.history failed [${res.status}]:`, body);
        if (!dryRun) {
          await recordIntegrationHealth(
            supabase,
            "slack_closed_won_poll",
            res.status === 401 || res.status === 403 ? "auth_error" : "error",
            `Slack API error (${res.status}): ${data?.error ?? body.slice(0, 200)}`,
          );
        }
        return new Response(
          JSON.stringify({ error: "Slack API error", status: res.status, details: data?.error ?? body.slice(0, 500) }),
          { status: res.status || 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      messages.push(...(data.messages ?? []));
      cursor = data.response_metadata?.next_cursor ?? "";
    } while (cursor);

    // 2. Extract candidates. Malformed domains and blank ("missing") domains are
    //    never inserted — both are surfaced loudly and mark the run unhealthy so
    //    the account can be added by hand instead of failing silently.
    const candidatesByDomain = new Map<string, { account_key: string; label: string; domain: string }>();
    let extracted = 0;
    const unparsed: string[] = [];
    const malformed: string[] = [];
    const missing_domain: string[] = [];
    for (const m of messages) {
      const text = collectText(m);
      const c = extractCompany(text);
      if (!c) {
        if (unparsed.length < 10) unparsed.push(text.replace(/\s+/g, " ").slice(0, 160));
        continue;
      }
      if (c.missing) {
        missing_domain.push(c.name);
        console.error("poll-slack-closed-won blank Company Domain:", c.name);
        continue;
      }
      if (c.malformed) {
        malformed.push(`${c.name}: "${c.domain}"`);
        console.error("poll-slack-closed-won malformed domain:", c);
        continue;
      }
      const account_key = toAccountKey(c.name);
      if (!account_key) continue;
      extracted++;
      if (!candidatesByDomain.has(c.domain)) {
        candidatesByDomain.set(c.domain, { account_key, label: c.name, domain: c.domain });
      }
    }

    const problemNotes = [
      ...malformed.map((m) => `malformed domain ${m}`),
      ...missing_domain.map((n) => `blank Company Domain for "${n}" — add the account manually`),
    ];

    const candidates = [...candidatesByDomain.values()];
    if (candidates.length === 0) {
      const summary = { lookbackDays, dryRun, scanned: messages.length, extracted, inserted: 0, skipped_domain_exists: 0, skipped_account_key_exists: 0, unparsed, malformed, missing_domain, errors: [] as string[] };
      console.log("poll-slack-closed-won:", summary);
      if (!dryRun) {
        await recordIntegrationHealth(
          supabase,
          "slack_closed_won_poll",
          problemNotes.length ? "error" : "ok",
          problemNotes.length ? problemNotes.join("; ").slice(0, 400) : null,
        );
      }
      return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Fetch existing rows: any account claiming one of these domains, OR any with a matching account_key.
    const domainList = candidates.map((c) => c.domain);
    const keyList = candidates.map((c) => c.account_key);

    const { data: existingByDomain, error: err1 } = await supabase
      .from("v3_customer_accounts")
      .select("account_key, domains")
      .overlaps("domains", domainList);
    if (err1) throw err1;

    const { data: existingByKey, error: err2 } = await supabase
      .from("v3_customer_accounts")
      .select("account_key")
      .in("account_key", keyList);
    if (err2) throw err2;

    const claimedDomains = new Set<string>();
    for (const row of existingByDomain ?? []) {
      for (const d of (row.domains as string[] | null) ?? []) claimedDomains.add(d.toLowerCase());
    }
    const claimedKeys = new Set<string>((existingByKey ?? []).map((r: any) => r.account_key));

    // 4. Insert missing
    const nowIso = new Date().toISOString().slice(0, 10);
    let inserted = 0;
    let skipped_domain_exists = 0;
    let skipped_account_key_exists = 0;
    const errors: string[] = [];
    const would_insert: string[] = [];

    for (const c of candidates) {
      if (claimedDomains.has(c.domain)) { skipped_domain_exists++; continue; }
      if (claimedKeys.has(c.account_key)) { skipped_account_key_exists++; continue; }
      if (dryRun) {
        would_insert.push(`${c.account_key} (${c.domain})`);
        claimedDomains.add(c.domain);
        claimedKeys.add(c.account_key);
        continue;
      }
      const { error } = await supabase.from("v3_customer_accounts").insert({
        account_key: c.account_key,
        label: c.label,
        domains: [c.domain],
        notes: `Auto-created from Slack #closed-won on ${nowIso}`,
      });
      if (error) {
        errors.push(`${c.account_key} (${c.domain}): ${error.message}`);
        console.error("insert failed:", c, error);
      } else {
        inserted++;
        claimedDomains.add(c.domain);
        claimedKeys.add(c.account_key);
      }
    }

    const summary = { lookbackDays, dryRun, scanned: messages.length, extracted, inserted, would_insert, skipped_domain_exists, skipped_account_key_exists, unparsed, malformed, errors };
    console.log("poll-slack-closed-won:", summary);
    if (!dryRun) {
      const problems = [...errors, ...malformed.map((m) => `malformed domain ${m}`)];
      await recordIntegrationHealth(
        supabase,
        "slack_closed_won_poll",
        problems.length ? "error" : "ok",
        problems.length ? problems.join("; ").slice(0, 400) : null,
      );
    }
    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("poll-slack-closed-won fatal:", err);
    if (!dryRun) {
      await recordIntegrationHealth(supabase, "slack_closed_won_poll", "error", `Fatal: ${String(err).slice(0, 400)}`);
    }
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
