import { requireUser } from "../_shared/require-user.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireUser(req, corsHeaders);
  if (!auth.ok) return auth.response;

  try {
    const intercomToken = Deno.env.get("INTERCOM_API_TOKEN");
    if (!intercomToken) {
      return new Response(
        JSON.stringify({ error: "Missing Intercom API token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, subject } = await req.json();
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
      "Intercom-Version": "2.13",
    };

    const allConversations = new Map<string, { id: string; title: string; created_at: string | null; state: string }>();

    // 1. Search by contact email
    const contactRes = await fetch("https://api.intercom.io/contacts/search", {
      method: "POST",
      headers: intercomHeaders,
      body: JSON.stringify({
        query: { field: "email", operator: "=", value: email },
      }),
    });
    const contactData = await contactRes.json();

    let contactId: string | null = null;
    if (contactData.data?.length) {
      contactId = contactData.data[0].id;

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

      for (const c of convsData.conversations || []) {
        const rawTitle = c.source?.subject || c.source?.body?.substring(0, 100) || `Conversation ${c.id}`;
        allConversations.set(c.id, {
          id: c.id,
          title: stripHtml(rawTitle),
          created_at: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
          state: c.state,
        });
      }
    }

    // 2. Search by subject if provided
    if (subject) {
      try {
        const subjectRes = await fetch("https://api.intercom.io/conversations/search", {
          method: "POST",
          headers: intercomHeaders,
          body: JSON.stringify({
            query: {
              field: "source.subject",
              operator: "~",
              value: subject,
            },
            pagination: { per_page: 10 },
            sort: { field: "updated_at", order: "desc" },
          }),
        });
        const subjectData = await subjectRes.json();

        for (const c of subjectData.conversations || []) {
          if (!allConversations.has(c.id)) {
            const rawTitle = c.source?.subject || c.source?.body?.substring(0, 100) || `Conversation ${c.id}`;
            allConversations.set(c.id, {
              id: c.id,
              title: stripHtml(rawTitle),
              created_at: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
              state: c.state,
            });
          }
        }
      } catch (err) {
        console.error("Subject search failed (non-fatal):", err);
      }
    }

    const conversations = Array.from(allConversations.values());

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
