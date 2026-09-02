// Publish the customer registry domain list to a Notion page for Parahelp.
// ---------------------------------------------------------------------------
// Parahelp has no routing API. Their agent reads a Notion page on a schedule /
// page-change trigger, diffs it against its own memory (base.md) and drafts an
// edit for a human to approve. This function keeps that page an exact mirror of
// public.v3_customer_accounts.
//
// Contract:
//   - Source of truth is the registry. Nothing is invented here; a domain only
//     appears on the page if it is in the registry.
//   - Only `status = 'prospect'` accounts are excluded (unsigned — their mail
//     should not route to the Enterprise inbox). Test accounts and inactive
//     accounts ARE included, by explicit decision.
//   - Idempotent: the sorted domain set is hashed (SHA-256) and compared with
//     settings.notion_registry_hash. Unchanged => no Notion write at all, so
//     Parahelp's page-change trigger only fires on real changes.
//   - Full rewrite, never a partial diff: existing child blocks are deleted and
//     the table is re-appended, so the page can never drift from the registry.
//
// Health key: `notion_registry_publish` (Settings → Integration health).
// Body: { dryRun?: boolean } — renders + reports the verdict without writing.
// See .lovable/project-knowledge.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { recordIntegrationHealth } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/notion/v1";
const CHUNK = 90; // Notion caps children per append request at 100

type Account = {
  account_key: string;
  label: string;
  domains: string[] | null;
  tier: string | null;
  status: string | null;
};

type DomainRow = { domain: string; account: string; tier: string };

function notionHeaders() {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const notionKey = Deno.env.get("NOTION_API_KEY");
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  if (!notionKey) {
    throw new Error(
      "NOTION_API_KEY is not configured — link a Notion connection to this project first",
    );
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": notionKey,
    "Content-Type": "application/json",
  };
}

async function notion(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: init.method,
    headers: notionHeaders(),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion ${init.method} ${path} failed [${res.status}]: ${text.slice(0, 600)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Accepts a raw id, a dashed uuid, or a full Notion URL. Returns a dashed uuid. */
export function normalizePageId(raw: string): string {
  const cleaned = (raw || "").trim();
  const match = cleaned.replace(/-/g, "").match(/[0-9a-fA-F]{32}(?![0-9a-fA-F])/g);
  const hex = match ? match[match.length - 1].toLowerCase() : "";
  if (hex.length !== 32) throw new Error(`Could not read a Notion page id from "${raw}"`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildRows(accounts: Account[]): DomainRow[] {
  const seen = new Map<string, DomainRow>();
  for (const a of accounts) {
    if ((a.status ?? "").toLowerCase() === "prospect") continue; // only exclusion
    for (const d of a.domains ?? []) {
      const domain = (d ?? "").trim().toLowerCase();
      if (!domain) continue;
      if (seen.has(domain)) continue; // domain collisions are blocked at write time
      seen.set(domain, { domain, account: a.label || a.account_key, tier: a.tier ?? "" });
    }
  }
  return [...seen.values()].sort((x, y) => x.domain.localeCompare(y.domain));
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cell = (text: string) => [{ type: "text", text: { content: text || "—" } }];

function tableRowBlock(cells: string[]) {
  return { object: "block", type: "table_row", table_row: { cells: cells.map(cell) } };
}

async function clearPage(pageId: string): Promise<number> {
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const data = await notion(`/blocks/${pageId}/children${qs}`);
    for (const b of data.results ?? []) ids.push(b.id);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  for (const id of ids) await notion(`/blocks/${id}`, { method: "DELETE" });
  return ids.length;
}

async function writePage(pageId: string, rows: DomainRow[], syncedAt: string) {
  const header = tableRowBlock(["Domain", "Account", "Tier"]);
  const bodyRows = rows.map((r) => tableRowBlock([r.domain, r.account, r.tier]));
  const first = bodyRows.slice(0, CHUNK - 1);
  const rest = bodyRows.slice(CHUNK - 1);

  const intro = {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{
        type: "text",
        text: {
          content:
            `Source: Enterprise Support Hub customer registry — last synced ${syncedAt} — ` +
            `${rows.length} domains. Generated automatically; edit the registry, not this page.`,
        },
      }],
    },
  };

  const table = {
    object: "block",
    type: "table",
    table: {
      table_width: 3,
      has_column_header: true,
      has_row_header: false,
      children: [header, ...first],
    },
  };

  const created = await notion(`/blocks/${pageId}/children`, {
    method: "PATCH",
    body: { children: [intro, table] },
  });
  const tableId = (created.results ?? []).find((b: any) => b.type === "table")?.id;
  if (!tableId) throw new Error("Notion did not return the created table block id");

  for (let i = 0; i < rest.length; i += CHUNK) {
    await notion(`/blocks/${tableId}/children`, {
      method: "PATCH",
      body: { children: rest.slice(i, i + CHUNK) },
    });
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

  let dryRun = false;
  let force = false;
  if (req.method === "POST") {
    try {
      const b = await req.json();
      if (typeof b?.dryRun === "boolean") dryRun = b.dryRun;
      if (typeof b?.force === "boolean") force = b.force;
    } catch {
      // no body — normal cron invocation
    }
  }

  try {
    const { data: settings, error: sErr } = await supabase
      .from("settings")
      .select("id, notion_registry_page_id, notion_registry_hash")
      .limit(1)
      .maybeSingle();
    if (sErr) throw new Error(`settings read failed: ${sErr.message}`);
    if (!settings) throw new Error("no settings row");
    const rawPageId = (settings as any).notion_registry_page_id as string;
    if (!rawPageId) {
      throw new Error("No Notion page configured (Admin → Customers → Parahelp routing)");
    }
    const pageId = normalizePageId(rawPageId);

    const { data: accounts, error: aErr } = await supabase
      .from("v3_customer_accounts")
      .select("account_key, label, domains, tier, status");
    if (aErr) throw new Error(`registry read failed: ${aErr.message}`);

    const rows = buildRows((accounts ?? []) as Account[]);
    const hash = await sha256(rows.map((r) => `${r.domain}|${r.account}|${r.tier}`).join("\n"));
    const previous = (settings as any).notion_registry_hash as string | null;
    const changed = force || hash !== previous;
    const syncedAt = new Date().toISOString();

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dryRun: true,
          pageId,
          domains: rows.length,
          changed,
          hash,
          previousHash: previous,
          sample: rows.slice(0, 10),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let deleted = 0;
    if (changed) {
      deleted = await clearPage(pageId);
      await writePage(pageId, rows, syncedAt);
    }

    await supabase
      .from("settings")
      .update({
        notion_registry_hash: hash,
        notion_registry_synced_at: syncedAt,
        notion_registry_domain_count: rows.length,
        ...(changed ? { notion_registry_changed_at: syncedAt } : {}),
      })
      .eq("id", (settings as any).id);

    await recordIntegrationHealth(supabase, "notion_registry_publish", "ok");

    return new Response(
      JSON.stringify({ pageId, domains: rows.length, changed, deletedBlocks: deleted, syncedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[publish-registry-notion] ${msg}`);
    if (!dryRun) {
      const status = /\[401\]|\[403\]/.test(msg) ? "auth_error" : "error";
      await recordIntegrationHealth(supabase, "notion_registry_publish", status, msg);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
