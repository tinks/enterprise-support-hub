import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!INTERCOM_API_TOKEN) {
      return new Response(
        JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing url field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract conversation ID from URL
    const idMatch = url.match(/\/conversation\/(\d+)/);
    if (!idMatch) {
      return new Response(
        JSON.stringify({ error: "Could not extract conversation ID from URL. Expected format: .../conversation/123456" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const intercomConvId = idMatch[1];

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check duplicates across all tables
    const [dup1, dup2, dup3] = await Promise.all([
      sb.from("manual_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
      sb.from("conversation_mappings").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
      sb.from("gmail_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
    ]);

    const existingId = dup1.data?.id || dup2.data?.id || dup3.data?.id;
    const existingSource = dup1.data ? "manual" : dup2.data ? "slack" : dup3.data ? "gmail" : null;
    if (existingId) {
      return new Response(
        JSON.stringify({ error: "Already imported", existingId, existingSource }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch conversation from Intercom
    const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
      headers: {
        Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
        Accept: "application/json",
        "Intercom-Version": "2.11",
      },
    });

    if (!icRes.ok) {
      const errText = await icRes.text();
      console.error("Intercom API error:", icRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Intercom API error: ${icRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const icData = await icRes.json();

    // Extract contact name
    let contactName = "";
    const sourceContact = icData.source?.author;
    if (sourceContact) {
      contactName = sourceContact.name || sourceContact.email || "";
    }

    // Extract subject/title
    const subject = icData.source?.subject || icData.title || `Intercom #${intercomConvId}`;

    // Insert into manual_conversations
    const { data: inserted, error: insertErr } = await sb
      .from("manual_conversations")
      .insert({
        source: "intercom",
        contact_name: contactName,
        subject,
        link: url,
        intercom_conversation_id: intercomConvId,
        status: "active",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: "Failed to save conversation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: inserted.id, contactName, subject }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
