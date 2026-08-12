// One-shot test: posts a clearly-labeled test message to the ticket
// notifications Slack channel (C0BDZAY8R8A) using SLACK_BOT_TOKEN to verify
// the bot can post there. No tickets, no DMs, no DB writes.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_API_URL = "https://slack.com/api";
const DEFAULT_TICKET_NOTIFY_CHANNEL_ID = "C0BDZAY8R8A";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const TICKET_NOTIFY_CHANNEL_ID =
    new URL(req.url).searchParams.get("channel") || DEFAULT_TICKET_NOTIFY_CHANNEL_ID;
  const token = Deno.env.get("SLACK_BOT_TOKEN");

  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: "SLACK_BOT_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const text = `🧪 *Test* — Ticket channel notification check from \`slack-interactions\` config. Safe to ignore. (${new Date().toISOString()})`;

  try {
    const res = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: TICKET_NOTIFY_CHANNEL_ID,
        text,
        username: "Ask Lovable",
        icon_url:
          "https://dzwcgqyznzrntkbobejo.supabase.co/storage/v1/object/public/public-assets/bot-avatar/lovable-logo.png",
      }),
    });
    const data = await res.json();

    let diagnosis: string;
    if (data.ok) {
      diagnosis = `✅ Channel ${TICKET_NOTIFY_CHANNEL_ID} is configured correctly. Posted ts=${data.ts}.`;
    } else if (data.error === "not_in_channel") {
      diagnosis = `❌ Bot is not a member of ${TICKET_NOTIFY_CHANNEL_ID}. Run "/invite @<botname>" in that channel.`;
    } else if (data.error === "channel_not_found") {
      diagnosis = `❌ Channel ${TICKET_NOTIFY_CHANNEL_ID} not found. Verify the ID is correct and accessible to the bot.`;
    } else if (data.error === "is_archived") {
      diagnosis = `❌ Channel ${TICKET_NOTIFY_CHANNEL_ID} is archived.`;
    } else if (data.error === "missing_scope") {
      diagnosis = `❌ Bot token is missing required scope (likely chat:write). Slack needed scopes: ${data.needed ?? "unknown"}.`;
    } else {
      diagnosis = `❌ Slack returned error: ${data.error ?? "unknown"}`;
    }

    return new Response(
      JSON.stringify({ diagnosis, slack: data, channel: TICKET_NOTIFY_CHANNEL_ID }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        diagnosis: `❌ Network/throw before Slack responded.`,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
