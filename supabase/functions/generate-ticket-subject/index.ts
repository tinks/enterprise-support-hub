// generate-ticket-subject — AI writes a readable Hub label for a v3 ticket.
//
// It NEVER writes to Intercom and never touches an Intercom-owned column. The
// only artefacts are the `subject_ai*` columns on intercom_tickets_v3 plus an
// audit row. Display precedence stays: subject_override (human) -> subject_ai
// -> subject (Intercom) -> "Untitled".
//
// Two modes:
//   auto   — server picks OPEN tickets whose Intercom subject is a placeholder.
//            Refuses closed tickets and tickets that already carry a human
//            override. Callable by cron, service role, or a signed-in editor.
//   manual — one explicit conversation id, ANY ticket (even one with a perfectly
//            good Intercom subject). Signed-in editor only.
//
// Cost discipline, enforced not assumed:
//   - hard input truncation
//   - one write per (ticket, content_hash): an unchanged ticket costs nothing
//   - max 25 tickets per call
//   - a daily call cap + kill switch read from settings; past it it REFUSES

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-esh-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13";
const MODEL = "openai/gpt-6-astra";
const MAX_IDS = 25;
const INPUT_CHARS = 4000;
const AUTO_BATCH_DEFAULT = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The single definition of a "useless" subject. Mirrored in
 * src/lib/subjectDisplay.ts (isPlaceholderSubject) and in the auto-mode SQL
 * filter — the three must agree.
 */
const PLACEHOLDER_RE = /^(intercom\s*#\d+|\(no subject\)|no subject|untitled|-|n\/a)$/i;
function isPlaceholderSubject(s: unknown): boolean {
  const t = String(s ?? "").trim();
  return t.length === 0 || PLACEHOLDER_RE.test(t);
}

function buildInput(conv: any): string {
  const subject = String(conv?.source?.subject ?? conv?.title ?? "").trim();
  const lines: string[] = [];
  if (subject && !isPlaceholderSubject(subject)) lines.push(`Existing subject: ${subject}`);

  const source = stripHtml(conv?.source?.body);
  if (source) lines.push(`First message:\n${source}`);

  const parts: any[] = conv?.conversation_parts?.conversation_parts ?? [];
  const thread = parts
    .filter((p) => p?.part_type !== "note" && stripHtml(p?.body))
    .slice(0, 6)
    .map((p) => `${p?.author?.type === "admin" ? "Support" : "Customer"}: ${stripHtml(p.body)}`);
  if (thread.length) lines.push(`Thread:\n${thread.join("\n\n")}`);

  return lines.join("\n\n").slice(0, INPUT_CHARS);
}

const SYSTEM_PROMPT = `You write support-ticket titles for an enterprise support team.

Given a ticket's messages, return ONE title of 4-10 words summarising the customer's actual issue or request. Rules:
- Noun-led and specific; name the product, feature, or error that appears in the text.
- No pleasantries, no filler ("Question about...", "Help with...", "Need help with..."), no trailing punctuation, no quotes, no ticket ids.
- Never invent detail that is not in the text. If the text is genuinely too thin to summarise, return exactly: Unclear request
Return the title only, with no preamble and no explanation.`;

/**
 * Streamed /v1/responses call. Streaming is mandatory on this endpoint; we
 * consume it server-side because only the final title matters. No timer abort:
 * an aborted generation is billed anyway.
 */
async function askModel(aiKey: string, input: string): Promise<
  { ok: true; title: string } | { ok: false; status: number; error: string }
> {
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
      reasoning: { effort: "low" },
    }),
  });

  if (!res.ok || !res.body) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
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
          const done = evt?.response?.output_text;
          if (typeof done === "string") out = done;
        }
      } catch {
        // partial or non-JSON keepalive frame — ignore
      }
    }
  }

  return { ok: true, title: out };
}

