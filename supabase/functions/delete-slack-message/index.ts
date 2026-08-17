import { requireEditor } from "../_shared/require-editor.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
    if (!slackToken) {
      return new Response(JSON.stringify({ error: "Missing SLACK_BOT_TOKEN" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { channelId, messageTs } = await req.json();
    if (!channelId || !messageTs) {
      return new Response(
        JSON.stringify({ error: "channelId and messageTs are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const res = await fetch("https://slack.com/api/chat.delete", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: channelId, ts: messageTs }),
    });

    const data = await res.json();

    if (!data.ok) {
      console.error("Slack chat.delete error:", data.error);
      return new Response(
        JSON.stringify({ error: data.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-slack-message error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
