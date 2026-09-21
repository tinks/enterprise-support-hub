import { requireEditor } from "../_shared/require-editor.ts";
// Read-only Intercom proxy: fetches full conversation payloads by id so the
// frontend SLA engine (src/lib/slaMetrics.ts → computeSla) can analyze them.
// STRICT: HTTP GET to Intercom only. No POST/PUT/DELETE, no DB writes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13";
const MAX_IDS = 10;

function normalizeId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  // URL form → last path segment
  if (s.includes("://") || s.includes("/")) {
    try {
      const parts = s.split(/[/?#]/).filter(Boolean);
      s = parts[parts.length - 1] ?? "";
    } catch { /* fallthrough */ }
  }
  // Strip common prefixes
  s = s.replace(/^conversation[_-]?/i, "");
  // Keep digits only if it looks like a numeric id
  const m = s.match(/(\d{5,})/);
  return m ? m[1] : null;
}

type Result =
  | { id: string; ok: true; conversation: unknown }
  | { id: string; ok: false; status: number; error: string };

async function fetchOne(id: string, token: string): Promise<Result> {
  try {
    const res = await fetch(`${INTERCOM_BASE}/conversations/${id}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { id, ok: false, status: res.status, error: text.slice(0, 500) || res.statusText };
    }
    const conversation = await res.json();
    return { id, ok: true, conversation };
  } catch (e) {
    return { id, ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const token = Deno.env.get("INTERCOM_API_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawIds = Array.isArray(body?.ids) ? body.ids : null;
  if (!rawIds) {
    return new Response(JSON.stringify({ error: "ids must be a string array" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds) {
    const id = normalizeId(raw);
    if (id && !seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }

  const truncated = normalized.length > MAX_IDS;
  const ids = normalized.slice(0, MAX_IDS);

  const results = await Promise.all(ids.map((id) => fetchOne(id, token)));

  return new Response(JSON.stringify({ results, truncated }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
