import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const CLASSIFICATIONS = ["Issue", "Configuration", "Bug", "FR", "Question"] as const;
type Classification = typeof CLASSIFICATIONS[number];

const SYSTEM_PROMPT = `You classify enterprise support tickets into exactly one of these buckets:

- Issue: User is hitting unexpected or broken behavior in the product, but it isn't necessarily a confirmed reproducible defect. Things "not working as expected".
- Configuration: Setup, admin, SSO, SCIM, permissions, billing, account access, or environment configuration the user needs help with.
- Bug: A clearly reproducible defect in the product (error, crash, regression, broken feature with steps to reproduce or strong evidence).
- FR: Feature request or product enhancement ask.
- Question: How-to, clarification, documentation, or general inquiry. Nothing is broken.

Pick the single best fit. Prefer "Issue" over "Bug" unless the message clearly demonstrates a reproducible defect. Prefer "Configuration" for SSO/SCIM/permissions/billing/account-setup topics. Prefer "Question" for pure how-to with no broken behavior. Return a confidence in [0,1].`;

function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function clip(s: string, max = 1500): string {
  const t = stripHtml(s);
  return t.length > max ? t.slice(0, max) + "…" : t;
}

interface Candidate {
  id: string;
  source: "slack" | "gmail" | "manual";
  table: "conversation_mappings" | "gmail_conversations" | "manual_conversations";
  subject: string;
  body: string;
}

async function callAI(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

async function classifyOne(apiKey: string, c: Candidate): Promise<{ classification: Classification; confidence: number; reason: string }> {
  const userMsg = `Subject: ${c.subject || "(no subject)"}\n\nMessage:\n${c.body || "(no body)"}`;
  const payload = await callAI(apiKey, {
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "classify_ticket",
          description: "Return the single best classification bucket for this support ticket.",
          parameters: {
            type: "object",
            properties: {
              classification: { type: "string", enum: [...CLASSIFICATIONS] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string", description: "One short sentence explaining the choice." },
            },
            required: ["classification", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "classify_ticket" } },
  });
  const call = payload?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("AI returned no tool call");
  const args = JSON.parse(call.function.arguments);
  return args;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const { from, to, ids, dryRun, minConfidence } = await req.json();
    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from and to ISO timestamps required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const minConf = typeof minConfidence === "number" ? minConfidence : 0.4;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const idSet = Array.isArray(ids) && ids.length ? new Set(ids as string[]) : null;

    // Helper: only return rows considered "Unclassified" (no classification, no is_bug, no is_feature_request, not test)
    const unclassifiedFilter = (q: any) =>
      q.is("classification", null).eq("is_bug", false).eq("is_feature_request", false).eq("is_test", false)
        .gte("created_at", from).lte("created_at", to).limit(2000);

    const [slackRes, gmailRes, manualRes] = await Promise.all([
      unclassifiedFilter(supabase.from("conversation_mappings").select("id,original_message_text")),
      unclassifiedFilter(supabase.from("gmail_conversations").select("id,subject,snippet")),
      unclassifiedFilter(supabase.from("manual_conversations").select("id,subject")),
    ]);
    if (slackRes.error) throw slackRes.error;
    if (gmailRes.error) throw gmailRes.error;
    if (manualRes.error) throw manualRes.error;

    const candidates: Candidate[] = [];
    for (const r of slackRes.data || []) {
      if (idSet && !idSet.has(r.id)) continue;
      const body = clip(r.original_message_text || "");
      candidates.push({ id: r.id, source: "slack", table: "conversation_mappings", subject: body.slice(0, 120), body });
    }
    for (const r of gmailRes.data || []) {
      if (idSet && !idSet.has(r.id)) continue;
      candidates.push({ id: r.id, source: "gmail", table: "gmail_conversations", subject: r.subject || "", body: clip(r.snippet || "") });
    }
    // For manual rows, also pull the first message text for context
    const manualIds = (manualRes.data || []).filter(r => !idSet || idSet.has(r.id)).map(r => r.id);
    let manualBodies: Record<string, string> = {};
    if (manualIds.length) {
      const { data: msgs } = await supabase
        .from("manual_messages")
        .select("conversation_id,message_text,created_at,is_internal_note")
        .in("conversation_id", manualIds)
        .eq("is_internal_note", false)
        .order("created_at", { ascending: true });
      for (const m of msgs || []) {
        if (!manualBodies[m.conversation_id]) manualBodies[m.conversation_id] = clip(m.message_text || "");
      }
    }
    for (const r of manualRes.data || []) {
      if (idSet && !idSet.has(r.id)) continue;
      candidates.push({ id: r.id, source: "manual", table: "manual_conversations", subject: r.subject || "", body: manualBodies[r.id] || "" });
    }

    const results: Array<{ id: string; source: string; classification?: string; confidence?: number; reason?: string; written: boolean; error?: string }> = [];
    let written = 0, lowConfidence = 0, failed = 0;

    const CONCURRENCY = 8;
    const processOne = async (c: Candidate) => {
      try {
        const out = await classifyOne(LOVABLE_API_KEY, c);
        if (!CLASSIFICATIONS.includes(out.classification)) throw new Error(`invalid classification: ${out.classification}`);
        let didWrite = false;
        if (!dryRun && out.confidence >= minConf) {
          const update: Record<string, any> = { classification: out.classification };
          if (out.classification === "Bug") update.is_bug = true;
          if (out.classification === "FR") update.is_feature_request = true;
          const { error } = await supabase.from(c.table).update(update).eq("id", c.id);
          if (error) throw error;
          didWrite = true;
          written++;
        } else if (out.confidence < minConf) {
          lowConfidence++;
        }
        results.push({ id: c.id, source: c.source, classification: out.classification, confidence: out.confidence, reason: out.reason, written: didWrite });
      } catch (e) {
        failed++;
        results.push({ id: c.id, source: c.source, written: false, error: (e as Error).message });
      }
    };
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      await Promise.all(candidates.slice(i, i + CONCURRENCY).map(processOne));
    }

    return new Response(JSON.stringify({
      total: candidates.length,
      written,
      lowConfidence,
      failed,
      dryRun: !!dryRun,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
