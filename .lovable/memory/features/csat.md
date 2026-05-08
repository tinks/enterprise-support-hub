---
name: Intercom + Slack CSAT
description: Capture and display CSAT ratings from Intercom (manual/gmail) and a Slack-side prompt for Sam/Ask-Lovable conversations
type: feature
---

CSAT columns live on `manual_conversations`, `gmail_conversations`, AND `conversation_mappings` — all three have `csat_rating smallint`, `csat_remark text`, `csat_rated_at timestamptz` (validated 1–5 by `validate_csat_rating` triggers). `conversation_mappings` additionally has `csat_prompt_ts text` to track the Slack message we updated.

## Manual + Gmail (Intercom-side)
Imports (`import-intercom-ticket`, `bulk-import-intercom`) write CSAT on insert. Ongoing capture via `refresh-intercom-csat` edge function, scheduled every 6h via pg_cron (`refresh-intercom-csat-6h`) with `?mode=recent` (last 14 days resolved). One-time historical sweep: `?mode=backfill`. Hot paths intentionally don't handle CSAT — ratings arrive long after resolution.

## Slack-side (Sam / Ask Lovable)
The CSAT prompt fires from BOTH resolution paths (idempotent via `!csat_rating && !csat_prompt_ts`):
1. `intercom-webhook` close handler — when Intercom marks the linked conversation resolved.
2. `slack-interactions` `feedback_positive` handler — when the user clicks "👍 This resolved my issue" in Slack. This path sets `status='resolved'` first, so the subsequent Intercom close webhook short-circuits at its `mapping.status !== "resolved"` guard and would otherwise miss CSAT.

Both paths post the same threaded Slack message with 5 emoji buttons (😠 Terrible / 🙁 Bad / 😐 OK / 😀 Great / 🤩 Amazing, action_id `csat_1`…`csat_5`) and store its `ts` in `csat_prompt_ts`.

`slack-interactions` handles the click: writes `csat_rating` + `csat_rated_at`, replaces the prompt via `chat.update` ("Thanks for rating: <emoji> <label>"), and opens an optional remark modal (`callback_id: csat_remark_modal`, `private_metadata` carries `mappingId`). Modal submission writes `csat_remark`. Modal is only opened on the first rating (last-write-wins on subsequent clicks for the rating only).

When the customer submits a remark, `slack-interactions` also surfaces it (best-effort, in `EdgeRuntime.waitUntil` so modal closes immediately): (a) posts `💬 Customer remark on N/5: "…"` back into the original Slack thread via `chat.postMessage` with `BOT_IDENTITY`; (b) adds an internal note on the linked Intercom conversation via `POST /conversations/{id}/reply` with `message_type: "note"`, `admin_id = settings.intercom_assignee_id`. Both are skipped silently if their respective IDs are missing.

## Stats UI
`/stats` "Customer satisfaction" card aggregates ratings from all three sources. Avg score, total ratings, distribution, recent 1–2★ list with click-through. Response-rate denominator = resolved Slack rows + Intercom-linked manual/gmail rows in scope. Respects existing date / source / channel filters (`slack` source filter contributes Slack-side ratings).

## Conversation detail
A "Customer satisfaction" card appears on the conversation detail page when `csat_rating` is present, showing the emoji, score, optional remark, and rated-at timestamp. Read-only. The rating + remark also renders as a chronological entry in the message timeline (sorted by `csat_rated_at`) so it's discoverable inline alongside messages and internal notes.
