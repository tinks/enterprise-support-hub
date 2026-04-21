

## Why duplicates happen

`intercom-webhook` handles assignment events. When Intercom assigns a new ticket to the enterprise inbox, it fires **both** topics within ~1 second:
- `conversation.admin.assigned`
- `conversation.admin.open.assigned`

Both are in `ASSIGNMENT_TOPICS`, so the auto-import path runs twice. The flow:

1. Dup-check across 3 tables — both webhook invocations see "no existing row" because they fire concurrently before either commits.
2. `manual_conversations.upsert(..., onConflict: "intercom_conversation_id")` — second invocation correctly returns the same row, no duplicate conv.
3. **`manual_messages.insert(messages)`** — runs unconditionally on both invocations. **No idempotency.** Every message gets inserted twice.

I confirmed this by inspecting:
- Conv `835057a8…` (Apr 21): 5 rows = 3 distinct, every `created_at`-tied original message duplicated, only Joel's later reply (added via live `conversation.admin.replied` after the conv already existed) is single.
- Conv `3495565e…` (Apr 3): 31 rows, every message exactly doubled with identical `created_at`. Only Joel's manual `Apr 19` reply is single.
- Edge logs show the double-fire on conv `215474002457693`: both `conversation.admin.assigned` (T+0ms) and `conversation.admin.open.assigned` (T+850ms) hit the function back-to-back.

The same lack of message-level idempotency exists in `poll-intercom-inbox` and `backfill-enterprise-inbox`, so polling/backfill races could trigger it too. The webhook is by far the dominant path.

The live-append at `intercom-webhook:682` (for `conversation.admin.replied` on already-tracked manual rows) also has no dedup, but the data shows it's not the source of these duplicates — those messages are single.

## Fix

### 1. Make `manual_messages` insertion idempotent in `intercom-webhook` auto-import

In `supabase/functions/intercom-webhook/index.ts` around lines 568–574, before inserting `messages`, fetch existing messages for the (just-upserted) conversation and filter out any whose `(role, message_text, created_at-epoch-second)` already exists. Concretely: re-query `manual_messages` for `conversation_id = inserted.id`, build a set of `${role}|${md5(message_text)}|${epochSec}` keys, drop matches from `messages`, then insert only the remainder. This makes the second concurrent webhook a no-op for messages.

### 2. Same idempotency in `poll-intercom-inbox`

In `supabase/functions/poll-intercom-inbox/index.ts` lines 350–360, mirror the same dedup pattern before inserting `messages`. (Only matters if a poll race ever happens, but cheap insurance.)

### 3. Drop the second assignment topic OR add a per-conversation lock

Cleanest option: remove `conversation.admin.open.assigned` from `ASSIGNMENT_TOPICS`. They fire for the same logical event; one is enough. But this is a defense-in-depth change, not the root fix — keep both topics processable, but rely on the message-level dedup from change #1 to make the second one a no-op.

I'll do the message-level dedup (the actual fix). Skipping the topic-list change unless you want it.

### 4. One-time data cleanup — dedupe existing rows

Delete the 2nd row of every `(conversation_id, role, message_text, created_at-truncated-to-second)` group across `manual_messages`. Keep the row with the lowest `id` (UUID lexicographic — arbitrary but stable). Counts to expect from the survey: ~25+ conversations affected, 50+ duplicate rows deleted.

Concrete SQL:
```sql
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY conversation_id, role, message_text,
                 date_trunc('second', created_at)
    ORDER BY id
  ) AS rn
  FROM manual_messages
)
DELETE FROM manual_messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

I'll print the count first (dry-run select), then execute.

### Files

- `supabase/functions/intercom-webhook/index.ts` — add message dedup before insert at line 572.
- `supabase/functions/poll-intercom-inbox/index.ts` — same dedup at line 358.
- One SQL cleanup query against `manual_messages`.
- `.lovable/project-knowledge.md` — note that `manual_messages` inserts must dedupe by `(conversation_id, role, content, second-precision created_at)` because Intercom fires multiple assignment topics per event.
- `mem://logic/slack-deduplication` (or a new `mem://logic/manual-message-dedup`) — capture the rule.

### Out of scope

- Changing `live-append` path (line 682) — no evidence it's duplicating today, and adding dedup there is a separate cheap-insurance change you can ask for if you want.
- Backfill-intercom-replies — already has epoch-based dedup at line 167, no change needed.
- Trimming `ASSIGNMENT_TOPICS` — keeping both topics is fine once messages are idempotent; lets us survive Intercom firing only one of them.

### Confirm

1. Run the dedupe SQL on `manual_messages` (lossless: only removes exact duplicates within the same second)?
2. Add message-level idempotency to both `intercom-webhook` auto-import and `poll-intercom-inbox`?

