// analyze-topic-trends — READ-ONLY topic synthesis over the v3 ticket population.
//
// Given a topic ("GitHub", "SSO", "database region") and a date window, it:
//   1. retrieves matching v3 tickets from the deep-search index (full text over
//      subject + message bodies + attributes), bounded by created_at,
//   2. asks the model to cluster them into 4-8 recurring themes with a
//      category (bug / support gap / feature request) and a recommendation,
//   3. returns themes + the ticket rows so the UI can show the hard evidence.
//
// It writes NOTHING: no Intercom call, no column update, no index write. The
// only side effect is AI-gateway spend, which is why it is editor-gated and
// capped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "openai/gpt-6-astra";
const MAX_TICKETS = 120; // hard cap on what reaches the model
const PER_TICKET_CHARS = 420;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type IndexRow = {
  ref_id: string;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
};

const SYSTEM_PROMPT = `You analyse enterprise support tickets for a support operations team.

You are given a topic and a numbered list of tickets (id, subject, excerpt, product area).
Group the tickets into 4-8 RECURRING THEMES that describe the underlying problem, not the wording.

Rules:
- Every theme must be grounded in the supplied tickets. Never invent a ticket id.
- A ticket belongs to at most one theme. Tickets that fit no theme are simply left out.
- category is exactly one of: bug, support_gap, feature_request.
- recommendation is one concrete sentence aimed at either the support team (training/docs) or the product/dev team.
- summary is 2-3 sentences describing the overall trend across the whole window.
- Order themes by number of tickets, largest first.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["bug", "support_gap", "feature_request"] },
          recommendation: { type: "string" },
          ticket_ids: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "category", "recommendation", "ticket_ids"],
      },
    },
  },
  required: ["summary", "themes"],
};

/** Streamed /v1/responses call — streaming is mandatory on this endpoint. */
async function askModel(
  aiKey: string,
  input: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiKey}`,
      "Lovable-API-Key": aiKey,
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: SYSTEM_PROMPT,
      input,
      stream: true,
      reasoning: { effort: "medium" },
      text: {
        format: {
          type: "json_schema",
          name: "topic_themes",
          strict: true,
          schema: SCHEMA,
        },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const text = (await res.text().catch(() => "")).slice(0, 400);
    return { ok: false, status: res.status, error: text || "no response body" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt?.type === "response.output_text.delta" && typeof evt.delta === "string") {
          out += evt.delta;
        } else if (evt?.type === "response.completed" && !out) {
          const t = evt?.response?.output_text;
          if (typeof t === "string") out = t;
        }
      } catch {
        // keepalive / partial frame
      }
    }
  }

  return { ok: true, text: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const topic = String(body?.topic ?? "").trim();
  if (!topic) return json({ error: "topic is required" }, 400);
  const days = Math.min(Math.max(Number(body?.days) || 90, 7), 365);
  const analyze = body?.analyze !== false; // false = retrieval only, no AI spend

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // ── 1. retrieve from the deep-search index (subjects + bodies + attributes) ──
  const { data: rows, error: searchErr } = await supabase
    .from("esh_search_index")
    .select("ref_id, title, body, meta")
    .eq("kind", "v3_ticket")
    .textSearch("tsv", topic, { type: "websearch" })
    .limit(600);

  if (searchErr) return json({ error: `search failed: ${searchErr.message}` }, 500);

  const tickets = ((rows ?? []) as IndexRow[])
    .map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      const createdAt = typeof m.created_at === "string" ? m.created_at : null;
      return {
        intercom_id: String(m.intercom_id ?? r.ref_id),
        subject: r.title ?? "Untitled",
        created_at: createdAt,
        state: (m.state as string) ?? null,
        customer_key: (m.customer_key as string) ?? null,
        owner: (m.owner as string) ?? null,
        classification: (m.classification as string) ?? null,
        excerpt: (r.body ?? "").replace(/\s+/g, " ").trim().slice(0, PER_TICKET_CHARS),
      };
    })
    .filter((t) => t.created_at && Date.parse(t.created_at) >= sinceMs)
    .sort((a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!));

  const truncated = tickets.length > MAX_TICKETS;
  const sample = tickets.slice(0, MAX_TICKETS);

  if (!analyze || sample.length === 0) {
    return json({
      ok: true,
      topic,
      days,
      matched: tickets.length,
      analyzed: 0,
      truncated,
      tickets,
      themes: [],
      summary: sample.length === 0 ? "No tickets matched this topic in the window." : null,
    });
  }

  // ── 2. cluster ──
  const aiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  const input = [
    `Topic: ${topic}`,
    `Window: last ${days} days (${sample.length} tickets${truncated ? `, sampled from ${tickets.length}` : ""})`,
    "",
    ...sample.map(
      (t, i) =>
        `${i + 1}. id=${t.intercom_id} | ${t.created_at?.slice(0, 10)} | area=${
          t.classification ?? "unset"
        } | ${t.subject}\n   ${t.excerpt}`,
    ),
  ].join("\n");

  const ai = await askModel(aiKey, input);
  if (!ai.ok) {
    return json(
      {
        error:
          ai.status === 402
            ? "AI credits are exhausted for this workspace — the analysis was not run."
            : ai.status === 429
            ? "AI gateway is rate limited — try again shortly."
            : `AI gateway ${ai.status}: ${ai.error}`,
      },
      ai.status,
    );
  }

  let parsed: { summary?: string; themes?: unknown[] } = {};
  try {
    parsed = JSON.parse(ai.text);
  } catch {
    return json({ error: "The model returned output that could not be read as themes." }, 502);
  }

  const validIds = new Set(sample.map((t) => t.intercom_id));
  const themes = (Array.isArray(parsed.themes) ? parsed.themes : [])
    .map((t) => {
      const th = t as Record<string, unknown>;
      const ids = (Array.isArray(th.ticket_ids) ? th.ticket_ids : [])
        .map((x) => String(x))
        .filter((x) => validIds.has(x)); // never surface a hallucinated id
      return {
        name: String(th.name ?? "Untitled theme"),
        description: String(th.description ?? ""),
        category: ["bug", "support_gap", "feature_request"].includes(String(th.category))
          ? String(th.category)
          : "bug",
        recommendation: String(th.recommendation ?? ""),
        ticket_ids: ids,
      };
    })
    .filter((t) => t.ticket_ids.length > 0)
    .sort((a, b) => b.ticket_ids.length - a.ticket_ids.length);

  return json({
    ok: true,
    topic,
    days,
    matched: tickets.length,
    analyzed: sample.length,
    truncated,
    model: MODEL,
    summary: String(parsed.summary ?? ""),
    themes,
    tickets,
  });
});
