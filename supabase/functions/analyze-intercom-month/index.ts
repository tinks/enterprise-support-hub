import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

interface TicketLite {
  id: string;
  subject: string;
  first_message: string;
  current_product_area: string | null;
  current_classification: string | null;
}

interface Bucket {
  name: string;
  description: string;
}

function monthRange(month: string): { start: string; end: string } | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  if (mon < 1 || mon > 12) return null;
  const start = new Date(Date.UTC(year, mon - 1, 1)).toISOString();
  const end = new Date(Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 1)).toISOString();
  return { start, end };
}

function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function callAI(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

function getToolArgs(payload: any): any {
  const call = payload?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) throw new Error("AI returned no tool call");
  return JSON.parse(call.function.arguments);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { month } = await req.json();
    const range = monthRange(month);
    if (!range) {
      return new Response(JSON.stringify({ error: "month must be YYYY-MM" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Allowed product areas
    const { data: settings } = await supabase
      .from("settings")
      .select("product_areas")
      .limit(1)
      .single();
    const productAreas = (settings?.product_areas || "")
      .split(",").map((s: string) => s.trim()).filter(Boolean);
    if (!productAreas.includes("Other")) productAreas.push("Other");

    // Pull tickets
    const { data: tickets, error } = await supabase
      .from("manual_conversations")
      .select("id, subject, contact_name, product_area, classification, created_at")
      .eq("source", "intercom")
      .eq("is_test", false)
      .neq("status", "cancelled")
      .gte("created_at", range.start)
      .lt("created_at", range.end);
    if (error) throw error;
    if (!tickets || tickets.length === 0) {
      return new Response(JSON.stringify({ error: "No tickets found for this month" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // First user message per ticket
    const ids = tickets.map(t => t.id);
    const { data: msgs } = await supabase
      .from("manual_messages")
      .select("conversation_id, message_text, role, is_internal_note, created_at")
      .in("conversation_id", ids)
      .eq("role", "user")
      .eq("is_internal_note", false)
      .order("created_at", { ascending: true });
    const firstByConv = new Map<string, string>();
    for (const m of msgs || []) {
      if (!firstByConv.has(m.conversation_id)) {
        firstByConv.set(m.conversation_id, stripHtml(m.message_text));
      }
    }

    const lite: TicketLite[] = tickets.map(t => ({
      id: t.id,
      subject: stripHtml(t.subject || "").slice(0, 200),
      first_message: (firstByConv.get(t.id) || "").slice(0, 600),
      current_product_area: t.product_area || null,
      current_classification: t.classification || null,
    }));

    // PASS A: Discover buckets
    const discoverInput = lite.map(t => `- ${t.id} | ${t.subject} | ${t.first_message.slice(0, 200)}`).join("\n");
    const discoverPayload = await callAI(LOVABLE_API_KEY, {
      model: MODEL,
      messages: [
        { role: "system", content: "You analyze enterprise support tickets to discover topical buckets. Group tickets by the user's underlying problem or request, not by product surface. Aim for 6-10 mutually exclusive, collectively exhaustive buckets that cover the full set. Bucket names should be 2-5 words, action-oriented." },
        { role: "user", content: `Here are ${lite.length} support tickets from a single month. Propose 6-10 topic buckets that group them. Each bucket needs a short name and a one-sentence description of what belongs in it.\n\n${discoverInput}` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "propose_buckets",
          description: "Return the proposed topic buckets",
          parameters: {
            type: "object",
            properties: {
              buckets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["name", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["buckets"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "propose_buckets" } },
    });
    const buckets: Bucket[] = getToolArgs(discoverPayload).buckets;
    if (!buckets?.length) throw new Error("No buckets proposed");
    const bucketNames = buckets.map(b => b.name);

    // PASS B: Assign each ticket → bucket + product_area, in chunks
    const CHUNK = 40;
    const assignments: { ticket_id: string; bucket: string; product_area: string }[] = [];
    for (let i = 0; i < lite.length; i += CHUNK) {
      const chunk = lite.slice(i, i + CHUNK);
      const chunkInput = chunk.map(t => `- ${t.id} | ${t.subject} | ${t.first_message}`).join("\n");
      const bucketList = buckets.map(b => `- "${b.name}": ${b.description}`).join("\n");
      const paList = productAreas.map((a: string) => `"${a}"`).join(", ");
      const assignPayload = await callAI(LOVABLE_API_KEY, {
        model: MODEL,
        messages: [
          { role: "system", content: "You assign each support ticket to exactly one topic bucket and one product area. Use the EXACT names provided. If unsure, pick the closest fit." },
          { role: "user", content: `Buckets:\n${bucketList}\n\nProduct areas (must be one of): ${paList}\n\nAssign each ticket below.\n\n${chunkInput}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "assign_tickets",
            description: "Return one assignment per input ticket",
            parameters: {
              type: "object",
              properties: {
                assignments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      ticket_id: { type: "string" },
                      bucket: { type: "string", enum: bucketNames },
                      product_area: { type: "string", enum: productAreas },
                    },
                    required: ["ticket_id", "bucket", "product_area"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["assignments"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "assign_tickets" } },
      });
      const out = getToolArgs(assignPayload).assignments as typeof assignments;
      assignments.push(...out);
    }

    // Aggregate
    const subjectById = new Map(lite.map(t => [t.id, t.subject]));
    const byBucket = new Map<string, { tickets: string[]; pa: Map<string, number> }>();
    for (const b of buckets) byBucket.set(b.name, { tickets: [], pa: new Map() });
    const productAreaSummary: Record<string, number> = {};
    for (const a of assignments) {
      const slot = byBucket.get(a.bucket);
      if (!slot) continue;
      slot.tickets.push(a.ticket_id);
      slot.pa.set(a.product_area, (slot.pa.get(a.product_area) || 0) + 1);
      productAreaSummary[a.product_area] = (productAreaSummary[a.product_area] || 0) + 1;
    }

    const bucketsOut = buckets.map(b => {
      const slot = byBucket.get(b.name)!;
      const paObj: Record<string, number> = {};
      for (const [k, v] of slot.pa) paObj[k] = v;
      const example_subjects = slot.tickets.slice(0, 5).map(id => subjectById.get(id) || id);
      return {
        name: b.name,
        description: b.description,
        ticket_count: slot.tickets.length,
        product_areas: paObj,
        example_subjects,
        ticket_ids: slot.tickets,
      };
    }).sort((a, b) => b.ticket_count - a.ticket_count);

    // PASS C: Executive summary
    const summaryInput = bucketsOut.map(b => `- ${b.name} (${b.ticket_count}): ${b.description}`).join("\n");
    const sumPayload = await callAI(LOVABLE_API_KEY, {
      model: MODEL,
      messages: [
        { role: "system", content: "You write concise executive summaries for support leaders. Plain prose, 2-3 short paragraphs. No headings, no bullets. Highlight the dominant themes, anything notable about the mix, and one or two product-area concentrations." },
        { role: "user", content: `Month had ${lite.length} Intercom tickets. Buckets:\n${summaryInput}\n\nProduct area distribution: ${JSON.stringify(productAreaSummary)}` },
      ],
    });
    const overall_summary: string = sumPayload?.choices?.[0]?.message?.content?.trim?.() || "";

    // Upsert
    const { error: upErr } = await supabase
      .from("monthly_insights")
      .upsert({
        month,
        source: "intercom",
        generated_at: new Date().toISOString(),
        ticket_count: lite.length,
        buckets: bucketsOut,
        product_area_summary: productAreaSummary,
        overall_summary,
      }, { onConflict: "month,source" });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true,
      month,
      ticket_count: lite.length,
      bucket_count: bucketsOut.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("analyze-intercom-month error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
