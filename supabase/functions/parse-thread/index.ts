import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "../_shared/require-editor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  try {
    const { rawThread } = await req.json();
    if (!rawThread || typeof rawThread !== "string") {
      return new Response(JSON.stringify({ error: "rawThread is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a Slack/Teams thread parser for an enterprise support team.

Given raw copied thread text, do TWO things:

1. Extract each individual message with sender name, full message text, and timestamp as it appears. Ignore reply counts, reactions, emoji status lines, and metadata. For sent_at, return the raw timestamp string exactly as it appears (e.g. "1:47 PM", "Mar 26th at 11:03 AM", "3/26/2025 11:03 AM"). If no timestamp is visible for a message, omit sent_at.

2. Write a concise support-ticket-style "subject" (4–10 words) summarizing the user's actual issue or request. Think of it as a Zendesk/Intercom ticket title:
   - Noun-led, specific, focused on the technical topic.
   - No pleasantries ("Hi team", "Hope you're well"), no filler ("Question about…", "Help with…", "Need help with…"), no trailing punctuation, no quotes.
   - Use product/feature/error names that appear in the thread.
   - Good: "SSO login fails for Okta users after metadata refresh"
   - Good: "SCIM provisioning duplicates users on email change"
   - Good: "Workspace billing invoice missing November charges"
   - Bad: "Hi team I have a question about login"
   - Bad: "Help with SSO"`,
          },
          {
            role: "user",
            content: rawThread,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_messages",
              description: "Extract individual messages and a ticket-style subject from a thread",
              parameters: {
                type: "object",
                properties: {
                  subject: {
                    type: "string",
                    description: "Concise 4–10 word support-ticket-style summary of the user's actual issue or request. No pleasantries, no filler, no trailing punctuation.",
                  },
                  messages: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        sender_name: { type: "string", description: "Full name of the message sender" },
                        message_text: { type: "string", description: "The full message text content" },
                        sent_at: { type: "string", description: "Raw timestamp string as it appears in the text, e.g. '1:47 PM' or 'Mar 26th at 11:03 AM'" },
                      },
                      required: ["sender_name", "message_text"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["subject", "messages"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_messages" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI parsing failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No structured output from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    const rawSubject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    const cleanedSubject = rawSubject
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?]+$/g, "")
      .slice(0, 120)
      .trim();
    return new Response(
      JSON.stringify({ messages: parsed.messages || [], subject: cleanedSubject || undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("parse-thread error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
