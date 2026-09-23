// extract-human-info — AI drafts the "Human Info Block" for a dev escalation.
//
// READ-ONLY. Writes nothing to Intercom, Slack, Linear, or the database. It
// returns a draft that a human reviews and edits before anything is submitted.
//
// Locked contract (Sept 23, 2026):
//   - Source is the LIVE Intercom conversation (fresh GET), never Pax output and
//     never the possibly-stale raw_payload mirror.
//   - Automated bookkeeping notes are filtered; substantive human notes kept.
//   - Null over guess for every field.
//   - repro_steps.status is ALWAYS "customer_reported_unverified". The model
//     cannot emit anything else (single-value enum) and the server re-forces it.
//     "support_verified" and "attempted_could_not_reproduce_infra_limitation"
//     are human-only states set in the review UI — never produced here.
//   - Multi-ID: every identifier carries { primary, candidates[] }.
//   - Impact is two-dimensional: technical (inferred) vs customer_stated_urgency
//     (direct quote), so reviewers can see if emotion bled into severity.
//   - No PII pre-scrubber in this phase; human review before submit is the
//     mitigation (explicit decision).

import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13";
const MODEL = "openai/gpt-6-astra";
const PART_CHARS = 2500;
const INPUT_CHARS = 60000;

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
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<img [^>]*src="([^"]+)"[^>]*>/gi, " [image: $1] ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** Mirrors isAutomatedNote() in src/lib/ticketComments.ts. */
function isAutomatedNote(author: string, text: string): boolean {
  if (/lovable support/i.test(author)) return true;
  return /slack\.com\/archives\//i.test(text);
}

function attachmentLines(p: any): string {
  const atts: any[] = p?.attachments ?? [];
  return atts.map((a) => `[attachment: ${a?.name ?? "file"} ${a?.url ?? ""}]`).join("\n");
}

type Built = { input: string; customerCount: number; noteCount: number; slackUrls: string[] };