function cleanTitle(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
    ?.replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .slice(0, 120)
    .trim() ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode: "auto" | "manual" = body?.mode === "manual" ? "manual" : "auto";

  // manual mode is a human action → editor session required.
  // auto mode also runs from pg_cron → shared-secret / service-role accepted.
  let callerLabel = "cron";
  if (mode === "manual") {
    const gate = await requireEditor(req, corsHeaders);
    if (!gate.ok) return gate.response;
    callerLabel = gate.userId;
  } else {
    const gate = await requireEditorOrSecret(req, corsHeaders);
    if (!gate.ok) return gate.response;
    callerLabel = gate.caller === "user" ? (gate.userId ?? "user") : gate.caller;
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
  const aiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!intercomToken) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);
  if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  // ─── kill switch + daily budget ───
  const { data: settings } = await supabase
    .from("settings")
    .select("subject_ai_enabled, subject_ai_daily_call_cap")
    .limit(1)
    .maybeSingle();

  if (settings && settings.subject_ai_enabled === false) {
    return json({ error: "Subject AI is disabled in settings" }, 403);
  }
  const cap = settings?.subject_ai_daily_call_cap ?? 200;

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count: usedToday } = await supabase
    .from("intercom_tickets_v3")
    .select("id", { count: "exact", head: true })
    .gte("subject_ai_at", since.toISOString());

  let budget = Math.max(0, cap - (usedToday ?? 0));
  if (budget === 0) {
    return json(
      { error: `Daily subject-AI call cap reached (${cap}). Nothing was sent to the model.` },
      429,
    );
  }

  // ─── pick the tickets ───
  const force = body?.force === true;
  let ids: string[] = [];

  if (mode === "manual") {
    const id = String(body?.conversationId ?? "").trim();
    if (!id) return json({ error: "conversationId is required in manual mode" }, 400);
    ids = [id];
  } else {
    const limit = Math.min(Number(body?.limit) || AUTO_BATCH_DEFAULT, MAX_IDS);
    // OPEN tickets only. Closed tickets are never rewritten — closed-period
    // reporting must stay byte-identical.
    const { data: candidates, error: candErr } = await supabase
      .from("intercom_tickets_v3")
      .select("intercom_conversation_id, subject")
      .eq("state", "open")
      .is("subject_override", null)
      .is("subject_ai", null)
      .order("intercom_created_at", { ascending: false })
      .limit(200);
    if (candErr) return json({ error: candErr.message }, 500);
    ids = (candidates ?? [])
      .filter((r: any) => isPlaceholderSubject(r.subject))
      .slice(0, limit)
      .map((r: any) => String(r.intercom_conversation_id));
    if (ids.length === 0) return json({ ok: true, mode, processed: 0, results: [] });
  }

  if (ids.length > MAX_IDS) return json({ error: `at most ${MAX_IDS} tickets per call` }, 400);

  const results: any[] = [];
  let calls = 0;

  for (const id of ids) {
    if (budget <= 0) {
      results.push({ id, ok: false, skipped: "daily_cap" });
      continue;
    }

    const { data: row } = await supabase
      .from("intercom_tickets_v3")
      .select("id, state, subject, subject_override, subject_ai, subject_ai_source_hash")
      .eq("intercom_conversation_id", id)
      .maybeSingle();

    if (!row) {
      results.push({ id, ok: false, error: "no v3 row for this conversation" });
      continue;
    }

    if (mode === "auto") {
      if (row.state !== "open") {
        results.push({ id, ok: false, skipped: "closed" });
        continue;
      }
      if (row.subject_override) {
        results.push({ id, ok: false, skipped: "manual_override" });
        continue;
      }
      if (!isPlaceholderSubject(row.subject)) {
        results.push({ id, ok: false, skipped: "subject_is_usable" });
        continue;
      }
    }

    // 1. read the conversation (read-only)
    let conv: any;
    try {
      const res = await fetch(`${INTERCOM_BASE}/conversations/${id}?display_as=plaintext`, {
        headers: {
          Authorization: `Bearer ${intercomToken}`,
          Accept: "application/json",
          "Intercom-Version": INTERCOM_VERSION,
        },
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        results.push({ id, ok: false, error: `Intercom ${res.status}: ${text}` });
        continue;
      }
      conv = await res.json();
    } catch (e) {
      results.push({ id, ok: false, error: String(e) });
      continue;
    }

    const input = buildInput(conv);
    if (!input) {
      results.push({ id, ok: false, error: "no readable ticket content" });
      continue;
    }
    const contentHash = await sha256(`v1|${input}`);

    // 2. unchanged input → no model call at all
    if (!force && row.subject_ai && row.subject_ai_source_hash === contentHash) {
      results.push({ id, ok: true, skipped: "unchanged", subject_ai: row.subject_ai });
      continue;
    }

    // 3. ask the model
    const ai = await askModel(aiKey, input);
    calls += 1;
    budget -= 1;

    if (!ai.ok) {
      results.push({ id, ok: false, error: `AI gateway ${ai.status}: ${ai.error}` });
      // 402/403 = terminal, 429 = rate limited: stop the batch rather than burn the rest.
      if (ai.status === 402 || ai.status === 403 || ai.status === 429) break;
      continue;
    }

    const title = cleanTitle(ai.title);
    if (!title || isPlaceholderSubject(title)) {
      results.push({ id, ok: false, error: "model returned no usable title" });
      continue;
    }

    // 4. write the Hub label only
    const { error: updErr } = await supabase
      .from("intercom_tickets_v3")
      .update({
        subject_ai: title,
        subject_ai_at: new Date().toISOString(),
        subject_ai_model: MODEL,
        subject_ai_source_hash: contentHash,
      })
      .eq("intercom_conversation_id", id);

    if (updErr) {
      results.push({ id, ok: false, error: updErr.message });
      continue;
    }

    await supabase.from("conversation_audit_logs").insert({
      conversation_id: row.id,
      conversation_source: "intercom_v3",
      action: "subject_ai_written",
      old_value: row.subject_ai ?? row.subject ?? null,
      new_value: title,
      performed_by: `subject-ai:${callerLabel}`,
    });

    results.push({ id, ok: true, subject_ai: title });
  }

  return json({
    ok: true,
    mode,
    model: MODEL,
    processed: results.length,
    modelCalls: calls,
    results,
  });
});
