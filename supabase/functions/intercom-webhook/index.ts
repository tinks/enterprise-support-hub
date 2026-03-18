import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.208.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hub-signature",
};

const SLACK_API_URL = "https://slack.com/api";
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
    console.log(`Intercom webhook topic: ${topic}, conversation_id: ${body.data?.item?.id}`);

    const REPLY_TOPICS = ["conversation.admin.replied", "conversation.admin.single.reply", "ticket.admin.replied"];
    const CLOSED_TOPICS = ["conversation.admin.closed", "ticket.state.updated"];

    if (!REPLY_TOPICS.includes(topic) && !CLOSED_TOPICS.includes(topic)) {
      console.log(`Ignoring topic: ${topic}`);
      return new Response(JSON.stringify({ ok: true }), {
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
    const conversationId = body.data?.item?.id || body.data?.item?.ticket_id || body.data?.item?.conversation_id;
    if (!conversationId) {
      console.error("No conversation ID found in webhook payload");
      return new Response(JSON.stringify({ error: "No conversation ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: mapping } = await supabase
      .from("conversation_mappings")
      .select("*")
      .eq("intercom_conversation_id", String(conversationId))
      .maybeSingle();

    if (!mapping) {
      console.log(`No mapping found for Intercom conversation ${conversationId}`);
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
          .update({ status: "resolved" })
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

    const conversationParts = body.data?.item?.conversation_parts?.conversation_parts;

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

    // Deduplication: atomic UPDATE on last_intercom_part_id — only set if null or lower
    const partId = lastCommentPart.id ? String(lastCommentPart.id) : null;
    if (partId) {
      const { data: dedupeResult } = await supabase
        .from("conversation_mappings")
        .update({ last_intercom_part_id: partId })
        .eq("id", mapping.id)
        .or(`last_intercom_part_id.is.null,last_intercom_part_id.lt.${partId}`)
        .select("id");
      if (!dedupeResult || dedupeResult.length === 0) {
        console.log(`Duplicate detected: part ${partId} already processed for mapping ${mapping.id}, skipping`);
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
      const author = lastPart.author;
      const normalizedAuthorName = String(author?.name || "").trim().toLowerCase();
      const isKnownAiAgent = normalizedAuthorName === "sam" || normalizedAuthorName.includes("ask lovable");

      // Keep human behavior intact, but force Sam/Ask Lovable to stay on default bot identity
      if (author && author.type === "admin" && author.name && !isKnownAiAgent) {
        adminName = author.name;
        isHumanAdmin = true;
      }

      // Extract explicit attachments from the conversation part
      if (lastPart.attachments && Array.isArray(lastPart.attachments)) {
        const explicit = lastPart.attachments
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

    if (!replyText && attachments.length === 0) {
      console.log("No reply text or attachments found");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Detect incident.io action — check if the reply body references incident.io or the status page
    const STATUS_PAGE_URL = "https://status.lovable.dev";
    const incidentIoPattern = /incident\.io|status\.lovable\.dev|we have an incident|status page/i;
    const hasIncidentIoAction = incidentIoPattern.test(replyText) || (conversationParts?.[conversationParts.length - 1]?.body && incidentIoPattern.test(conversationParts[conversationParts.length - 1].body));

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

    // Prepend admin name for human replies so users know who responded
    if (isHumanAdmin && adminName) {
      replyText = `*${adminName}:*\n${replyText}`;
    }

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
    };

    // For human admin replies, fetch their avatar and override Slack identity
    if (isHumanAdmin && adminName && INTERCOM_API_TOKEN) {
      const lastPart = conversationParts[conversationParts.length - 1];
      const adminId = lastPart.author?.id;
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

      if (isLastChunk) {
        if (isInterimMessage) {
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
            elements: [{ type: "mrkdwn", text: "_To continue chatting with Sam, please send a reply in the thread_" }],
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
            elements: [{ type: "mrkdwn", text: "_To continue chatting with Sam, please send a reply in the thread_" }],
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
