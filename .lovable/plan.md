## Goal

When pasting a Slack/Teams thread into Log conversation, the Subject field should be a concise AI-generated summary of the issue (e.g. "SSO login failing for Okta users after SAML metadata refresh") instead of the current behavior, which just slices the first 60 characters of the first message.

## Current behavior

In `src/components/ManualLogTab.tsx` `handleParse()`:
```ts
const firstMsg = result[0].message_text;
setSubject(firstMsg.length > 60 ? firstMsg.slice(0, 60) + "…" : firstMsg);
```
This often produces useless subjects like "Hi team, hope you're well — I have a quick question…".

## Plan

### 1. Extend `parse-thread` edge function to also return a subject

`supabase/functions/parse-thread/index.ts` already calls Lovable AI Gateway with a single tool-call. Extend the tool schema to return both `messages` and a `subject` field in the same call (no extra round-trip, no extra cost).

- Tool name stays `extract_messages`. Add to its parameters:
  ```jsonc
  "subject": {
    "type": "string",
    "description": "A concise 4-10 word support-ticket-style summary of the user's actual issue or request. Focus on the topic, not pleasantries. No trailing punctuation."
  }
  ```
  Mark `subject` as required.
- Update the system prompt to instruct the model to write the subject as the model would title a Zendesk/Intercom ticket: noun-led, specific, no "Hi team" / "Help with…" / "Question about…" filler. Examples in the prompt.
- Return `{ messages, subject }`.

Model: keep `google/gemini-3-flash-preview` (already fast, cheap, and good at this).

### 2. Wire the summary into the client

In `src/lib/parseThread.ts`:
- `parseThreadWithAI()` currently returns `ParsedMessage[]`. Change its return type to `{ messages: ParsedMessage[]; subject?: string }` and surface the new `subject`.

In `src/components/ManualLogTab.tsx` `handleParse()`:
1. Run the existing regex `parseThread()` first (fast path, no AI cost).
2. If regex succeeds → call a new lightweight edge function call OR reuse `parse-thread` just for the subject. **Choice**: always call `parse-thread` when the user clicks Parse, so we get both AI-quality message extraction and an AI subject in one round trip. Regex output is only used as a same-turn fallback when the AI call fails (rate limit, 402 credits).
3. Set `subject` from the AI response when available, else fall back to the current 60-char slice.
4. Show a small spinner state on the "Parse thread" button while the AI call is in-flight (`parsing` boolean).
5. Update the Subject input placeholder to "Auto-summarized on parse — edit if needed".

Toast updates:
- Success: "Parsed N messages — summary generated".
- Fallback: "Parsed N messages — could not generate AI summary, using first line".

### 3. Error handling

- 429 / 402 / network errors → keep parsed messages, set subject from first-line slice, toast "AI summary unavailable, using first line".
- Validate that AI subject is non-empty and ≤120 chars; strip trailing punctuation/quotes.

### 4. Out of scope

- No change to detectThreadDate, manual-mode subject behavior, or non-paste flows.
- No change to other AI features in the app.
- No schema changes; subject still saves to `manual_conversations.subject`.

## Files touched

- `supabase/functions/parse-thread/index.ts` — extend tool schema + prompt to also return `subject`.
- `src/lib/parseThread.ts` — change `parseThreadWithAI` signature to return `{ messages, subject }`.
- `src/components/ManualLogTab.tsx` — always invoke AI parse on click, set subject from AI response with fallback, update placeholder/toasts.
- `.lovable/memory/logic/paste-thread-date-detection.md` — adjacent note, no edit required.
- New memory leaf `mem://logic/paste-thread-ai-subject` summarizing the rule.
