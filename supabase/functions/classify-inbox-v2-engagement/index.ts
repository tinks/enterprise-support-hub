import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Verdict = "engaged" | "none";

const SYSTEM_PROMPT = `You classify enterprise support tickets as either "engaged" or "none".

"none" (no engagement) means: Support was cc'd or looped in, but did NOT do any
substantive support work — no investigation, no troubleshooting, no answers
that moved the issue forward. Typical "none" patterns:
- Pure FYI / heads-up from another team
- Known duplicate of an existing issue, no new work
- Acknowledgement only (e.g., "thanks, we'll keep an eye on it")
- Auto-routed notifications with no human support reply

"engaged" means: Support actually engaged — asked clarifying questions,
investigated, replied with substance, escalated, or otherwise moved the
ticket forward.

Return strict JSON: {"verdict":"engaged"|"none","reason":"<one short sentence>"}.
Reason must be <= 140 chars.`;

async function classifyOne(
  intercomToken: string,
  lovableKey: string,
  intercomConvId: string,
): Promise<{ verdict: Verdict; reason: string } | { error: string }> {
  // Fetch conversation with plaintext bodies
  const icRes = await fetch(
    `https://api.intercom.io/conversations/${intercomConvId}?display_as=plaintext`,
    {
      headers: {
        Authorization: `Bearer ${intercomToken}`,
        Accept: "application/json",
        "Intercom-Version": "2.13",
      },
    },
  );
  if (!icRes.ok) {
    return { error: `Intercom fetch ${icRes.status}` };
  }
  const ic = await icRes.json();

  const lines: string[] = [];
  const subject = stripHtml(ic.source?.subject || ic.title || "");
  if (subject) lines.push(`Subject: ${subject}`);

  // Source message (first message)
  const src = ic.source;
  if (src) {
    const who = src.author?.type === "admin" ? `admin:${src.author?.name || "?"}` : `user:${src.author?.name || src.author?.email || "?"}`;
    const body = stripHtml(src.body || "");
    if (body) lines.push(`[${who}] ${body}`);
  }

  // Subsequent parts — skip notes & assignment events
  const parts = ic.conversation_parts?.conversation_parts || [];
  for (const p of parts) {
    const t = p.part_type;
    if (t === "note" || t === "assignment" || t === "default_assignment" || t === "conversation_attribute_updated_by_admin") continue;
    const body = stripHtml(p.body || "");
    if (!body) continue;
    const a = p.author;
    const who = a?.type === "admin" ? `admin:${a?.name || "?"}` : `user:${a?.name || a?.email || "?"}`;
    lines.push(`[${who}] ${body}`);
  }

  // Trim transcript to a sane size (chars, rough proxy for tokens)
  const MAX = 12000;
  let transcript = lines.join("\n");
  if (transcript.length > MAX) {
    transcript = transcript.slice(0, MAX) + "\n…[truncated]";
  }

  const userPrompt = `Classify the following ticket transcript. Output JSON only.\n\n---\n${transcript}\n---`;

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": lovableKey,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!aiRes.ok) {
    const text = await aiRes.text();
    return { error: `AI ${aiRes.status}: ${text.slice(0, 200)}` };
  }
  const aiData = await aiRes.json();
  const raw = aiData?.choices?.[0]?.message?.content || "";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return { error: "AI returned non-JSON" }; }
  const verdict: Verdict = parsed?.verdict === "none" ? "none" : "engaged";
  const reason = typeof parsed?.reason === "string" ? parsed.reason.slice(0, 200) : "";
  return { verdict, reason };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!INTERCOM_API_TOKEN || !LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing INTERCOM_API_TOKEN or LOVABLE_API_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { ticketIds?: string[] } = {};
  try { body = await req.json(); } catch { /* */ }
  const ticketIds = Array.isArray(body.ticketIds) ? body.ticketIds.filter((x) => typeof x === "string") : [];
  if (ticketIds.length === 0) {
    return new Response(JSON.stringify({ error: "ticketIds required (1..50)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (ticketIds.length > 50) {
    return new Response(JSON.stringify({ error: "max 50 ticketIds per call" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tickets, error: fetchErr } = await supabase
    .from("inbox_v2_tickets")
    .select("id, intercom_conversation_id")
    .in("id", ticketIds);
  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ id: string; verdict?: Verdict; reason?: string; error?: string }> = [];
  let ok = 0, failed = 0;

  for (const t of tickets || []) {
    try {
      const res = await classifyOne(INTERCOM_API_TOKEN, LOVABLE_API_KEY, t.intercom_conversation_id);
      if ("error" in res) {
        results.push({ id: t.id, error: res.error });
        failed++;
        continue;
      }
      const { error: upErr } = await supabase
        .from("inbox_v2_tickets")
        .update({
          engagement_ai_guess: res.verdict,
          engagement_ai_reason: res.reason,
          engagement_ai_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (upErr) {
        results.push({ id: t.id, error: upErr.message });
        failed++;
      } else {
        results.push({ id: t.id, verdict: res.verdict, reason: res.reason });
        ok++;
      }
    } catch (e) {
      results.push({ id: t.id, error: (e as Error).message });
      failed++;
    }
  }

  return new Response(JSON.stringify({ ok, failed, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
