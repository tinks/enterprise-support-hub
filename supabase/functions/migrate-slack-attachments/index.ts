// One-off admin utility: move already re-hosted Slack attachments out of the
// public `public-assets` bucket into the private `customer-attachments` bucket.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";
import { ATTACHMENT_BUCKET, ATTACHMENT_PREFIX } from "../_shared/attachments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOURCE_BUCKET = "public-assets";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;

  const moved: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  // Walk every folder under slack-attachments/
  const { data: folders, error: listErr } = await supabase.storage
    .from(SOURCE_BUCKET)
    .list(ATTACHMENT_PREFIX.replace(/\/$/, ""), { limit: 1000 });

  if (listErr) {
    return new Response(JSON.stringify({ error: listErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  for (const folder of folders ?? []) {
    const { data: files } = await supabase.storage
      .from(SOURCE_BUCKET)
      .list(`${ATTACHMENT_PREFIX}${folder.name}`, { limit: 1000 });

    for (const file of files ?? []) {
      const path = `${ATTACHMENT_PREFIX}${folder.name}/${file.name}`;
      if (dryRun) {
        moved.push(path);
        continue;
      }
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from(SOURCE_BUCKET)
          .download(path);
        if (dlErr || !blob) throw new Error(dlErr?.message || "download failed");

        const { error: upErr } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(path, blob, {
            contentType: (file.metadata as Record<string, string> | null)?.mimetype ||
              blob.type || "application/octet-stream",
            upsert: true,
          });
        if (upErr) throw new Error(upErr.message);

        const { error: rmErr } = await supabase.storage.from(SOURCE_BUCKET).remove([path]);
        if (rmErr) throw new Error(`copied but delete failed: ${rmErr.message}`);

        moved.push(path);
      } catch (e) {
        failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return new Response(
    JSON.stringify({ dryRun, movedCount: moved.length, failedCount: failed.length, moved, failed }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
