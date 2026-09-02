// One-shot maintenance function: fetches the latest .lovable/project-knowledge.md
// from the deployed app and stages it as pending_content on the knowledge_documents
// row (id = 'project-knowledge') for UI approval on /knowledge.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SSRF guard: the fallback fetch may only reach this project's own hosts.
const ALLOWED_SOURCE_HOSTS = [
  "enterprise-support-hub.lovable.app",
  "id-preview--0bb0198a-d579-40ab-9101-dfd268f239a5.lovable.app",
];
const DEFAULT_SOURCE_URL =
  "https://enterprise-support-hub.lovable.app/.lovable/project-knowledge.md";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Maintenance callers present the service-role key directly; everyone else
  // needs a signed-in editor session.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "").trim();
  const isServiceRole = !!bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isServiceRole) {
    const gate = await requireEditor(req, corsHeaders);
    if (!gate.ok) return gate.response;
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    // Accept either `markdown` (canonical) or `content` (common mistake — same shape).
    const inlineMarkdown =
      (body as { markdown?: string }).markdown ??
      (body as { content?: string }).content;
    const sourceUrl =
      (body as { sourceUrl?: string }).sourceUrl || DEFAULT_SOURCE_URL;
    const summary =
      (body as { summary?: string }).summary ||
      "Catch-up sync from .lovable/project-knowledge.md";

    let sourceHost = "";
    try {
      const parsed = new URL(sourceUrl);
      sourceHost = parsed.hostname;
      if (parsed.protocol !== "https:" || !ALLOWED_SOURCE_HOSTS.includes(sourceHost)) {
        return new Response(
          JSON.stringify({ error: "sourceUrl is not an allowed host", host: sourceHost }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch {
      return new Response(JSON.stringify({ error: "sourceUrl is not a valid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


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
      // Guard against the auth-walled HTML shell: published URLs behind login
      // return an index.html that looks like a valid response but isn't markdown.
      const ct = res.headers.get("content-type") || "";
      const looksLikeHtml = ct.includes("text/html") ||
        /^\s*<!doctype html|<html[\s>]/i.test(markdown.slice(0, 200));
      if (looksLikeHtml) {
        return new Response(
          JSON.stringify({
            error: "Source URL returned HTML, not markdown (likely auth-walled). Pass `markdown` (or `content`) in the request body instead of relying on the fallback fetch.",
            contentType: ct,
            length: markdown.length,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
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
