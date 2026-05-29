import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface InMessage {
  role?: "user" | "admin";
  sender_name?: string;
  message_text?: string;
  created_at?: string;
  is_internal_note?: boolean;
}

interface InConversation {
  subject: string;
  contact_name: string;
  messages?: InMessage[];
  source?: string;
  link?: string | null;
  status?: string;
  created_at?: string;
  owner?: string | null;
  is_bug?: boolean;
  is_feature_request?: boolean;
  product_area?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user auth
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    const list: InConversation[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.conversations)
        ? body.conversations
        : [];

    if (!list.length) {
      return new Response(
        JSON.stringify({ error: "Body must be an array (or { conversations: [...] })" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ index: number; subject?: string; error: string }> = [];

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      try {
        if (!c?.subject || !c?.contact_name) {
          failed++;
          errors.push({ index: i, subject: c?.subject, error: "subject and contact_name are required" });
          continue;
        }

        const createdAt = c.created_at
          ? new Date(c.created_at).toISOString()
          : c.messages?.length
            ? new Date(
                Math.min(
                  ...c.messages
                    .map((m) => (m.created_at ? new Date(m.created_at).getTime() : NaN))
                    .filter((n) => !isNaN(n)),
                ) || Date.now(),
              ).toISOString()
            : new Date().toISOString();

        // Duplicate check
        let dupQuery = admin.from("manual_conversations").select("id").limit(1);
        if (c.link) {
          dupQuery = dupQuery.eq("link", c.link);
        } else {
          dupQuery = dupQuery
            .eq("subject", c.subject)
            .eq("contact_name", c.contact_name)
            .eq("created_at", createdAt);
        }
        const { data: dup } = await dupQuery;
        if (dup && dup.length) {
          skipped++;
          continue;
        }

        const { data: inserted, error: insErr } = await admin
          .from("manual_conversations")
          .insert({
            source: c.source || "slack",
            contact_name: c.contact_name,
            subject: c.subject,
            link: c.link || null,
            status: c.status || "active",
            owner: c.owner || null,
            is_bug: !!c.is_bug,
            is_feature_request: !!c.is_feature_request,
            product_area: c.product_area || null,
            created_at: createdAt,
            resolved_at: c.status === "resolved" ? createdAt : null,
          })
          .select("id")
          .single();

        if (insErr || !inserted) throw new Error(insErr?.message || "Insert failed");

        const msgs = (c.messages || []).map((m) => ({
          conversation_id: inserted.id,
          role: m.role === "admin" ? "admin" : "user",
          sender_name: m.sender_name || "",
          message_text: m.message_text || "",
          is_internal_note: !!m.is_internal_note,
          created_at: m.created_at ? new Date(m.created_at).toISOString() : createdAt,
        }));

        if (msgs.length) {
          const { error: msgErr } = await admin.from("manual_messages").insert(msgs);
          if (msgErr) throw new Error(`Messages insert failed: ${msgErr.message}`);
        }

        imported++;
      } catch (e) {
        failed++;
        errors.push({ index: i, subject: c?.subject, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({ imported, skipped, failed, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