function buildInput(conv: any, id: string): Built {
  const slackUrls = new Set<string>();
  const customer: string[] = [];
  const notes: string[] = [];
  const grab = (t: string) => {
    for (const m of t.matchAll(/https:\/\/[a-z0-9-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+[^\s)"]*/gi)) {
      slackUrls.add(m[0]);
    }
  };

  const src = conv?.source ?? {};
  const first = [stripHtml(src.body), attachmentLines(src)].filter(Boolean).join("\n");
  if (first) {
    grab(first);
    customer.push(`[${fmt(conv?.created_at)}] Customer (opening message):\n${first.slice(0, PART_CHARS)}`);
  }

  const parts: any[] = conv?.conversation_parts?.conversation_parts ?? [];
  for (const p of parts) {
    const text = [stripHtml(p?.body), attachmentLines(p)].filter(Boolean).join("\n");
    if (!text) continue;
    grab(text);
    const authorType = p?.author?.type;
    const authorName = String(p?.author?.name ?? "");
    const when = fmt(p?.created_at);
    if (p?.part_type === "note") {
      if (authorType !== "admin") continue;
      if (isAutomatedNote(authorName, text)) continue;
      notes.push(`[${when}] ${authorName || "Teammate"} (internal note):\n${text.slice(0, PART_CHARS)}`);
    } else if (authorType === "user" || authorType === "lead" || authorType === "contact") {
      customer.push(`[${when}] Customer:\n${text.slice(0, PART_CHARS)}`);
    } else if (authorType === "admin") {
      if (isAutomatedNote(authorName, text)) continue;
      customer.push(`[${when}] Support (${authorName || "teammate"}) reply:\n${text.slice(0, PART_CHARS)}`);
    }
    // bots / system parts dropped
  }

  const custAttrs = conv?.custom_attributes ?? {};
  const input = `Extract the Human Info Block from the following support ticket data.

### Ticket Metadata:
- Intercom Conversation ID: ${id}
- Subject: ${stripHtml(src.subject ?? conv?.title ?? "") || "(none)"}
- Channel: ${src.delivered_as ?? src.type ?? "unknown"}
- Custom attributes: ${JSON.stringify(custAttrs).slice(0, 1500)}

### Customer Conversation:
${customer.join("\n\n") || "(none)"}

### Internal Teammate Notes (exclude bots):
${notes.join("\n\n") || "(none)"}

Respond strictly with the JSON object.`.slice(0, INPUT_CHARS);

  return {
    input,
    customerCount: customer.filter((c) => c.includes("Customer")).length,
    noteCount: notes.length,
    slackUrls: [...slackUrls],
  };
}

function fmt(ts: unknown): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : "unknown time";
}

const SYSTEM_PROMPT = `You are an expert technical support escalation assistant for Lovable's engineering team.
Your task is to extract a structured "Human Info Block" from a raw support conversation to seed a developer escalation.

Engineers despise "AI slop", vague summaries, and ungrounded reproduction steps. Every field you produce must be concise, factual, and strictly grounded in the conversation provided.

### Ingestion rules
1. INPUT COMPOSITION: You will receive ticket metadata, customer messages (and support replies) in chronological order, and internal teammate notes authored by human support engineers.
2. FILTER AUTOMATED NOISE: Ignore any automated bot notes, archive sync lines, and system notifications. Focus on the customer's actual words and human teammate diagnostic notes.
3. PREVENT HALLUCINATION: If a field cannot be derived with certainty from the text, return null or an empty array. NEVER guess or invent IDs or reproduction steps.

### Field extraction contracts

1. SUMMARY: Format "[Area/Component]: [Concise failure behavior]". Under 120 characters, one sentence. Provenance "inferred".

2. CUSTOMER STATEMENT: Near-verbatim quote of the customer describing the primary break or symptom. 1-3 sentences, max 300 characters; use "[...]" when trimming. Provenance "direct_quote".

3. IDENTIFIERS (user_id, project_id, workspace_id):
   - Extract exact matches only (UUIDs, slugs, explicit ID labels, in-app form lines such as "User ID:", "Workspace:", "Project:").
   - MULTI-ID RULE: collect every distinct matching ID in "candidates" with a brief context note. Set "primary" to the ID actively experiencing the failure in the most recent repro context.
   - If none found: primary null, candidates [], provenance null. Never guess or truncate IDs.
   - slack_thread_url: an exact Slack archive URL from the text, else null.

4. IMPACT (two separate dimensions):
   - technical_severity: "blocking" (core workflow stopped, no workaround) | "degraded" (broken but primary work proceeds) | "workaround_available" (known workaround confirmed in notes) | "minor" (cosmetic / non-disruptive).
   - technical_scope: "single_user" | "multiple_users" | "workspace_wide" | "unspecified".
   - technical_description: exactly 1 sentence on technical disruption. No emotional language. Customer urgency must NOT raise technical severity.
   - customer_stated_urgency: near-verbatim quote of the customer's stated business urgency, deadline, or emotional framing; null if none beyond the problem statement. Provenance "direct_quote" when present, else null.

5. REPRODUCTION STEPS:
   - Ordered steps if the customer or an agent outlined them, else [].
   - status: you MUST ALWAYS output "customer_reported_unverified". Verification is a human-exclusive action in the review UI; you are forbidden from asserting it, even if a note claims reproduction.

6. EXPECTED VS. OBSERVED: one sentence each.

7. EVIDENCE LINKS: raw URLs to Loom videos, screenshots/attachments, Datadog/Sentry traces, console logs, GitHub, or relevant Slack threads. No generic homepage URLs.

8. EXTRACTION METADATA: count human notes and customer messages you actually used; contains_unverified_claims true when any claim (especially repro) rests only on customer report.

Return only the JSON object conforming to the schema.`;

// ---- Strict JSON schema (Responses API strict mode compatible) ----
const nullableStr = { type: ["string", "null"] };
const detProv = { type: ["string", "null"], enum: ["deterministic", null] };
const multiId = {
  type: "object",
  additionalProperties: false,
  required: ["primary", "candidates", "provenance"],
  properties: {
    primary: nullableStr,
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "context"],
        properties: { id: { type: "string" }, context: { type: "string" } },
      },
    },
    provenance: detProv,
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary", "customer_statement", "identifiers", "impact",
    "repro_steps", "expected_vs_observed", "evidence_links", "extraction_metadata",
  ],
  properties: {
    summary: {
      type: "object", additionalProperties: false, required: ["value", "provenance"],
      properties: { value: { type: "string" }, provenance: { type: "string", enum: ["inferred"] } },
    },
    customer_statement: {
      type: "object", additionalProperties: false, required: ["value", "provenance"],
      properties: { value: { type: "string" }, provenance: { type: "string", enum: ["direct_quote"] } },
    },
    identifiers: {
      type: "object", additionalProperties: false,
      required: ["user_id", "project_id", "workspace_id", "slack_thread_url"],
      properties: {
        user_id: multiId,
        project_id: multiId,
        workspace_id: multiId,
        slack_thread_url: {
          type: "object", additionalProperties: false, required: ["value", "provenance"],
          properties: { value: nullableStr, provenance: detProv },
        },
      },
    },
    impact: {
      type: "object", additionalProperties: false,
      required: ["technical_severity", "technical_scope", "technical_description", "technical_provenance", "customer_stated_urgency"],
      properties: {
        technical_severity: { type: "string", enum: ["blocking", "degraded", "workaround_available", "minor"] },
        technical_scope: { type: "string", enum: ["single_user", "multiple_users", "workspace_wide", "unspecified"] },
        technical_description: { type: "string" },
        technical_provenance: { type: "string", enum: ["inferred"] },
        customer_stated_urgency: {
          type: "object", additionalProperties: false, required: ["value", "provenance"],
          properties: { value: nullableStr, provenance: { type: ["string", "null"], enum: ["direct_quote", null] } },
        },
      },
    },
    repro_steps: {
      type: "object", additionalProperties: false, required: ["status", "steps", "provenance"],
      properties: {
        status: { type: "string", enum: ["customer_reported_unverified"] },
        steps: { type: "array", items: { type: "string" } },
        provenance: { type: "string", enum: ["direct_quote", "inferred"] },
      },
    },
    expected_vs_observed: {
      type: "object", additionalProperties: false, required: ["expected", "observed", "provenance"],
      properties: {
        expected: { type: "string" },
        observed: { type: "string" },
        provenance: { type: "string", enum: ["direct_quote", "inferred"] },
      },
    },
    evidence_links: {
      type: "object", additionalProperties: false, required: ["urls", "provenance"],
      properties: {
        urls: { type: "array", items: { type: "string" } },
        provenance: { type: "string", enum: ["deterministic"] },
      },
    },
    extraction_metadata: {
      type: "object", additionalProperties: false,
      required: ["human_notes_consulted", "customer_messages_consulted", "contains_unverified_claims"],
      properties: {
        human_notes_consulted: { type: "integer" },
        customer_messages_consulted: { type: "integer" },
        contains_unverified_claims: { type: "boolean" },
      },
    },
  },
};

