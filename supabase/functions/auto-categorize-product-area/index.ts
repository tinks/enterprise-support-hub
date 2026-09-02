import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

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

async function classifyOne(
  apiKey: string,
  c: Candidate,
  areas: string[],
  systemPrompt: string,
): Promise<{ product_area: string; confidence: number; reason: string }> {
  const userMsg = `Subject: ${c.subject || "(no subject)"}\n\nMessage:\n${c.body || "(no body)"}`;
  const payload = await callAI(apiKey, {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "categorize_ticket",
          description: "Return the single best product area for this support ticket.",
          parameters: {
            type: "object",
            properties: {
              product_area: { type: "string", enum: areas },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string", description: "One short sentence explaining the choice." },
            },
            required: ["product_area", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "categorize_ticket" } },
  });
  const call = payload?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("AI returned no tool call");
  return JSON.parse(call.function.arguments);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const { from, to, ids, dryRun, minConfidence, excludeInternal } = await req.json();
    if (!from || !to) {
      return new Response(JSON.stringify({ error: "from and to ISO timestamps required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const minConf = typeof minConfidence === "number" ? minConfidence : 0.5;

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

    // Load product areas from settings
    const { data: settings } = await supabase.from("settings").select("product_areas").limit(1).maybeSingle();
    const areasRaw = (settings?.product_areas || "").split(",").map((s: string) => s.trim()).filter(Boolean);
    const areas: string[] = Array.from(new Set([...areasRaw, "Other"]));
    if (areas.length < 2) {
      return new Response(JSON.stringify({ error: "No product_areas configured in settings" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You categorize enterprise support tickets into exactly one product area from this list:

${areas.map(a => `- ${a}`).join("\n")}

Pick the single best fit based on the subject and message body. Use "Other" only when nothing else clearly applies. Return a confidence in [0,1]; use lower confidence if the message is too short or ambiguous.`;

    const idSet = Array.isArray(ids) && ids.length ? new Set(ids as string[]) : null;

    const baseFilter = (q: any) =>
      q.eq("is_test", false).gte("created_at", from).lte("created_at", to).limit(2000);

    const uncatOr = "product_area.is.null,product_area.eq.Uncategorized";

    const [slackRes, gmailRes, manualRes] = await Promise.all([
      baseFilter(supabase.from("conversation_mappings").select("id,original_message_text,product_area")).or(uncatOr),
      baseFilter(supabase.from("gmail_conversations").select("id,subject,snippet,from_email,product_area")).or(uncatOr),
      baseFilter(supabase.from("manual_conversations").select("id,subject,product_area")).or(uncatOr),
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
      if (excludeInternal && /lovable\.dev$/i.test(r.from_email || "")) continue;
      candidates.push({ id: r.id, source: "gmail", table: "gmail_conversations", subject: r.subject || "", body: clip(r.snippet || "") });
    }
    const manualRows = (manualRes.data || []).filter(r => !idSet || idSet.has(r.id));
    const manualIds = manualRows.map(r => r.id);
    const manualBodies: Record<string, string> = {};
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
    for (const r of manualRows) {
      candidates.push({ id: r.id, source: "manual", table: "manual_conversations", subject: r.subject || "", body: manualBodies[r.id] || "" });
    }

    const results: Array<{ id: string; source: string; product_area?: string; confidence?: number; reason?: string; written: boolean; error?: string }> = [];
    let written = 0, lowConfidence = 0, failed = 0;

    const CONCURRENCY = 8;
    const processOne = async (c: Candidate) => {
      try {
        const out = await classifyOne(LOVABLE_API_KEY, c, areas, systemPrompt);
        if (!areas.includes(out.product_area)) throw new Error(`invalid product_area: ${out.product_area}`);
        let didWrite = false;
        if (!dryRun && out.confidence >= minConf) {
          const { error } = await supabase.from(c.table).update({ product_area: out.product_area }).eq("id", c.id);
          if (error) throw error;

          // Propagate to gmail siblings
          if (c.source === "gmail") {
            const { data: row } = await supabase
              .from("gmail_conversations").select("gmail_thread_id").eq("id", c.id).maybeSingle();
            if (row?.gmail_thread_id) {
              await supabase.from("gmail_conversations")
                .update({ product_area: out.product_area })
                .eq("gmail_thread_id", row.gmail_thread_id);
            }
          }

          await supabase.from("conversation_audit_logs").insert({
            conversation_id: c.id,
            conversation_source: c.source,
            action: "product_area_set",
            old_value: null,
            new_value: out.product_area,
            performed_by: "auto-categorize",
          });

          didWrite = true;
          written++;
        } else if (out.confidence < minConf) {
          lowConfidence++;
        }
        results.push({ id: c.id, source: c.source, product_area: out.product_area, confidence: out.confidence, reason: out.reason, written: didWrite });
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
      areas,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
