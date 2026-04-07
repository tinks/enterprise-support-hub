import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature",
};

const SLACK_API_URL = "https://slack.com/api";
const ASSIGNMENT_TOPICS = [
  "conversation.admin.assigned",
  "conversation.admin.open.assigned",
  "ticket.admin.assigned",
  "ticket.team.assigned",
];
const BOT_IDENTITY = {
  username: "Ask Lovable",
  icon_url: "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
};

async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
  try {
    console.log(`Adding reaction ${emoji} to channel=${channel} ts=${timestamp}`);
    const res = await fetch(`${SLACK_API_URL}/reactions.add`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Slack reactions.add failed for ${emoji}:`, data.error);
    }
  } catch (e) {
    console.error(`Failed to add reaction ${emoji}:`, e);
  }
}

async function removeReaction(token: string, channel: string, timestamp: string, emoji: string) {
  try {
    const res = await fetch(`${SLACK_API_URL}/reactions.remove`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok && data.error !== "no_reaction") {
      console.error(`Slack reactions.remove failed for ${emoji}:`, data.error);
    }
  } catch (e) {
    console.error(`Failed to remove reaction ${emoji}:`, e);
  }
}

async function verifyIntercomSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const expected = signature.replace("sha1=", "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = new TextDecoder().decode(hexEncode(new Uint8Array(sig)));
  return computed === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const INTERCOM_WEBHOOK_SECRET = Deno.env.get("INTERCOM_WEBHOOK_SECRET");
  if (!INTERCOM_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "INTERCOM_WEBHOOK_SECRET not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const hubSignature = req.headers.get("x-hub-signature");

  const isValid = await verifyIntercomSignature(rawBody, hubSignature, INTERCOM_WEBHOOK_SECRET);
  if (!isValid) {
    console.error("Invalid Intercom webhook signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch settings for testing_mode
  const { data: appSettings } = await supabase.from("settings").select("*").limit(1).single();
  const testingMode = appSettings?.testing_mode === true;

  try {
    // Identity guard: verify token matches expected bot before posting to Slack
    const expectedBotId = appSettings?.slack_bot_user_id;
    if (expectedBotId) {
      const authCheck = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      });
      const authCheckData = await authCheck.json();
      if (!authCheckData.ok || authCheckData.user_id !== expectedBotId) {
        console.error(`IDENTITY GUARD: Token belongs to ${authCheckData.user_id || "unknown"}, expected ${expectedBotId}. Blocking.`);
        return new Response(JSON.stringify({ error: "Bot identity mismatch — refusing to post to Slack" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = JSON.parse(rawBody);
    console.log("Intercom webhook received:", JSON.stringify(body).substring(0, 500));

    const topic = body.topic;
    const itemId = body.data?.item?.id || body.data?.item?.ticket?.id;
    console.log(`Intercom webhook topic: ${topic}, conversation_id: ${itemId}`);

    const REPLY_TOPICS = ["conversation.admin.replied", "conversation.admin.single.reply", "ticket.admin.replied"];
    const CLOSED_TOPICS = ["conversation.admin.closed", "ticket.state.updated"];

    if (!REPLY_TOPICS.includes(topic) && !CLOSED_TOPICS.includes(topic) && !ASSIGNMENT_TOPICS.includes(topic)) {
      console.log(`Ignoring topic: ${topic}`);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Handle assignment topics: auto-import to manual_conversations ---
    if (ASSIGNMENT_TOPICS.includes(topic)) {
      const assignedTeamId = String(body.data?.item?.team_assignee_id || body.data?.item?.admin_assignee_id || "");
      const enterpriseInboxId = appSettings?.intercom_inbox_id;
      const intercomConvId = String(body.data?.item?.id || body.data?.item?.ticket?.id || "");

      console.log(`Assignment event: team=${assignedTeamId}, enterpriseInbox=${enterpriseInboxId}, convId=${intercomConvId}`);

      if (!enterpriseInboxId || assignedTeamId !== enterpriseInboxId) {
        console.log(`Assignment not to enterprise inbox (${assignedTeamId} vs ${enterpriseInboxId}), ignoring`);
        return new Response(JSON.stringify({ ok: true, message: "Not enterprise inbox" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!intercomConvId) {
        console.log("No conversation ID in assignment payload");
        return new Response(JSON.stringify({ ok: true, message: "No conv ID" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if already tracked in any table
      const [dup1, dup2, dup3] = await Promise.all([
        supabase.from("conversation_mappings").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("gmail_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
        supabase.from("manual_conversations").select("id").eq("intercom_conversation_id", intercomConvId).maybeSingle(),
      ]);

      if (dup1.data || dup2.data || dup3.data) {
        const existingId = dup1.data?.id || dup2.data?.id || dup3.data?.id;
        console.log(`Intercom ${intercomConvId} already tracked (${existingId}), skipping auto-import`);
        return new Response(JSON.stringify({ ok: true, message: "Already tracked", existingId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch full conversation from Intercom API
      if (!INTERCOM_API_TOKEN) {
        console.error("INTERCOM_API_TOKEN not configured, cannot auto-import");
        return new Response(JSON.stringify({ ok: true, message: "No API token" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const icRes = await fetch(`https://api.intercom.io/conversations/${intercomConvId}`, {
        headers: {
          Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
          Accept: "application/json",
          "Intercom-Version": "2.11",
        },
      });

      if (!icRes.ok) {
        console.error("Intercom API error during auto-import:", icRes.status, await icRes.text());
        return new Response(JSON.stringify({ ok: true, message: "Intercom API error" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const icData = await icRes.json();

      // Extract contact name
      let contactName = "";
      const sourceContact = icData.source?.author;
      if (sourceContact) {
        contactName = sourceContact.name || sourceContact.email || "";
      }

      // Strip HTML helper
      const strip = (html: string): string =>
        html
          .replace(/<[^>]*>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ")
          .trim();

      const subject = strip(icData.source?.subject || icData.title || `Intercom #${intercomConvId}`);
      const convUrl = `https://app.intercom.com/a/inbox/wq44gprj/inbox/conversation/${intercomConvId}`;

      // Insert conversation
      const { data: inserted, error: insertErr } = await supabase
        .from("manual_conversations")
        .insert({
          source: "intercom",
          contact_name: contactName,
          subject,
          link: convUrl,
          intercom_conversation_id: intercomConvId,
          status: "active",
        })
        .select("id")
        .single();

      if (insertErr) {
        console.error("Auto-import insert error:", insertErr);
        return new Response(JSON.stringify({ ok: true, message: "Insert failed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract messages
      const mapRole = (type: string) => (type === "user" || type === "lead") ? "user" : "admin";
      const toIso = (ts: number) => new Date(ts * 1000).toISOString();
      const SKIP_PART_TYPES = new Set(["assignment", "open", "close", "away_mode_assignment"]);

      const messages: Array<{ conversation_id: string; message_text: string; sender_name: string; role: string; created_at: string }> = [];

      // Source message
      const src = icData.source;
      if (src?.body) {
        const text = strip(src.body);
        if (text) {
          messages.push({
            conversation_id: inserted.id,
            message_text: text,
            sender_name: src.author?.name || src.author?.email || src.author?.type || "Unknown",
            role: mapRole(src.author?.type || "user"),
            created_at: src.created_at ? toIso(src.created_at) : (icData.created_at ? toIso(icData.created_at) : new Date().toISOString()),
          });
        }
      }

      // Paginate conversation parts
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
        if (!pageRes.ok) break;
        const pageData = await pageRes.json();
        allParts = [...allParts, ...(pageData.conversation_parts || [])];
        nextPageUrl = pageData.pages?.next;
      }

      for (const part of allParts) {
        if (!part.body) continue;
        if (SKIP_PART_TYPES.has(part.part_type)) continue;
        if (part.author?.type === "bot") continue;
        const text = strip(part.body);
        if (!text) continue;
        messages.push({
          conversation_id: inserted.id,
          message_text: text,
          sender_name: part.author?.name || part.author?.email || part.author?.type || "Unknown",
          role: mapRole(part.author?.type || "admin"),
          created_at: part.created_at ? toIso(part.created_at) : new Date().toISOString(),
        });
      }

      messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (messages.length > 0) {
        const { error: msgErr } = await supabase.from("manual_messages").insert(messages);
        if (msgErr) console.error("Auto-import messages insert error:", msgErr);
      }

      console.log(`Auto-imported Intercom ${intercomConvId} as ${inserted.id} with ${messages.length} messages`);
      return new Response(JSON.stringify({ ok: true, id: inserted.id, messagesImported: messages.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For ticket.state.updated, only process resolved/closed states
    if (topic === "ticket.state.updated") {
      const ticketState = body.data?.item?.ticket_state;
      const stateCategory = typeof ticketState === "object" ? ticketState?.category : ticketState;
      if (stateCategory !== "resolved" && stateCategory !== "closed") {
        console.log(`Ignoring ticket.state.updated with state: ${stateCategory}`);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Ticket events may use different payload shapes for the conversation ID
    // For ticket topics, prefer item.ticket.id (item.id may be a part ID)
    const conversationId = (topic.startsWith("ticket.")
      ? (body.data?.item?.ticket?.id || body.data?.item?.id)
      : (body.data?.item?.id || body.data?.item?.ticket?.id))
      || body.data?.item?.ticket_id
      || body.data?.item?.conversation_id;
    if (!conversationId) {
      console.error("No conversation ID found in webhook payload");
      return new Response(JSON.stringify({ error: "No conversation ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { data: mapping } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("intercom_conversation_id", String(conversationId))
      .maybeSingle();

    // Fallback: try alternative IDs from payload if initial lookup fails
    if (!mapping) {
      const altIds = [
        body.data?.item?.ticket?.id,
        body.data?.item?.id,
        body.data?.item?.ticket_id,
        body.data?.item?.conversation_id,
      ].filter(Boolean).map(String).filter(id => id !== String(conversationId));

      for (const altId of altIds) {
        const { data: altMapping } = await supabase
          .from("conversation_mappings")
          .select("*")
          .eq("intercom_conversation_id", altId)
          .maybeSingle();
        if (altMapping) {
          mapping = altMapping;
          console.log(`Found mapping via alt ID ${altId} (original conversationId: ${conversationId})`);
          break;
        }
      }
    }

    if (!mapping) {
      console.log(`No mapping found for Intercom conversation ${conversationId}. Payload IDs: item.id=${body.data?.item?.id}, ticket.id=${body.data?.item?.ticket?.id}, ticket_id=${body.data?.item?.ticket_id}, type=${body.data?.item?.type}`);
      return new Response(JSON.stringify({ ok: true, message: "No mapping found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle conversation closed/resolved in Intercom
    if (CLOSED_TOPICS.includes(topic)) {
      if (mapping.status !== "resolved") {
        // Remove feedback buttons from previous bot messages in the thread
        try {
          const repliesRes = await fetch(
            `${SLACK_API_URL}/conversations.replies?channel=${mapping.slack_channel_id}&ts=${mapping.slack_thread_ts}&limit=100`,
            { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
          );
          const repliesData = await repliesRes.json();
          if (repliesData.ok && repliesData.messages) {
            for (const msg of repliesData.messages) {
              // Find messages with action blocks (feedback buttons)
              const hasActions = msg.blocks?.some((b: { type: string }) => b.type === "actions");
              if (hasActions && msg.ts) {
                const blocksWithoutActions = msg.blocks.filter((b: { type: string }) => b.type !== "actions");
                await fetch(`${SLACK_API_URL}/chat.update`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    channel: mapping.slack_channel_id,
                    ts: msg.ts,
                    text: msg.text || "",
                    blocks: blocksWithoutActions,
                  }),
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to remove feedback buttons:", e);
        }

        // Load bot messages for closed text
        const { data: closedMsgRows } = await supabase.from("bot_messages").select("message_key, message_text").eq("message_key", "conversation_closed").maybeSingle();
        const closedText = closedMsgRows?.message_text || "This issue has been marked as resolved. If you need any further assistance, please feel free to start a new Slack thread. Continuing the conversation here will not notify our Support Team.";

        const closeRes = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: mapping.slack_channel_id,
            thread_ts: mapping.slack_thread_ts,
            text: closedText,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: closedText } }],
            ...BOT_IDENTITY,
          }),
        });
        const closeData = await closeRes.json();
        if (!closeRes.ok || !closeData.ok) {
          console.error(`Failed to post close message: ${JSON.stringify(closeData)}`);
        }

        await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "eyes");
        await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "hourglass_flowing_sand");
        await addReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "white_check_mark");

        await supabase
          .from("conversation_mappings")
          .update({ status: "resolved", resolved_at: new Date().toISOString() })
          .eq("id", mapping.id);

        console.log(`Marked conversation ${conversationId} as resolved and notified Slack`);
      } else {
        console.log(`Conversation ${conversationId} already resolved, skipping`);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if conversation is already resolved — UNLESS no reply was ever posted
    // (e.g. Sam merged/closed before the reply webhook arrived)
    if (mapping.status === "resolved" && mapping.last_intercom_part_id !== null) {
      console.log(`Ignoring reply for ${conversationId} — status is already resolved and a reply was previously posted`);
      return new Response(JSON.stringify({ ok: true, message: "Already closed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (mapping.status === "resolved" && mapping.last_intercom_part_id === null) {
      console.log(`Processing reply for resolved conversation ${conversationId} — no reply was ever posted`);
    }

    let conversationParts = body.data?.item?.conversation_parts?.conversation_parts;

    // Always prefer fresh conversation parts from Intercom API for reply topics.
    // Webhook payloads can be partial/stale, which can make us pick an older comment
    // and incorrectly skip customer-facing replies.
    if (INTERCOM_API_TOKEN) {
      try {
        const convoRes = await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            Accept: "application/json",
            "Intercom-Version": "2.11",
          },
        });

        if (convoRes.ok) {
          const convoData = await convoRes.json();
          const apiParts = convoData?.conversation_parts?.conversation_parts;
          if (Array.isArray(apiParts) && apiParts.length > 0) {
            conversationParts = apiParts;
            console.log(`Loaded ${apiParts.length} conversation parts from Intercom API for ${conversationId}`);
          }
        } else {
          console.warn(`Failed to fetch conversation ${conversationId} from Intercom API: ${await convoRes.text()}`);
        }

        // Fallback: try tickets endpoint if conversation endpoint returned no parts
        if (!conversationParts || conversationParts.length === 0) {
          try {
            const ticketRes = await fetch(`https://api.intercom.io/tickets/${conversationId}`, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                Accept: "application/json",
                "Intercom-Version": "2.11",
              },
            });
            if (ticketRes.ok) {
              const ticketData = await ticketRes.json();
              const ticketParts = ticketData?.conversation_parts?.conversation_parts;
              if (Array.isArray(ticketParts) && ticketParts.length > 0) {
                conversationParts = ticketParts;
                console.log(`Loaded ${ticketParts.length} parts from tickets API for ${conversationId}`);
              }
            }
          } catch (te) {
            console.warn(`Tickets API fallback failed for ${conversationId}:`, te);
          }
        }
      } catch (e) {
        console.warn(`Error fetching conversation ${conversationId} from Intercom API:`, e);
      }
    }

    // Find the last public-facing comment part — skip notes, assignments, and system parts
    // IMPORTANT: We must identify the comment BEFORE setting the dedup marker,
    // otherwise non-comment parts can "consume" the dedup slot and prevent
    // the actual comment from ever being processed.
    let lastCommentPart: Record<string, unknown> | null = null;
    if (conversationParts && conversationParts.length > 0) {
      for (let i = conversationParts.length - 1; i >= 0; i--) {
        if (conversationParts[i].part_type === "comment" && conversationParts[i].body) {
          lastCommentPart = conversationParts[i];
          break;
        }
      }
    }

    if (!lastCommentPart) {
      console.log(`No comment part found in webhook payload for conversation ${conversationId}, skipping`);
      return new Response(JSON.stringify({ ok: true, message: "No comment part" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deduplication: atomic claim via Postgres row-level lock
    const partId = lastCommentPart.id ? String(lastCommentPart.id) : null;
    if (partId) {
      const { data: claimed, error: claimError } = await supabase
        .rpc("claim_intercom_part", {
          p_mapping_id: mapping.id,
          p_part_id: partId,
        });

      if (claimError) {
        console.error(`Dedup claim RPC failed for mapping ${mapping.id}, part ${partId}:`, claimError);
        // Default: proceed to avoid dropping messages
      }

      if (!claimError && claimed === false) {
        console.log(`Duplicate part ${partId} for mapping ${mapping.id}, skipping`);
        return new Response(JSON.stringify({ ok: true, message: "Duplicate skipped" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let replyText = "";
    let adminName = "";
    let isHumanAdmin = false;

    // Attachments from the comment part
    let attachments: Array<{ url: string; name: string; content_type: string }> = [];

    {
      const rawBody = (lastCommentPart.body as string) || "";

      // Extract inline <img> URLs before stripping HTML
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = imgRegex.exec(rawBody)) !== null) {
        const imgUrl = imgMatch[1];
        if (imgUrl && !imgUrl.startsWith("data:")) {
          attachments.push({ url: imgUrl, name: "inline-image", content_type: "image/png" });
        }
      }

      replyText = rawBody
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<li[^>]*>/gi, "• ")
        .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const author = lastCommentPart.author as { type?: string; name?: string; id?: string } | undefined;
      const normalizedAuthorName = String(author?.name || "").trim().toLowerCase();
      const isKnownAiAgent = normalizedAuthorName === "sam" || normalizedAuthorName.includes("ask lovable");

      // Keep human behavior intact, but force Sam/Ask Lovable to stay on default bot identity
      if (author && author.type === "admin" && author.name && !isKnownAiAgent) {
        adminName = author.name;
        isHumanAdmin = true;
      }

      // Extract explicit attachments from the conversation part
      const partAttachments = lastCommentPart.attachments;
      if (partAttachments && Array.isArray(partAttachments)) {
        const explicit = partAttachments
          .filter((a: { url?: string }) => a.url)
          .map((a: { url: string; name?: string; content_type?: string }) => ({
            url: a.url,
            name: a.name || "attachment",
            content_type: a.content_type || "application/octet-stream",
          }));
        // Deduplicate against inline images already extracted
        const existingUrls = new Set(attachments.map((a) => a.url));
        for (const att of explicit) {
          if (!existingUrls.has(att.url)) {
            attachments.push(att);
          }
        }
      }
      if (attachments.length > 0) {
        console.log(`Found ${attachments.length} attachment(s) in Intercom reply`);
      }
    }

    // Skip replies that originated from Slack (they already appear in the thread)
    const slackOriginPattern = /\[From:.*via Slack\]/i;
    if (slackOriginPattern.test(replyText) || slackOriginPattern.test((lastCommentPart.body as string) || "")) {
      console.log(`Skipping Slack-originated reply for conversation ${conversationId} (already in thread)`);
      return new Response(JSON.stringify({ ok: true, message: "Slack-originated reply skipped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!replyText && attachments.length === 0) {
      console.log("No reply text or attachments found");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect incident.io action — check if the reply body references incident.io or the status page
    const STATUS_PAGE_URL = "https://status.lovable.dev";
    const incidentIoPattern = /incident\.io|status\.lovable\.dev|we have an incident|status page/i;
    const hasIncidentIoAction = incidentIoPattern.test(replyText) || incidentIoPattern.test((lastCommentPart.body as string) || "");

    let incidentStatusBlock: Record<string, unknown>[] = [];
    if (hasIncidentIoAction) {
      try {
        const statusRes = await fetch(`${STATUS_PAGE_URL}/api/v2/summary.json`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const overallStatus = statusData.status?.description || "Unknown";
          const indicator = statusData.status?.indicator || "none";
          const emoji = indicator === "none" ? "✅" : indicator === "minor" ? "⚠️" : indicator === "major" ? "🔴" : indicator === "critical" ? "🚨" : "ℹ️";

          // Build component statuses
          const componentLines = (statusData.components || [])
            .map((c: { name: string; status: string }) => {
              const cEmoji = c.status === "operational" ? "✅" : c.status === "degraded_performance" ? "⚠️" : c.status === "partial_outage" ? "🟡" : c.status === "major_outage" ? "🔴" : "❓";
              return `${cEmoji} *${c.name}*: ${c.status.replace(/_/g, " ")}`;
            })
            .join("\n");

          incidentStatusBlock = [
            { type: "divider" },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${emoji} *Lovable Status: ${overallStatus}*`,
              },
            },
            ...(componentLines ? [{
              type: "section",
              text: { type: "mrkdwn", text: componentLines },
            }] : []),
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
                  action_id: "feedback_positive",
                  value: String(conversationId),
                },
                ...(mapping.status !== "escalated" && mapping.status !== "escalated_pending" ? [{
                  type: "button",
                  text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
                  action_id: "feedback_negative",
                  value: String(conversationId),
                }] : []),
                {
                  type: "button",
                  text: { type: "plain_text", text: "📡 Subscribe to status updates", emoji: true },
                  url: STATUS_PAGE_URL,
                  action_id: "incident_io_subscribe",
                },
              ],
            },
          ];

          console.log(`incident.io action detected — status: ${overallStatus}`);
        } else {
          console.error(`Failed to fetch status page: ${statusRes.status}`);
        }
      } catch (e) {
        console.error("Failed to fetch incident.io status:", e);
      }
    }

    // Replace incident.io app references with the actual status page URL
    replyText = replyText
      .replace(/\[App:\s*incident\.io\]/gi, "https://status.lovable.dev/")
      .replace(/\(App:\s*incident\.io\)/gi, "https://status.lovable.dev/");

    // Strip sign-off lines and AI attribution (handle various Intercom AI footers)
    replyText = replyText
      .replace(/\n*This message was.*$/is, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\n+\w+\s*$/i, "")
      .replace(/\n*(Best|Regards|Thanks|Cheers|Kind regards|Warm regards|All the best),?\s*$/i, "")
      .trim();


    // Split long text into chunks to avoid Slack's "See more" collapse.
    // Slack truncates at ~3000 chars OR ~40 lines — use whichever limit is hit first.
    const MAX_CHUNK_CHARS = 2500;
    const MAX_CHUNK_LINES = 35;
    const chunks: string[] = [];
    function needsSplit(text: string) {
      return text.length > MAX_CHUNK_CHARS || text.split("\n").length > MAX_CHUNK_LINES;
    }

    if (!needsSplit(replyText)) {
      chunks.push(replyText);
    } else {
      let remaining = replyText;
      while (needsSplit(remaining)) {
        let splitIdx = remaining.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
        if (splitIdx <= 0) splitIdx = remaining.lastIndexOf("\n", MAX_CHUNK_CHARS);
        if (splitIdx <= 0) splitIdx = MAX_CHUNK_CHARS;

        const lines = remaining.substring(0, splitIdx).split("\n");
        if (lines.length > MAX_CHUNK_LINES) {
          splitIdx = lines.slice(0, MAX_CHUNK_LINES).join("\n").length;
        }

        chunks.push(remaining.substring(0, splitIdx).trim());
        remaining = remaining.substring(splitIdx).trim();
      }
      if (remaining) chunks.push(remaining);
    }

    // Helper to post a single Slack message
    async function postSlackMessage(payload: Record<string, unknown>) {
      const res = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(`Slack API call failed [${res.status}]: ${JSON.stringify(data)}`);
      }
      return data;
    }

    const basePayload: Record<string, unknown> = {
      channel: mapping.slack_channel_id,
      thread_ts: mapping.slack_thread_ts,
      ...BOT_IDENTITY,
    };

    // For human admin replies, fetch their avatar and override Slack identity
    if (isHumanAdmin && adminName && INTERCOM_API_TOKEN) {
      const adminAuthor = lastCommentPart.author as { id?: string } | undefined;
      const adminId = adminAuthor?.id;
      let avatarUrl = "";

      // 1) Try Intercom admin avatar
      if (adminId) {
        try {
          const adminRes = await fetch(`https://api.intercom.io/admins/${adminId}`, {
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              Accept: "application/json",
            },
          });
          if (adminRes.ok) {
            const adminData = await adminRes.json();
            console.log(`Intercom admin data for ${adminName}: avatar=${adminData.avatar?.image_url || "none"}, email=${adminData.email || "none"}`);
            if (adminData.avatar?.image_url) {
              avatarUrl = adminData.avatar.image_url;
            }

            // 2) Fallback: look up Slack profile picture by admin email
            if (!avatarUrl && adminData.email) {
              try {
                const slackLookup = await fetch(
                  `${SLACK_API_URL}/users.lookupByEmail?email=${encodeURIComponent(adminData.email)}`,
                  { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
                );
                const slackData = await slackLookup.json();
                if (slackData.ok && slackData.user?.profile) {
                  avatarUrl = slackData.user.profile.image_192 || slackData.user.profile.image_72 || "";
                  console.log(`Using Slack avatar for ${adminName}: ${avatarUrl}`);
                }
              } catch (e) {
                console.error("Slack email lookup failed:", e);
              }
            }
          } else {
            console.error(`Intercom admin fetch failed: ${adminRes.status}`);
          }
        } catch (e) {
          console.error("Failed to fetch admin avatar:", e);
        }
      }

      if (avatarUrl) {
        basePayload.icon_url = avatarUrl;
      }
      basePayload.username = adminName;
    }

    // Debug message is already posted by slack-interactions when the ticket is created

    // Remove feedback buttons from previous bot messages before posting new reply
    try {
      const repliesRes = await fetch(
        `${SLACK_API_URL}/conversations.replies?channel=${mapping.slack_channel_id}&ts=${mapping.slack_thread_ts}&limit=100`,
        { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
      );
      const repliesData = await repliesRes.json();
      if (repliesData.ok && repliesData.messages) {
        for (const msg of repliesData.messages) {
          const hasActions = msg.blocks?.some((b: { type: string }) => b.type === "actions");
          if (hasActions && msg.ts) {
            const blocksWithoutActions = msg.blocks.filter((b: { type: string }) => b.type !== "actions");
            await fetch(`${SLACK_API_URL}/chat.update`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: mapping.slack_channel_id,
                ts: msg.ts,
                text: msg.text || "",
                blocks: blocksWithoutActions,
              }),
            });
          }
        }
      }
    } catch (e) {
      console.error("Failed to remove old feedback buttons:", e);
    }

    // Send each chunk as a separate threaded message to avoid Slack's "See more" collapse
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const blocks: Record<string, unknown>[] = [];

      // Add divider + timestamp header on the first chunk
      if (i === 0) {
        blocks.push({ type: "divider" });
        const headerLabel = isHumanAdmin && adminName ? `💬 *${adminName}* replied · ${timestamp}` : `🤖 *Sam* replied · ${timestamp}`;
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: headerLabel }] });
      }

      blocks.push({ type: "section", text: { type: "mrkdwn", text: chunks[i] } });

      // Detect if Sam (AI) decided to route/escalate to humans
      const escalationKeywords = /\b(escalat|routing|transfer|hand(ing|ed)?\s*(this\s+)?(over|off)|human\s+(agent|support|team)|enterprise\s+(support\s+)?team|team\s+member|connect(ing)?\s+you\s+with|pass(ing)?\s+(this\s+)?(to|along))\b/i;
      const isAiEscalation = !isHumanAdmin && escalationKeywords.test(replyText);

      // Detect interim "working/thinking" messages from Sam — no buttons for these
      const workingPattern = /^(sam is (working|thinking|typing|processing)|working on (it|this|your)|let me (check|look|investigate)|one moment|hang tight|looking into)/i;
      const isInterimMessage = !isHumanAdmin && workingPattern.test(replyText.replace(/^[*_~`]+/, "").trim());

      const isAlreadyResolved = mapping.status === "resolved";

      if (isLastChunk) {
        if (isAlreadyResolved || isInterimMessage) {
          // Interim processing message — no buttons, no "continue chatting" hint
        } else if (isAiEscalation) {
          // Sam decided to route — no buttons, just a context note
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: "_Sam has routed this to the Enterprise Support Team_" }],
          });
        } else if (hasIncidentIoAction) {
          // incident.io action detected — skip buttons here, they'll go in the status block
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: isHumanAdmin ? "_To continue chatting, please send a reply in the thread_" : "_To continue chatting with Sam, please send a reply in the thread_" }],
          });
        } else {
          // Normal reply — show feedback buttons
          const actionElements: Record<string, unknown>[] = [
            {
              type: "button",
              text: { type: "plain_text", text: "👍 This resolved my issue", emoji: true },
              action_id: "feedback_positive",
              value: conversationId,
            },
          ];

          if (mapping.status !== "escalated" && mapping.status !== "escalated_pending") {
            actionElements.push({
              type: "button",
              text: { type: "plain_text", text: "👎 Escalate to human", emoji: true },
              action_id: "feedback_negative",
              value: conversationId,
            });
          }

          blocks.push({ type: "actions", elements: actionElements });
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: isHumanAdmin ? "_To continue chatting, please send a reply in the thread_" : "_To continue chatting with Sam, please send a reply in the thread_" }],
          });
        }
      }

      await postSlackMessage({ ...basePayload, text: chunks[i], blocks });
    }

    // Post incident.io status block if detected
    if (incidentStatusBlock.length > 0) {
      await postSlackMessage({
        ...basePayload,
        text: "📡 Lovable Status",
        blocks: incidentStatusBlock,
      });
    }

    // Post Intercom attachments to the Slack thread
    if (attachments.length > 0) {
      for (const att of attachments) {
        const isImage = att.content_type.startsWith("image/");
        const attBlocks: Record<string, unknown>[] = [];

        if (isImage) {
          attBlocks.push({
            type: "image",
            image_url: att.url,
            alt_text: att.name,
            title: { type: "plain_text", text: att.name },
          });
        } else {
          attBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `📎 <${att.url}|${att.name}>` },
          });
        }

        await postSlackMessage({
          ...basePayload,
          text: isImage ? att.name : `📎 ${att.name}`,
          blocks: attBlocks,
        });
      }
      console.log(`Posted ${attachments.length} attachment(s) to Slack thread`);
    }

    console.log(
      `Sent reply to Slack channel ${mapping.slack_channel_id}, thread ${mapping.slack_thread_ts}`
    );

    // If Sam auto-escalated, update status + reactions to match manual escalation
    const escalationKeywords2 = /\b(escalat|routing|transfer|hand(ing|ed)?\s*(this\s+)?(over|off)|human\s+(agent|support|team)|enterprise\s+(support\s+)?team|team\s+member|connect(ing)?\s+you\s+with|pass(ing)?\s+(this\s+)?(to|along))\b/i;
    const isAiEscalation2 = !isHumanAdmin && escalationKeywords2.test(replyText);
    if (isAiEscalation2 && mapping.status !== "escalated" && mapping.status !== "escalated_pending" && mapping.status !== "resolved") {
      await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "eyes");
      await addReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "hourglass_flowing_sand");
      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("id", mapping.id);
      console.log(`Sam auto-escalated conversation ${conversationId} — status set to escalated`);

      // Reassign in Intercom to enterprise team inbox (mirrors manual 👎 escalation)
      if (appSettings?.intercom_inbox_id && appSettings?.intercom_assignee_id) {
        // Route to test inbox if this is a test conversation
        const escalInboxId = mapping.is_test && appSettings?.test_intercom_inbox_id
          ? appSettings.test_intercom_inbox_id
          : appSettings.intercom_inbox_id;

        await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            message_type: "assignment",
            type: "team",
            assignee_id: escalInboxId,
            admin_id: appSettings.intercom_assignee_id,
            body: "",
          }),
        });
        console.log(`Webhook: reassigned conversation ${conversationId} to team inbox ${escalInboxId}`);

        // Convert conversation to ticket (mirrors manual 👎 escalation)
        try {
          const convertRes = await fetch(`https://api.intercom.io/conversations/${conversationId}/convert`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "Intercom-Version": "2.11",
            },
            body: JSON.stringify({ ticket_type_id: "1" }),
          });
          const convertData = await convertRes.json();
          const ticketId = convertData.ticket_id || convertData.id;
          console.log(`Webhook: converted conversation ${conversationId} to ticket:`, ticketId);
          // Persist the ticket ID so future replies route correctly
          if (ticketId) {
            await supabase.from("conversation_mappings")
              .update({ intercom_ticket_id: String(ticketId) })
              .eq("id", mapping.id);
          }
        } catch (e) {
          console.error(`Webhook: failed to convert conversation ${conversationId} to ticket:`, e);
        }

        // Post as customer to mark ticket as "Waiting" in Intercom inbox
        try {
          if (mapping.intercom_contact_id) {
            await fetch(`https://api.intercom.io/conversations/${conversationId}/reply`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${INTERCOM_API_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                message_type: "comment",
                type: "user",
                intercom_user_id: mapping.intercom_contact_id,
                body: "This ticket has been escalated — awaiting human support response.",
              }),
            });
            console.log(`Webhook: posted customer comment on ${conversationId} to mark as waiting`);
          }
        } catch (e) {
          console.error(`Webhook: failed to post escalation customer comment:`, e);
        }
      }
    } else if (isHumanAdmin && (mapping.status === "active" || mapping.status === "active_pending")) {
      // Human admin replied while status was still active — transition to escalated
      // so subsequent user replies get "reply forwarded" instead of "Sam is writing..."
      await removeReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "eyes");
      await addReaction(SLACK_BOT_TOKEN, mapping.slack_channel_id, mapping.slack_thread_ts, "hourglass_flowing_sand");
      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("id", mapping.id);
      console.log(`Human admin replied to conversation ${conversationId} — status set to escalated`);
    } else if (mapping.status === "active_pending") {
      // Reset pending status back so the next user reply can trigger a new notice
      await supabase
        .from("conversation_mappings")
        .update({ status: "active" })
        .eq("id", mapping.id);
    } else if (mapping.status === "escalated_pending") {
      await supabase
        .from("conversation_mappings")
        .update({ status: "escalated" })
        .eq("id", mapping.id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in intercom-webhook:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
