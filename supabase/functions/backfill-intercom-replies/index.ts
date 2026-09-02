import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const SKIP_PART_TYPES = new Set(["open", "close", "away_mode_assignment"]);
const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
const toIso = (ts: number) => new Date(ts * 1000).toISOString();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!INTERCOM_API_TOKEN) {
      return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "true";
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const syncMappings = url.searchParams.get("sync_mappings") === "true";
    const recent = url.searchParams.get("recent") === "true";

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Phase 1: Backfill manual_conversations messages ──
    let manualConvs: Array<{ id: string; intercom_conversation_id: string | null; status: string }> | null;
    let mcErr: unknown = null;
    if (recent) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await sb
        .from("manual_conversations")
        .select("id, intercom_conversation_id, status")
        .not("intercom_conversation_id", "is", null)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(Math.max(limit, 200));
      manualConvs = res.data;
      mcErr = res.error;
    } else {
      const res = await sb
        .from("manual_conversations")
        .select("id, intercom_conversation_id, status")
        .not("intercom_conversation_id", "is", null)
        .eq("source", "intercom")
        .order("created_at", { ascending: true })
        .range(offset, offset + limit - 1);
      manualConvs = res.data;
      mcErr = res.error;
    }

    if (mcErr) {
      console.error("Failed to fetch manual_conversations:", mcErr);
      return new Response(JSON.stringify({ error: "DB query failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: Array<{
      id: string;
      intercomId: string;
      newMessages: number;
      statusChange?: string;
      error?: string;
    }> = [];

    // Prefetch every conversation's existing messages in ONE query. This loop used
    // to issue a single-row lookup per conversation (up to 200 per invocation),
    // which dominated database CPU (1.49M calls / 22,251s total).
    const existingByConv = new Map<string, Set<string>>();
    const convIds = (manualConvs || []).map(c => c.id);
    for (let i = 0; i < convIds.length; i += 200) {
      const chunk = convIds.slice(i, i + 200);
      const { data: rows, error: exErr } = await sb
        .from("manual_messages")
        .select("conversation_id, created_at, is_internal_note")
        .in("conversation_id", chunk);
      if (exErr) console.error("Prefetch manual_messages failed:", exErr);
      for (const r of rows || []) {
        const key = `${Math.floor(new Date(r.created_at as string).getTime() / 1000)}:${r.is_internal_note ? 1 : 0}`;
        const set = existingByConv.get(r.conversation_id as string) || new Set<string>();
        set.add(key);
        existingByConv.set(r.conversation_id as string, set);
      }
    }

    for (const conv of manualConvs || []) {
      try {
        const icId = conv.intercom_conversation_id!;

        // Fetch Intercom conversation
        const icRes = await fetch(`https://api.intercom.io/conversations/${icId}`, {
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            Accept: "application/json",
            "Intercom-Version": "2.13",
          },
        });

        if (!icRes.ok) {
          const errText = await icRes.text();
          console.error(`Intercom API error for ${icId}:`, icRes.status, errText);
          results.push({ id: conv.id, intercomId: icId, newMessages: 0, error: `API ${icRes.status}` });
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        const icData = await icRes.json();

        // Extract all Intercom messages (source + paginated parts)
        const icMessages: Array<{ text: string; sender: string; role: string; created_at: string; epoch: number; is_internal_note: boolean }> = [];

        const src = icData.source;
        if (src?.body) {
          const text = stripHtml(src.body);
          if (text) {
            const ts = src.created_at || icData.created_at;
            icMessages.push({
              text,
              sender: src.author?.name || src.author?.email || src.author?.type || "Unknown",
              role: mapRole(src.author?.type || "user"),
              created_at: ts ? toIso(ts) : new Date().toISOString(),
              epoch: ts || 0,
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
              "Intercom-Version": "2.13",
            },
          });
          if (!pageRes.ok) break;
          const pageData = await pageRes.json();
          allParts = [...allParts, ...(pageData.conversation_parts || [])];
          nextPageUrl = pageData.pages?.next;
        }

        for (const part of allParts) {
          if (!part.body) continue;
          if (SKIP_PART_TYPES.has(part.part_type)) continue;
          if (part.author?.type === "bot") continue;
          const text = stripHtml(part.body);
          if (!text) continue;
          icMessages.push({
            text,
            sender: part.author?.name || part.author?.email || part.author?.type || "Unknown",
            role: mapRole(part.author?.type || "admin"),
            created_at: part.created_at ? toIso(part.created_at) : new Date().toISOString(),
            epoch: part.created_at || 0,
            is_internal_note: part.part_type === "note",
          });
        }

        // Fetch existing messages (key by epoch + is_internal_note so notes posted
        // at the same second as a comment don't dedup against each other)
        const existingKeys = existingByConv.get(conv.id) || new Set<string>();

        // Find missing messages
        const missing = icMessages.filter(m => !existingKeys.has(`${m.epoch}:${m.is_internal_note ? 1 : 0}`));

        if (!dry && missing.length > 0) {
          const toInsert = missing.map(m => ({
            conversation_id: conv.id,
            message_text: m.text,
            sender_name: m.sender,
            role: m.role,
            created_at: m.created_at,
            is_internal_note: m.is_internal_note,
          }));
          const { error: insertErr } = await sb.from("manual_messages").insert(toInsert);
          if (insertErr) console.error(`Insert error for ${conv.id}:`, insertErr);
          // Keep the prefetched map consistent for any later pass in this run.
          for (const m of missing) existingKeys.add(`${m.epoch}:${m.is_internal_note ? 1 : 0}`);
          existingByConv.set(conv.id, existingKeys);
        }

        // Determine correct status from Intercom state
        const icState = icData.state || "open";
        let newStatus: string | null = null;

        if (icState === "closed" && conv.status !== "resolved") {
          newStatus = "resolved";
        } else if (icState !== "closed" && conv.status === "resolved") {
          // Intercom is open but we marked resolved — reopen based on last reply
          const sorted = icMessages.sort((a, b) => a.epoch - b.epoch);
          const lastMsg = sorted[sorted.length - 1];
          newStatus = lastMsg?.role === "admin" ? "awaiting_customer" : "awaiting_support";
        }

        if (!dry && newStatus) {
          const update: Record<string, unknown> = { status: newStatus };
          if (newStatus === "resolved") update.resolved_at = new Date().toISOString();
          else update.resolved_at = null;
          await sb.from("manual_conversations").update(update).eq("id", conv.id);
        }

        results.push({
          id: conv.id,
          intercomId: icId,
          newMessages: missing.length,
          statusChange: newStatus ? `${conv.status} → ${newStatus}` : undefined,
        });

        console.log(`[${conv.id}] icId=${icId}: ${missing.length} new msgs, status=${newStatus || "unchanged"}`);
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`Error processing ${conv.id}:`, err);
        results.push({ id: conv.id, intercomId: conv.intercom_conversation_id!, newMessages: 0, error: String(err) });
      }
    }

    // ── Phase 2: Status sync for conversation_mappings ──
    const mappingStatusUpdates: Array<{ id: string; change: string }> = [];
    if (!dry && (syncMappings || recent)) {
      let mappingsQuery = sb
        .from("conversation_mappings")
        .select("id, intercom_conversation_id, status")
        .not("intercom_conversation_id", "is", null)
        .neq("intercom_conversation_id", "");
      if (recent) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        mappingsQuery = mappingsQuery.gte("updated_at", since).limit(200);
      }
      const { data: mappings } = await mappingsQuery;

      for (const m of mappings || []) {
        try {
          const icRes = await fetch(`https://api.intercom.io/conversations/${m.intercom_conversation_id}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
              "Intercom-Version": "2.13",
            },
          });
          if (!icRes.ok) { await icRes.text(); continue; }
          const icData = await icRes.json();
          const icState = icData.state || "open";

          if (icState === "closed" && m.status !== "resolved") {
            await sb.from("conversation_mappings").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", m.id);
            mappingStatusUpdates.push({ id: m.id, change: `${m.status} → resolved` });
          }
          await new Promise(r => setTimeout(r, 100));
        } catch { /* skip */ }
      }
    }

    // ── Phase 3: Status sync for gmail_conversations ──
    const gmailStatusUpdates: Array<{ id: string; change: string }> = [];
    if (!dry && (syncMappings || recent)) {
      let gmailQuery = sb
        .from("gmail_conversations")
        .select("id, intercom_conversation_id, status")
        .not("intercom_conversation_id", "is", null);
      if (recent) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        gmailQuery = gmailQuery.gte("received_at", since).limit(200);
      }
      const { data: gmails } = await gmailQuery;

      for (const g of gmails || []) {
        try {
          const icRes = await fetch(`https://api.intercom.io/conversations/${g.intercom_conversation_id}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
              "Intercom-Version": "2.13",
            },
          });
          if (!icRes.ok) { await icRes.text(); continue; }
          const icData = await icRes.json();
          const icState = icData.state || "open";

          if (icState === "closed" && g.status !== "resolved") {
            await sb.from("gmail_conversations").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", g.id);
            gmailStatusUpdates.push({ id: g.id, change: `${g.status} → resolved` });
          }
          await new Promise(r => setTimeout(r, 100));
        } catch { /* skip */ }
      }
    }

    const totalNew = results.reduce((s, r) => s + r.newMessages, 0);
    const totalStatusChanged = results.filter(r => r.statusChange).length;

    return new Response(JSON.stringify({
      dry,
      offset,
      limit,
      processed: results.length,
      totalNewMessages: totalNew,
      totalStatusChanged,
      mappingStatusUpdates: mappingStatusUpdates.length,
      gmailStatusUpdates: gmailStatusUpdates.length,
      hasMore: (manualConvs || []).length === limit,
      results,
      mappingStatusUpdates: mappingStatusUpdates,
      gmailStatusUpdates: gmailStatusUpdates,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
