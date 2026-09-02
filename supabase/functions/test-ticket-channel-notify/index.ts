// One-shot test harness for the new-ticket Slack alert.
// ---------------------------------------------------------------------------
// Calls the REAL notifyNewTicket() with a synthetic conversation id so the
// message we see in Slack is byte-identical in shape to a production alert
// (same formatter, same mention lookup from settings.new_ticket_alert_mentions).
// Cleans up its own `new_ticket_alerts` claim row afterwards so the test id can
// be reused; no ticket rows are touched.
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyNewTicket } from "../_shared/new-ticket-alert.ts";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireEditor(req, corsHeaders);
  if (!auth.ok) return auth.response;



  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const convId = `test-${Date.now()}`;
  const result = await notifyNewTicket(supabase, {
    convId,
    subject: "TEST — please ignore (new-ticket alert format check)",
    contactName: "Jane Example",
    contactEmail: "jane@example.com",
    owner: "Matt",
    createdIso: new Date().toISOString(),
  });

  // Drop the synthetic claim row so the test leaves no trace.
  await supabase.from("new_ticket_alerts").delete().eq("intercom_conversation_id", convId);

  return new Response(JSON.stringify({ result, convId }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
