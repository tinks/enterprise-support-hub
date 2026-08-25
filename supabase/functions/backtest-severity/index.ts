// backtest-severity — re-scores tickets you have ALREADY decided against a
// candidate rubric body, using the stored `input_excerpt` (no Intercom calls,
// no new ticket data, few-shot block disabled). It writes nothing: the caller
// gets agreement numbers back and decides whether the rubric draft is better.
//
// Ground truth comes from two places:
//   decisions — severity_proposals with a human final_severity
//   showdown  — severity_eval_items whose human severity still stands: adjudicated
//               `ai_wrong` / `both_defensible`, plus items the AI already got right
//               (so regressions on correct cases show up). `human_wrong` excluded.


import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "google/gemini-3-flash-preview";
const MAX_N = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Case = {
  id: string;
  excerpt: string;
  human: number;
  source: "decision" | "showdown" | "showdown_agreed";
};


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

  const n = Math.max(1, Math.min(Number(body?.n ?? 25) || 25, MAX_N));
  const draftRubric = String(body?.rubricBody ?? "").trim();
  if (!draftRubric) return json({ error: "rubricBody is required" }, 400);

  const aiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!aiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

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
    supabase.from("severity_proposals").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
    supabase.from("severity_eval_items").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
  ]);
  const budget = Math.max(0, cap - ((proposalsToday ?? 0) + (evalToday ?? 0)));
  if (budget < n) {
    return json({ error: `Only ${budget} model calls left in today's cap (${cap}); the backtest asked for ${n}.` }, 429);
  }

  // ─── build the ground-truth set ───
  const cases: Case[] = [];

  const { data: decided } = await supabase
    .from("severity_proposals")
    .select("intercom_conversation_id, final_severity, input_excerpt, evidence, rationale, decided_at")
    .in("status", ["accepted", "overridden"])
    .not("final_severity", "is", null)
    .order("decided_at", { ascending: false, nullsFirst: false })
    .limit(MAX_N);

  for (const d of decided ?? []) {
    const excerpt = String((d as any).input_excerpt ?? "").trim();
    if (!excerpt) continue; // never backtest on the model's own summary
    cases.push({
      id: String((d as any).intercom_conversation_id),
      excerpt,
      human: Number((d as any).final_severity),
      source: "decision",
    });
  }

  // Showdown ground truth: every item whose human severity still stands.
  // That means the AI's failures (`ai_wrong`), the ties (`both_defensible`),
  // AND the cases where the AI already agreed — otherwise a rubric draft that
  // breaks previously-correct calls would backtest as a pure win.
  // Only `human_wrong` is excluded: there the human label is not truth.
  const { data: evalItems } = await supabase
    .from("severity_eval_items")
    .select("intercom_conversation_id, human_severity, ai_severity, verdict, input_excerpt, created_at")
    .neq("verdict", "human_wrong")
    .not("input_excerpt", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_N * 2);

  for (const a of evalItems ?? []) {
    const id = String((a as any).intercom_conversation_id);
    if (cases.some((c) => c.id === id)) continue;
    const verdict = String((a as any).verdict ?? "");
    const agreed = Number((a as any).ai_severity) === Number((a as any).human_severity);
    // `pending` only qualifies when the AI already agreed (nothing to adjudicate).
    const adjudicated = verdict === "ai_wrong" || verdict === "both_defensible" || verdict === "agree";
    if (!adjudicated && !agreed) continue;
    cases.push({
      id,
      excerpt: String((a as any).input_excerpt),
      human: Number((a as any).human_severity),
      source: agreed && !adjudicated ? "showdown_agreed" : "showdown",
    });
  }


  const set = cases.filter((c) => [1, 2, 3, 4].includes(c.human)).slice(0, n);
  if (set.length === 0) {
    return json(
      { error: "No backtestable cases yet — a case needs a stored ticket excerpt and a human severity." },
      400,
    );
  }

  const results: any[] = [];
  let exact = 0;
  let offByOne = 0;

  for (const c of set) {
    let sev: number | null = null;
    let err: string | null = null;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content:
                `You assign a support ticket severity from 1 (Critical) to 4 (Trivial) for an enterprise support team.\n\n` +
                `SEVERITY RUBRIC (authoritative):\n${draftRubric}\n\n` +
                `You are seeing a short excerpt of the ticket. Judge on what is present.`,
            },
            { role: "user", content: c.excerpt },
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
                    rationale: { type: "string" },
                  },
                  required: ["severity", "rationale"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "propose_severity" } },
        }),
      });
      if (!res.ok) {
        err = `AI gateway ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
        if (res.status === 402 || res.status === 403 || res.status === 429) {
          results.push({ ...c, ai: null, error: err });
          break;
        }
      } else {
        const jsonRes = await res.json();
        const parsed = JSON.parse(
          jsonRes?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "null",
        );
        const s = Number(parsed?.severity);
        if ([1, 2, 3, 4].includes(s)) sev = s;
        else err = "No usable structured output";
      }
    } catch (e) {
      err = String(e);
    }

    if (sev != null) {
      if (sev === c.human) exact += 1;
      else if (Math.abs(sev - c.human) === 1) offByOne += 1;
    }
    results.push({ id: c.id, source: c.source, human: c.human, ai: sev, error: err });
  }

  const scored = results.filter((r) => r.ai != null).length;
  // A regression = a case the AI previously got right that the draft rubric now misses.
  const previouslyCorrect = results.filter((r) => r.source === "showdown_agreed" && r.ai != null);
  const regressions = previouslyCorrect.filter((r) => r.ai !== r.human).length;

  return json({
    scored,
    requested: set.length,
    previouslyCorrect: previouslyCorrect.length,
    regressions,

    exactMatch: exact,
    offByOne,
    offByTwoPlus: scored - exact - offByOne,
    agreementPct: scored ? Math.round((exact / scored) * 1000) / 10 : null,
    results,
    model: MODEL,
  });
});
