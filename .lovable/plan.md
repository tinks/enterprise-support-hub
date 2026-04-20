

## Status: not fixed yet

The previous turn (when you accidentally hit build mode) only did the data cleanup for the older case and shipped the original subject-fallback. The hardening guards proposed for the `574a56d9…` / `2f9cf42f…` case were never written. Current `intercom-webhook` lines 305–393:

- Email linker (305–350): updates the entire Gmail thread without checking whether siblings are already linked to a *different* Intercom ID.
- Subject fallback (352–393): only filters out rows where `intercom_conversation_id IS NULL`, never queries `manual_conversations`. So if a manual row already represents the same subject, it still creates a new manual row.

So the same class of duplicate can still happen.

### Fix — three changes

**1. Data cleanup for `574a56d9…` / `2f9cf42f…`**

- `UPDATE gmail_conversations SET intercom_conversation_id = '215473963341741' WHERE gmail_thread_id = '19d9ce644175475b';` — re-stamp the 3 Gmail rows back to the original ticket (the manual row's ID).
- Invoke `backfill-intercom-replies` for manual row `574a56d9…` so any Intercom-side replies on that ticket land on the surviving record.
- Leave `2f9cf42f…` (the Gmail row) in place; it's now correctly linked. Manual row `574a56d9…` survives.

**2. `intercom-webhook` — manual_conversations lookup tier**

In `supabase/functions/intercom-webhook/index.ts`, before the manual-row creation fallback (after line 393), add a third lookup:

- Query `manual_conversations` for rows in the last 7 days with normalized subject equal to the Intercom ticket's normalized subject (same `Re:`/`Fwd:`/`Fw:` strip + lowercase + collapse-whitespace logic already used).
- If exactly one match: log `subject_match_existing_manual`, return `{ ok: true, message: "Duplicate Intercom ticket for existing manual conversation", existingManualId, existingIntercomId }`. Do NOT create a new manual row.
- If 0 or >1: fall through to current behavior.

**3. `intercom-webhook` — "do not overwrite different Intercom ID" guards**

Apply to **both** the email linker (321–325) and the subject linker (378–381):

- Change the thread-level update from `.eq("gmail_thread_id", threadId)` to `.eq("gmail_thread_id", threadId).or("intercom_conversation_id.is.null,intercom_conversation_id.eq." + intercomConvId)` so we never overwrite a sibling that's already pointed at a different ticket.
- Before doing the update, run a quick check: if any sibling on the thread already has a non-null `intercom_conversation_id` that's different from `intercomConvId`, log `subject_link_conflict` (or `email_link_conflict`) with both IDs and return `{ ok: true, message: "Duplicate Intercom ticket for already-linked Gmail thread", existingIntercomId }`. Skip linking and skip manual creation entirely — Intercom has a duplicate ticket, our DB already represents the conversation correctly.

### Files

- Edit: `supabase/functions/intercom-webhook/index.ts` — manual-conversations subject lookup + thread-overwrite guards on both linkers
- Data writes: 1 UPDATE on `gmail_conversations`, 1 invocation of `backfill-intercom-replies` for `574a56d9…`
- Update `.lovable/project-knowledge.md` and the Flow page: linker priority order (email → subject in Gmail → subject in manual_conversations → create) and the "never overwrite a different Intercom ID" rule
- Update `mem://logic/google-group-linking` to add the overwrite-guard rule
- New memory: `mem://logic/duplicate-intercom-ticket-detection` documenting the manual-conversations subject lookup tier and the overwrite guards

### Out of scope

- `conversation.merged` webhook handler (this case wasn't a merge; it was creation-time mis-linking).
- Auto-merging Intercom tickets via API (Intercom doesn't expose a public merge endpoint).
- Subject fuzzy matching beyond `Re:`/`Fwd:`/`Fw:` strip + lowercase + whitespace collapse.

### Confirm before I run

1. Survivor stays manual row `574a56d9…` (Intercom `215473963341741`); Gmail thread `19d9ce644175475b` re-stamped to that ID. ✅?
2. Apply data fix + both code guards (manual-conversations lookup + overwrite guards on both linkers) in one pass?

