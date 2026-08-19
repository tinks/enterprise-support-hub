// run-severity-eval — the "showdown". Samples N tickets that ALREADY carry a
// human Severity in Intercom, asks the classifier cold (few-shot block disabled
// on purpose: this measures the rubric, not imitation), and records both numbers
// side by side in `severity_eval_runs` / `severity_eval_items`.
//
// It never writes to Intercom, never touches `severity_proposals`, and never
// promotes anything into training signal. A human adjudicates each disagreement
// afterwards.

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
const TRIAGE_CHARS = 4000;
const RECLASS_CHARS = 12000;
const EXCERPT_CHARS = 600;
const MAX_N = 50;

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
      .map((p) => `${p?.author?.type === "admin" ? "Support" : "Customer"}: ${stripHtml(p.body)}`);
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
  const n = Math.max(1, Math.min(Number(body?.n ?? 10) || 10, MAX_N));
  const label = String(body?.label ?? "").slice(0, 120) || null;

  const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
  const aiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!intercomToken) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);
  if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  // ─── kill switch + shared daily budget ───
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
  const [{ count: proposalsToday }, { count: evalToday }] = await Promise.all([
    supabase
      .from("severity_proposals")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString()),
    supabase
      .from("severity_eval_items")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since.toISOString()),
  ]);

  let budget = Math.max(0, cap - ((proposalsToday ?? 0) + (evalToday ?? 0)));
  if (budget === 0) {
    return json({ error: `Daily severity-AI call cap reached (${cap}). Nothing was sent to the model.` }, 429);
  }
  if (budget < n) {
    return json(
      { error: `Only ${budget} model calls left in today's cap (${cap}); the run asked for ${n}.` },
      429,
    );
  }

  const { data: rubric } = await supabase
    .from("severity_rubric_versions")
    .select("version, body")
    .eq("status", "active")
    .maybeSingle();
  if (!rubric) return json({ error: "No active severity rubric" }, 400);

  // ─── sample tickets that already have a human severity ───
  const { data: sample, error: sampleErr } = await supabase.rpc("v3_severity_eval_sample", { _n: n });
  if (sampleErr) return json({ error: `sample failed: ${sampleErr.message}` }, 500);
  const tickets = (sample ?? []) as Array<{
    conversation_id: string;
    human_severity: number;
    ticket_subject: string | null;
  }>;
  if (tickets.length === 0) return json({ error: "No tickets with a human severity to sample" }, 400);

  const { data: run, error: runErr } = await supabase
    .from("severity_eval_runs")
    .insert({
      label,
      pass,
      rubric_version: rubric.version,
      model: MODEL,
      requested_n: tickets.length,
      created_by: gate.userId ?? null,
    })
    .select()
    .single();
  if (runErr) return json({ error: `run create failed: ${runErr.message}` }, 500);

  let scored = 0;
  let lastHealth: { status: "ok" | "auth_error" | "error"; error?: string } | null = null;
  const items: any[] = [];

  for (const t of tickets) {
    if (budget <= 0) break;
    const id = t.conversation_id;

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
        lastHealth = { status: res.status === 401 || res.status === 403 ? "auth_error" : "error", error: text };
        items.push({
          run_id: run.id,
          intercom_conversation_id: id,
          subject: t.ticket_subject,
          human_severity: t.human_severity,
          error: `Intercom ${res.status}: ${text}`,
        });
        continue;
      }
      conv = await res.json();
    } catch (e) {
      items.push({
        run_id: run.id,
        intercom_conversation_id: id,
        subject: t.ticket_subject,
        human_severity: t.human_severity,
        error: String(e),
      });
      continue;
    }

    const { text, subject } = buildInput(conv, pass);

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
                // No few-shot block on purpose: this run measures the rubric cold.
                (pass === "triage"
                  ? `You are seeing ONLY the opening message, as a triager would. Judge on what is present.`
                  : `You are seeing the full thread. Judge with everything now known.`),
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
                    rationale: { type: "string", description: "One sentence citing the rubric line that applies" },
                    evidence: { type: "string", description: "Short quote or paraphrase from the ticket" },
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
      budget -= 1;

      if (!aiRes.ok) {
        const errText = (await aiRes.text().catch(() => "")).slice(0, 300);
        lastHealth = { status: "error", error: errText };
        items.push({
          run_id: run.id,
          intercom_conversation_id: id,
          subject: subject || t.ticket_subject,
          human_severity: t.human_severity,
          input_excerpt: text.slice(0, EXCERPT_CHARS),
          error: `AI gateway ${aiRes.status}: ${errText}`,
        });
        if (aiRes.status === 402 || aiRes.status === 403 || aiRes.status === 429) break;
        continue;
      }
      aiJson = await aiRes.json();
    } catch (e) {
      lastHealth = { status: "error", error: String(e) };
      items.push({
        run_id: run.id,
        intercom_conversation_id: id,
        subject: subject || t.ticket_subject,
        human_severity: t.human_severity,
        input_excerpt: text.slice(0, EXCERPT_CHARS),
        error: String(e),
      });
      continue;
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(aiJson?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "null");
    } catch {
      parsed = null;
    }
    const sev = Number(parsed?.severity);
    if (![1, 2, 3, 4].includes(sev)) {
      items.push({
        run_id: run.id,
        intercom_conversation_id: id,
        subject: subject || t.ticket_subject,
        human_severity: t.human_severity,
        input_excerpt: text.slice(0, EXCERPT_CHARS),
        error: "No usable structured output from AI",
      });
      continue;
    }

    lastHealth = { status: "ok" };
    scored += 1;
    items.push({
      run_id: run.id,
      intercom_conversation_id: id,
      subject: subject || t.ticket_subject,
      human_severity: t.human_severity,
      ai_severity: sev,
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      rationale: String(parsed.rationale ?? "").slice(0, 400),
      evidence: String(parsed.evidence ?? "").slice(0, 800),
      input_excerpt: text.slice(0, EXCERPT_CHARS),
      verdict: sev === t.human_severity ? "agree" : "pending",
    });
  }

  if (items.length) {
    const { error: itemsErr } = await supabase.from("severity_eval_items").insert(items);
    if (itemsErr) return json({ error: `items save failed: ${itemsErr.message}`, runId: run.id }, 500);
  }
  await supabase.from("severity_eval_runs").update({ scored_n: scored }).eq("id", run.id);

  if (lastHealth) {
    await recordIntegrationHealth(supabase, "severity_ai", lastHealth.status, lastHealth.error ?? null);
  }

  return json({
    runId: run.id,
    requested: tickets.length,
    scored,
    failed: items.length - scored,
    rubricVersion: rubric.version,
    pass,
  });
});
