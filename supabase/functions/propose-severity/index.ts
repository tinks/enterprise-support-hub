// propose-severity — AI proposes a Severity 1–4 for a ticket. It NEVER writes to
// Intercom and never touches an Intercom-owned column. The only artefact is a row
// in `severity_proposals`, which a human then accepts (through esh-write-action)
// or overrides.
//
// Two passes:
//   triage      — subject + first customer message only (what triage actually sees)
//   reclassify  — source + the full non-note thread
//
// Cost discipline is explicit and enforced here, not assumed:
//   - hard truncation per pass
//   - one proposal per (ticket, content_hash): an unchanged ticket costs nothing
//   - max 25 tickets per call
//   - a daily call cap read from settings; past it the function REFUSES

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";
import { recordIntegrationHealth } from "../_shared/integration-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INTERCOM_BASE = "https://api.intercom.io";
const INTERCOM_VERSION = "2.13";
const MODEL = "google/gemini-3-flash-preview";
const MAX_IDS = 25;
const TRIAGE_CHARS = 4000;
const RECLASS_CHARS = 12000;
const FEWSHOT_LIMIT = 12;

type Pass = "triage" | "reclassify";

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

/** Builds the model input for a pass. Triage deliberately sees LESS. */
function buildInput(conv: any, pass: Pass): { text: string; subject: string } {
  const subject = String(conv?.source?.subject ?? conv?.title ?? "").trim();
  const source = stripHtml(conv?.source?.body);
  const lines: string[] = [];
  if (subject) lines.push(`Subject: ${subject}`);
  lines.push(`First customer message:\n${source}`);

  if (pass === "reclassify") {
    const parts: any[] = conv?.conversation_parts?.conversation_parts ?? [];
    const thread = parts
      .filter((p) => p?.part_type !== "note" && stripHtml(p?.body))
      .map((p) => {
        const who = p?.author?.type === "admin" ? "Support" : "Customer";
        return `${who}: ${stripHtml(p.body)}`;
      });
    if (thread.length) lines.push(`Thread:\n${thread.join("\n\n")}`);
  }

  const cap = pass === "triage" ? TRIAGE_CHARS : RECLASS_CHARS;
  return { text: lines.join("\n\n").slice(0, cap), subject };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const pass: Pass = body?.pass === "reclassify" ? "reclassify" : "triage";
  const force = body?.force === true;
  const ids: string[] = Array.isArray(body?.ticketIds)
    ? Array.from(new Set(body.ticketIds.map((x: unknown) => String(x ?? "").trim()).filter(Boolean)))
    : [];

  if (ids.length === 0) return json({ error: "ticketIds must be a non-empty string array" }, 400);
  if (ids.length > MAX_IDS) return json({ error: `at most ${MAX_IDS} tickets per call` }, 400);

  const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
  const aiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!intercomToken) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);
  if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  // ─── kill switch + daily budget ───
  const { data: settings } = await supabase
    .from("settings")
    .select("severity_ai_enabled, severity_ai_daily_call_cap")
    .limit(1)
    .maybeSingle();

  if (settings && settings.severity_ai_enabled === false) {
    return json({ error: "Severity AI is disabled in settings" }, 403);
  }
  const cap = settings?.severity_ai_daily_call_cap ?? 200;

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count: usedToday } = await supabase
    .from("severity_proposals")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since.toISOString());

  let budget = Math.max(0, cap - (usedToday ?? 0));
  if (budget === 0) {
    return json(
      { error: `Daily severity-AI call cap reached (${cap}). Nothing was sent to the model.` },
      429,
    );
  }

  // ─── active rubric ───
  const { data: rubric } = await supabase
    .from("severity_rubric_versions")
    .select("version, body")
    .eq("status", "active")
    .maybeSingle();
  if (!rubric) return json({ error: "No active severity rubric" }, 400);

  // ─── few-shot: what humans actually decided, overrides first ───
  const { data: history } = await supabase
    .from("severity_proposals")
    .select("intercom_conversation_id, proposed_severity, final_severity, status, rationale, evidence")
    .in("status", ["accepted", "overridden"])
    .order("decided_at", { ascending: false, nullsFirst: false })
    .limit(FEWSHOT_LIMIT);

  const examples = (history ?? [])
    .map((h) => {
      const finalSev = h.final_severity ?? h.proposed_severity;
      const snippet = String(h.evidence ?? h.rationale ?? "").slice(0, 240);
      if (!snippet) return null;
      return `Ticket: ${snippet}\nSeverity the team settled on: ${finalSev}${
        h.status === "overridden" ? ` (AI had proposed ${h.proposed_severity} — corrected)` : ""
      }`;
    })
    .filter(Boolean)
    .join("\n\n");

  const results: any[] = [];
  let calls = 0;
  let lastHealth: { status: "ok" | "auth_error" | "error"; error?: string } | null = null;

  for (const id of ids) {
    if (budget <= 0) {
      results.push({ id, ok: false, skipped: "daily_cap" });
      continue;
    }

    // 1. read the conversation (read-only)
    let conv: any;
    try {
      const res = await fetch(
        `${INTERCOM_BASE}/conversations/${id}?display_as=plaintext`,
        {
          headers: {
            Authorization: `Bearer ${intercomToken}`,
            Accept: "application/json",
            "Intercom-Version": INTERCOM_VERSION,
          },
        },
      );
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 300);
        lastHealth = { status: res.status === 401 || res.status === 403 ? "auth_error" : "error", error: text };
        results.push({ id, ok: false, error: `Intercom ${res.status}: ${text}` });
        continue;
      }
      conv = await res.json();
    } catch (e) {
      lastHealth = { status: "error", error: String(e) };
      results.push({ id, ok: false, error: String(e) });
      continue;
    }

    const { text } = buildInput(conv, pass);
    const contentHash = await sha256(`${pass}|v${rubric.version}|${text}`);

    // 2. unchanged input → no model call at all
    if (!force) {
      const { data: existing } = await supabase
        .from("severity_proposals")
        .select("id, proposed_severity, confidence, rationale, status, pass, created_at")
        .eq("intercom_conversation_id", id)
        .eq("content_hash", contentHash)
        .maybeSingle();
      if (existing) {
        results.push({ id, ok: true, skipped: "unchanged", proposal: existing });
        continue;
      }
    }

    // 3. ask the model
    let aiJson: any;
    try {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content:
                `You assign a support ticket severity from 1 (Critical) to 4 (Trivial) for an enterprise support team.\n\n` +
                `SEVERITY RUBRIC (authoritative):\n${rubric.body}\n\n` +
                (examples
                  ? `HOW THIS TEAM ACTUALLY CLASSIFIES (recent human decisions — follow these when they conflict with your instinct):\n${examples}\n\n`
                  : "") +
                (pass === "triage"
                  ? `You are seeing ONLY the opening message, as a triager would. Judge on what is present; use "low" confidence when the impact is genuinely unclear rather than inventing detail.`
                  : `You are seeing the full thread. Re-judge with everything now known.`),
            },
            { role: "user", content: text },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "propose_severity",
                description: "Propose a severity for the ticket",
                parameters: {
                  type: "object",
                  properties: {
                    severity: { type: "integer", enum: [1, 2, 3, 4] },
                    confidence: { type: "string", enum: ["high", "medium", "low"] },
                    rationale: { type: "string", description: "One sentence, max 200 characters, citing the rubric line that applies" },
                    evidence: { type: "string", description: "Short quote or paraphrase from the ticket that drove the call" },
                  },
                  required: ["severity", "confidence", "rationale", "evidence"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "propose_severity" } },
        }),
      });

      calls += 1;
      budget -= 1;

      if (!aiRes.ok) {
        const errText = (await aiRes.text().catch(() => "")).slice(0, 300);
        // Gateway failures are surfaced verbatim — never swallowed into a fake proposal.
        if (aiRes.status === 402 || aiRes.status === 429 || aiRes.status === 403) {
          results.push({ id, ok: false, error: `AI gateway ${aiRes.status}: ${errText}` });
          lastHealth = { status: "error", error: errText };
          break; // terminal / rate limited: stop the batch rather than burn the rest
        }
        results.push({ id, ok: false, error: `AI gateway ${aiRes.status}: ${errText}` });
        lastHealth = { status: "error", error: errText };
        continue;
      }
      aiJson = await aiRes.json();
    } catch (e) {
      lastHealth = { status: "error", error: String(e) };
      results.push({ id, ok: false, error: String(e) });
      continue;
    }

    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      results.push({ id, ok: false, error: "No structured output from AI" });
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      results.push({ id, ok: false, error: "Unparseable AI output" });
      continue;
    }

    const sev = Number(parsed.severity);
    if (![1, 2, 3, 4].includes(sev)) {
      results.push({ id, ok: false, error: `AI returned an out-of-range severity: ${parsed.severity}` });
      continue;
    }

    // 4. persist. Any earlier live proposal for this ticket is superseded, not deleted.
    await supabase
      .from("severity_proposals")
      .update({ status: "superseded" })
      .eq("intercom_conversation_id", id)
      .eq("status", "proposed");

    const row = {
      intercom_conversation_id: id,
      pass,
      proposed_severity: sev,
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      rationale: String(parsed.rationale ?? "").slice(0, 400),
      evidence: String(parsed.evidence ?? "").slice(0, 800),
      rubric_version: rubric.version,
      model: MODEL,
      input_chars: text.length,
      input_tokens: aiJson?.usage?.prompt_tokens ?? null,
      output_tokens: aiJson?.usage?.completion_tokens ?? null,
      content_hash: contentHash,
      status: "proposed",
    };

    const { data: inserted, error: insErr } = await supabase
      .from("severity_proposals")
      .upsert(row, { onConflict: "intercom_conversation_id,content_hash" })
      .select()
      .maybeSingle();

    if (insErr) {
      results.push({ id, ok: false, error: `save failed: ${insErr.message}` });
      continue;
    }

    lastHealth = { status: "ok" };
    results.push({ id, ok: true, proposal: inserted });
  }

  if (lastHealth) {
    await recordIntegrationHealth(
      supabase,
      "severity_ai",
      lastHealth.status,
      lastHealth.error ?? null,
    );
  }

  return json({
    results,
    calls,
    remainingToday: Math.max(0, budget),
    rubricVersion: rubric.version,
    pass,
  });
});
