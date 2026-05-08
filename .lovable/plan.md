# Fix missing CSAT for Slack-resolved conversations

## Root cause
The CSAT prompt is only posted inside `intercom-webhook`'s "closed" handler, gated by `if (mapping.status !== "resolved")`. When a user clicks "👍 This resolved my issue" in Slack, `slack-interactions` sets `status='resolved'` first, then closes Intercom. The subsequent close webhook sees status already resolved and skips — so CSAT never fires for this (very common) path.

Confirmed via logs for Intercom conversation 215474223170131 / mapping `338b5c82…`: "Conversation 215474223170131 already resolved, skipping" right after the user clicked feedback_positive.

## Changes

### 1. `supabase/functions/slack-interactions/index.ts` — feedback_positive branch
After posting the closing message and closing the Intercom conversation, post the same CSAT block already used by `intercom-webhook` and persist `csat_prompt_ts`. Keep idempotent: skip if `csat_rating` or `csat_prompt_ts` already set.

Reuse the exact same block payload (5 emoji buttons, `block_id: csat_<mapping.id>`, `action_id: csat_1..csat_5`) so the existing `slack-interactions` rating handler keeps working unchanged.

### 2. `supabase/functions/intercom-webhook/index.ts` — close handler
Move the CSAT prompt block out of the `if (mapping.status !== "resolved")` branch so it also runs when the close webhook arrives for an already-resolved mapping. Idempotency (`!csat_rating && !csat_prompt_ts`) prevents duplicates when both paths run.

### 3. Extract a small helper (optional, same file scope)
To avoid duplicating the ~30-line Slack `chat.postMessage` payload, add a tiny inline helper `postCsatPrompt(mapping)` in each function (no shared module — edge functions don't share imports cleanly). Keeps the two call sites readable.

### 4. Documentation
- Update `mem://features/csat` to note both trigger paths (Slack feedback_positive AND Intercom close).
- Update `.lovable/project-knowledge.md` CSAT section accordingly.
- Update the Flow page node/description for resolution → CSAT.

## Out of scope
- Backfilling CSAT prompts for already-resolved conversations missing `csat_prompt_ts` (e.g. this 215474223170131 ticket). Can be done later with a one-shot script if you want.
- Changing the rating UI / modal behavior.
- DM/Gmail/manual CSAT.

## Verification
- Resolve a test Slack thread via the 👍 button → CSAT block appears in the thread, `csat_prompt_ts` set in DB.
- Resolve a test Slack thread by closing the linked Intercom conversation → CSAT block appears (existing path still works).
- Resolve via 👍 then have Intercom close fire → only one CSAT block posted (idempotency).
