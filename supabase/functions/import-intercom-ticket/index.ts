import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    const { url, force } = await req.json();
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

    const existingManualId = dup1.data?.id;
    const existingOtherId = dup2.data?.id || dup3.data?.id;
    const existingOtherSource = dup2.data ? "slack" : dup3.data ? "gmail" : null;

    // If duplicate exists in non-manual tables, always block
    if (existingOtherId) {
      return new Response(
        JSON.stringify({ error: "Already imported", existingId: existingOtherId, existingSource: existingOtherSource, intercomConversationId: intercomConvId }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If duplicate exists in manual_conversations
    if (existingManualId) {
      if (force) {
        // Delete existing and re-import
        await sb.from("manual_messages").delete().eq("conversation_id", existingManualId);
        await sb.from("manual_conversations").delete().eq("id", existingManualId);
      } else {
        return new Response(
          JSON.stringify({ error: "Already imported", existingId: existingManualId, existingSource: "manual", intercomConversationId: intercomConvId }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

    const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);

    // --- Extract messages FIRST to compute earliest timestamp ---
    const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
    const toIso = (ts: number) => new Date(ts * 1000).toISOString();
    const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);

    const preMessages: Array<{ message_text: string; sender_name: string; role: string; created_at: string; is_internal_note: boolean }> = [];

    const src = icData.source;
    if (src?.body) {
      const text = stripHtml(src.body);
      if (text) {
        preMessages.push({
          message_text: text,
          sender_name: src.author?.name || src.author?.email || src.author?.type || "Unknown",
          role: mapRole(src.author?.type || "user"),
          created_at: src.created_at ? toIso(src.created_at) : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString()),
          is_internal_note: false,
        });
      }
    }

    let allParts = icData.conversation_parts?.conversation_parts || [];
    let nextPageUrl = icData.conversation_parts?.pages?.next;

    while (nextPageUrl) {
      const pageRes = await fetch(nextPageUrl, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.11",
        },
      });
      if (!pageRes.ok) {
        console.error("Pagination fetch failed:", pageRes.status);
        break;
      }
      const pageData = await pageRes.json();
      allParts = [...allParts, ...(pageData.conversation_parts || [])];
      nextPageUrl = pageData.pages?.next;
    }

    for (const part of allParts) {
      console.log(`Part: type=${part.part_type}, author.type=${part.author?.type}, author.name=${part.author?.name}, hasBody=${!!part.body}`);
      if (!part.body) continue;
      if (SKIP_PART_TYPES.has(part.part_type)) continue;
      if (part.author?.type === "bot") continue;
      const text = stripHtml(part.body);
      if (!text) continue;
      preMessages.push({
        message_text: text,
        sender_name: part.author?.name || part.author?.email || part.author?.type || "Unknown",
        role: mapRole(part.author?.type || "admin"),
        created_at: part.created_at ? toIso(part.created_at) : new Date().toISOString(),
        is_internal_note: part.part_type === "note",
      });
    }

    preMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const conversationCreatedAt = preMessages.length > 0
      ? preMessages[0].created_at
      : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString());

    // Insert conversation with correct created_at
    const { data: inserted, error: insertErr } = await sb
      .from("manual_conversations")
      .insert({
        source: "intercom",
        contact_name: contactName,
        subject,
        link: url,
        intercom_conversation_id: intercomConvId,
        status: "active",
        created_at: conversationCreatedAt,
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

    // Add conversation_id and insert messages
    const messages = preMessages.map(m => ({ ...m, conversation_id: inserted.id }));

    if (messages.length > 0) {
      const { error: msgErr } = await sb.from("manual_messages").insert(messages);
      if (msgErr) console.error("Failed to insert messages:", msgErr);
    }

    return new Response(
      JSON.stringify({ success: true, id: inserted.id, contactName, subject, messagesImported: messages.length }),
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
