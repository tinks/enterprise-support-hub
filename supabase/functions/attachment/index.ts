import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ATTACHMENT_BUCKET = "customer-attachments";
const ALLOWED_PREFIX = "slack-attachments/";
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") ?? "";

    // Only allow re-hosted Slack attachments; block traversal and bucket escape.
    if (
      !path ||
      !path.startsWith(ALLOWED_PREFIX) ||
      path.includes("..") ||
      path.includes("//")
    ) {
      return new Response(JSON.stringify({ error: "Invalid attachment path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error(`Signed URL failed for ${path}:`, error);
      return new Response(JSON.stringify({ error: "Attachment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: data.signedUrl, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("attachment error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
