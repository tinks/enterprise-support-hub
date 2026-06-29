// One-shot maintenance function: fetches the latest .lovable/project-knowledge.md
// from the deployed app and stages it as pending_content on the knowledge_documents
// row (id = 'project-knowledge') for UI approval on /knowledge.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const inlineMarkdown = (body as { markdown?: string }).markdown;
    const sourceUrl =
      (body as { sourceUrl?: string }).sourceUrl ||
      "https://enterprise-support-hub.lovable.app/.lovable/project-knowledge.md";
    const summary =
      (body as { summary?: string }).summary ||
      "Catch-up sync from .lovable/project-knowledge.md";

    let markdown: string;
    if (typeof inlineMarkdown === "string" && inlineMarkdown.length >= 100) {
      markdown = inlineMarkdown;
    } else {
      const res = await fetch(sourceUrl, { headers: { "cache-control": "no-cache" } });
      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch source: ${res.status}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      markdown = await res.text();
      if (!markdown || markdown.length < 100) {
        return new Response(
          JSON.stringify({ error: "Fetched markdown looks empty/invalid", length: markdown.length }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase
      .from("knowledge_documents")
      .update({
        pending_content: markdown,
        pending_summary: summary,
        pending_at: new Date().toISOString(),
      })
      .eq("id", "project-knowledge");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, length: markdown.length, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
