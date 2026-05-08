---
name: Intercom + Slack CSAT
description: Capture and display CSAT ratings from Intercom (manual/gmail) and a Slack-side prompt for Sam/Ask-Lovable conversations
type: feature
---

CSAT columns live on `manual_conversations`, `gmail_conversations`, AND `conversation_mappings` — all three have `csat_rating smallint`, `csat_remark text`, `csat_rated_at timestamptz` (validated 1–5 by `validate_csat_rating` triggers). `conversation_mappings` additionally has `csat_prompt_ts text` to track the Slack message we updated.

## Manual + Gmail (Intercom-side)
Imports (`import-intercom-ticket`, `bulk-import-intercom`) write CSAT on insert. Ongoing capture via `refresh-intercom-csat` edge function, scheduled every 6h via pg_cron (`refresh-intercom-csat-6h`) with `?mode=recent` (last 14 days resolved). One-time historical sweep: `?mode=backfill`. Hot paths intentionally don't handle CSAT — ratings arrive long after resolution.

## Slack-side (Sam / Ask Lovable)
When `intercom-webhook` marks a `conversation_mappings` row as resolved, it posts a second threaded Slack message with 5 emoji buttons (😠 Terrible / 🙁 Bad / 😐 OK / 😀 Great / 🤩 Amazing, action_id `csat_1`…`csat_5`) and stores its `ts` in `csat_prompt_ts`. Idempotent: skipped if `csat_rating` or `csat_prompt_ts` already set.

`slack-interactions` handles the click: writes `csat_rating` + `csat_rated_at`, replaces the prompt via `chat.update` ("Thanks for rating: <emoji> <label>"), and opens an optional remark modal (`callback_id: csat_remark_modal`, `private_metadata` carries `mappingId`). Modal submission writes `csat_remark`. Modal is only opened on the first rating (last-write-wins on subsequent clicks for the rating only).

## Stats UI
`/stats` "Customer satisfaction" card aggregates ratings from all three sources. Avg score, total ratings, distribution, recent 1–2★ list with click-through. Response-rate denominator = resolved Slack rows + Intercom-linked manual/gmail rows in scope. Respects existing date / source / channel filters (`slack` source filter contributes Slack-side ratings).

## Conversation detail
A "Customer satisfaction" card appears on the conversation detail page when `csat_rating` is present, showing the emoji, score, optional remark, and rated-at timestamp. Read-only.
