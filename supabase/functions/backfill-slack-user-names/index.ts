import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
    if (!slackToken) {
      return new Response(JSON.stringify({ error: "Missing SLACK_BOT_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all distinct slack_user_ids that don't have a cached name yet
    const { data: rows, error } = await supabase
      .from("conversation_mappings")
      .select("id, slack_user_id")
      .is("slack_user_name", null)
      .neq("slack_user_id", "");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ message: "No rows to backfill", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplicate user IDs and resolve names
    const uniqueUserIds = [...new Set(rows.map((r) => r.slack_user_id))];
    const nameMap: Record<string, string> = {};

    for (const uid of uniqueUserIds) {
      try {
        const res = await fetch(
          `https://slack.com/api/users.info?user=${uid}`,
          { headers: { Authorization: `Bearer ${slackToken}` } }
        );
        const data = await res.json();
        if (data.ok && data.user) {
          const u = data.user;
          nameMap[uid] = u.profile?.display_name || u.real_name || u.name || uid;
        }
      } catch (e) {
        console.error(`Failed to resolve user ${uid}:`, e);
      }
    }

    // Update rows in batches
    let updated = 0;
    for (const row of rows) {
      const name = nameMap[row.slack_user_id];
      if (name) {
        const { error: updateErr } = await supabase
          .from("conversation_mappings")
          .update({ slack_user_name: name })
          .eq("id", row.id);
        if (!updateErr) updated++;
      }
    }

    return new Response(
      JSON.stringify({ message: "Backfill complete", resolved: Object.keys(nameMap).length, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("backfill-slack-user-names error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
