import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const GOOGLE_MAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!GOOGLE_MAIL_API_KEY) {
    return new Response(JSON.stringify({ error: "GOOGLE_MAIL_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const gatewayHeaders = {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
  };

  try {
    // List messages from the last day
    const listRes = await fetch(
      `${GATEWAY_URL}/users/me/messages?maxResults=100&q=newer_than:1d`,
      { headers: gatewayHeaders }
    );
    if (!listRes.ok) {
      const body = await listRes.text();
      throw new Error(`Gmail list failed [${listRes.status}]: ${body}`);
    }

    const listData = await listRes.json();
    const messageIds: string[] = (listData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      console.log("No new messages found");
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;

    for (const msgId of messageIds) {
      // Fetch metadata for each message
      const msgRes = await fetch(
        `${GATEWAY_URL}/users/me/messages/${msgId}?format=metadata`,
        { headers: gatewayHeaders }
      );
      if (!msgRes.ok) {
        console.error(`Failed to fetch message ${msgId}: ${msgRes.status}`);
        continue;
      }

      const msg = await msgRes.json();
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || null;

      const fromRaw = getHeader("From") || "";
      // Parse "Name <email>" format
      const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
      const fromName = fromMatch ? fromMatch[1].replace(/^"|"$/g, "").trim() : fromRaw;
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw;

      const subject = getHeader("Subject") || "(no subject)";
      const dateStr = getHeader("Date");
      const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date(Number(msg.internalDate)).toISOString();

      const { error } = await supabase.from("gmail_conversations").insert({
        gmail_message_id: msgId,
        gmail_thread_id: msg.threadId || null,
        from_email: fromEmail,
        from_name: fromName,
        subject,
        received_at: receivedAt,
        snippet: msg.snippet || null,
      });

      if (error) {
        // Unique constraint violation = already exists, skip
        if (error.code === "23505") continue;
        console.error(`Insert error for ${msgId}:`, error.message);
        continue;
      }
      inserted++;
    }

    // Update high-water mark
    await supabase
      .from("settings")
      .update({ gmail_last_polled_at: new Date().toISOString() })
      .not("id", "is", null);

    console.log(`Processed ${messageIds.length} messages, inserted ${inserted} new`);

    return new Response(
      JSON.stringify({ ok: true, processed: messageIds.length, inserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("poll-gmail error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