async function askModel(aiKey: string, input: string): Promise<
  { ok: true; text: string; runId: string | null } | { ok: false; status: number; error: string }
> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
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
      text: { format: { type: "json_schema", name: "human_info_block", strict: true, schema: SCHEMA } },
    }),
  });
  const runId = res.headers.get("X-Lovable-AIG-Run-ID");
  if (!res.ok || !res.body) {
    const text = (await res.text().catch(() => "")).slice(0, 500);
    return { ok: false, status: res.status, error: text || "no response body" };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  let failure: string | null = null;
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
        if (evt?.type === "response.output_text.delta" && typeof evt.delta === "string") out += evt.delta;
        else if (evt?.type === "response.completed" && !out && typeof evt?.response?.output_text === "string") {
          out = evt.response.output_text;
        } else if (evt?.type === "response.failed" || evt?.type === "error") {
          failure = JSON.stringify(evt?.response?.error ?? evt?.error ?? evt).slice(0, 500);
        } else if (evt?.type === "response.refusal.delta") {
          failure = "Model refused to extract this ticket";
        }
      } catch { /* keepalive / partial frame */ }
    }
  }
  if (failure && !out) return { ok: false, status: 502, error: failure };
  return { ok: true, text: out, runId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const id = String(body?.conversation_id ?? "").trim();
  if (!/^\d{6,25}$/.test(id)) return json({ error: "conversation_id (numeric Intercom id) required" }, 400);

  const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
  const aiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!intercomToken) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);
  if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  const convRes = await fetch(`${INTERCOM_BASE}/conversations/${id}?display_as=plaintext`, {
    headers: {
      Authorization: `Bearer ${intercomToken}`,
      Accept: "application/json",
      "Intercom-Version": INTERCOM_VERSION,
    },
  });
  if (!convRes.ok) {
    const t = (await convRes.text().catch(() => "")).slice(0, 300);
    return json({ error: `Intercom fetch failed (HTTP ${convRes.status})`, detail: t }, convRes.status === 404 ? 404 : 502);
  }
  const conv = await convRes.json();
  const built = buildInput(conv, id);

  const ai = await askModel(aiKey, built.input);
  if (!ai.ok) {
    const status = [400, 401, 402, 403, 404, 429].includes(ai.status) ? ai.status : 502;
    return json({ error: "AI extraction failed", status: ai.status, detail: ai.error }, status);
  }
  if (!ai.text.trim()) return json({ error: "AI returned an empty result" }, 502);

  let parsed: any;
  try { parsed = JSON.parse(ai.text); } catch {
    return json({ error: "AI returned malformed JSON", raw: ai.text.slice(0, 1000) }, 502);
  }

  // ---- Server-side enforcement of the locked contract ----
  parsed.repro_steps.status = "customer_reported_unverified"; // human-only verification
  parsed.identifiers.intercom_conversation_id = { value: id, provenance: "deterministic" };
  const text = built.input;
  // Deterministic IDs must literally appear in the source; drop anything invented.
  for (const k of ["user_id", "project_id", "workspace_id"]) {
    const f = parsed.identifiers[k];
    f.candidates = (f.candidates ?? []).filter((c: any) => c?.id && text.includes(c.id));
    if (f.primary && !text.includes(f.primary)) f.primary = f.candidates[0]?.id ?? null;
    if (f.primary && !f.candidates.some((c: any) => c.id === f.primary)) {
      f.candidates.unshift({ id: f.primary, context: "Primary" });
    }
    f.provenance = f.primary || f.candidates.length ? "deterministic" : null;
  }
  const st = parsed.identifiers.slack_thread_url;
  if (st.value && !text.includes(st.value)) st.value = null;
  if (!st.value && built.slackUrls.length) st.value = built.slackUrls[built.slackUrls.length - 1];
  st.provenance = st.value ? "deterministic" : null;
  parsed.evidence_links.urls = [...new Set((parsed.evidence_links.urls ?? []).filter((u: string) => text.includes(u)))];
  if (parsed.summary.value.length > 120) parsed.summary.value = parsed.summary.value.slice(0, 117) + "...";
  if (parsed.customer_statement.value.length > 300) {
    parsed.customer_statement.value = parsed.customer_statement.value.slice(0, 294) + " [...]";
  }
  const urg = parsed.impact.customer_stated_urgency;
  urg.provenance = urg.value ? "direct_quote" : null;

  return json({
    ok: true,
    conversation_id: id,
    extraction: parsed,
    source_stats: { customer_messages: built.customerCount, human_notes: built.noteCount, input_chars: text.length },
    model: MODEL,
    ai_run_id: ai.runId,
  });
});
