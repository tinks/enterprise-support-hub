import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
    if (!intercomToken) {
      return new Response(
        JSON.stringify({ error: "Missing Intercom API token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email } = await req.json();
    if (!email) {
      return new Response(
        JSON.stringify({ error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const intercomHeaders = {
      Authorization: `Bearer ${intercomToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Intercom-Version": "2.11",
    };

    // Search for contact by email
    const contactRes = await fetch("https://api.intercom.io/contacts/search", {
      method: "POST",
      headers: intercomHeaders,
      body: JSON.stringify({
        query: { field: "email", operator: "=", value: email },
      }),
    });
    const contactData = await contactRes.json();

    if (!contactData.data?.length) {
      return new Response(
        JSON.stringify({ conversations: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contactId = contactData.data[0].id;

    // Search conversations for this contact
    const convsRes = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: intercomHeaders,
      body: JSON.stringify({
        query: {
          field: "contact_ids",
          operator: "=",
          value: contactId,
        },
        pagination: { per_page: 10 },
        sort: { field: "updated_at", order: "desc" },
      }),
    });
    const convsData = await convsRes.json();

    const conversations = (convsData.conversations || []).map((c: any) => ({
      id: c.id,
      title: c.source?.subject || c.source?.body?.substring(0, 100) || `Conversation ${c.id}`,
      created_at: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
      state: c.state,
    }));

    return new Response(
      JSON.stringify({ conversations, contactId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("search-intercom-by-email error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
