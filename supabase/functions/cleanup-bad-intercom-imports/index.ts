import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: settings } = await supabase.from("settings").select("intercom_inbox_id").limit(1).single();
  const enterpriseInboxId = String(settings?.intercom_inbox_id || "");
  if (!enterpriseInboxId) {
    return new Response(JSON.stringify({ error: "No enterprise inbox configured" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Optional flags
  let dryRun = false;
  let batchSize = 80; // process ~80 per invocation to stay under 150s timeout
  let offset = 0;
  try {
    const body = await req.json();
    if (body && body.dryRun === true) dryRun = true;
    if (body && typeof body.batchSize === "number") batchSize = Math.min(200, Math.max(1, body.batchSize));
    if (body && typeof body.offset === "number") offset = Math.max(0, body.offset);
  } catch { /* no body */ }

  // Fetch a batch of intercom-source rows
  const { data: rows, error, count } = await supabase
    .from("manual_conversations")
    .select("id, intercom_conversation_id, created_at", { count: "exact" })
    .eq("source", "intercom")
    .not("intercom_conversation_id", "is", null)
    .order("created_at", { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const totalRemaining = count || 0;
  const batchCount = rows?.length || 0;
  let checked = 0;
  let kept = 0;
  let deleted = 0;
  let apiErrors = 0;
  let notFound = 0;
  const deletedIds: string[] = [];

  for (const row of rows || []) {
    checked++;
    const intercomId = row.intercom_conversation_id!;
    try {
      const res = await fetch(`https://api.intercom.io/conversations/${intercomId}`, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.13",
        },
      });

      if (res.status === 404) {
        notFound++;
        if (!dryRun) {
          await supabase.from("manual_messages").delete().eq("conversation_id", row.id);
          await supabase.from("conversation_audit_logs").delete().eq("conversation_id", row.id).eq("conversation_source", "manual");
          await supabase.from("conversation_notes").delete().eq("conversation_id", row.id).eq("conversation_source", "manual");
          await supabase.from("manual_conversations").delete().eq("id", row.id);
        }
        deleted++;
        deletedIds.push(row.id);
      } else if (!res.ok) {
        apiErrors++;
        console.error(`API error ${res.status} for ${intercomId}`);
      } else {
        const data = await res.json();
        const teamId = String(data.team_assignee_id || "");
        if (teamId === enterpriseInboxId) {
          kept++;
        } else {
          if (!dryRun) {
            await supabase.from("manual_messages").delete().eq("conversation_id", row.id);
            await supabase.from("conversation_audit_logs").delete().eq("conversation_id", row.id).eq("conversation_source", "manual");
            await supabase.from("conversation_notes").delete().eq("conversation_id", row.id).eq("conversation_source", "manual");
            await supabase.from("manual_conversations").delete().eq("id", row.id);
          }
          deleted++;
          deletedIds.push(row.id);
          console.log(`${dryRun ? "[dry-run] would delete" : "Deleted"} ${row.id} (intercom ${intercomId}, team ${teamId})`);
        }
      }
    } catch (e) {
      apiErrors++;
      console.error(`Exception for ${intercomId}:`, e);
    }

    // Light rate limit
    await new Promise((r) => setTimeout(r, 50));
  }

  // In dry-run mode, the row is still in the DB so totalRemaining doesn't shrink.
  // Caller should advance offset by batchCount for dry-run; for real runs, deleted rows
  // disappear so the next call with offset=0 naturally pulls the next un-checked rows
  // (kept rows accumulate at the front — caller should advance offset by `kept`).
  const nextOffset = dryRun ? offset + batchCount : kept;
  const done = batchCount === 0 || (totalRemaining <= batchCount && deleted + kept === batchCount);

  return new Response(JSON.stringify({
    ok: true,
    dryRun,
    enterpriseInboxId,
    totalRemaining,
    batchCount,
    checked,
    kept,
    deleted,
    notFound,
    apiErrors,
    deletedIds: deletedIds.slice(0, 50),
    nextOffset,
    done,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
