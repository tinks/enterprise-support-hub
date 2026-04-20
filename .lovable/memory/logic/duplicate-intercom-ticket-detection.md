---
name: Duplicate Intercom Ticket Detection
description: Subject-based existing-record lookup against BOTH gmail_conversations and manual_conversations + thread-overwrite guards in intercom-webhook to prevent duplicate records when Intercom creates a second ticket for the same logical thread
type: feature
---
When an outbound Intercom reply loops back through the enterprise-support Google Group, Intercom can create a second ticket for the same logical conversation. Without guards, the email/subject linkers would re-stamp an already-linked Gmail thread with the new Intercom ID, OR the manual-creation fallback would insert a duplicate row when the original lives in `gmail_conversations` (not `manual_conversations`).

`intercom-webhook` linker priority order (auto-import path):
1. **Email-based Gmail link** — match `gmail_conversations` by contact email; if a thread is found, link.
2. **Subject-based Gmail tier** (14d window) — single pass that does TWO checks against `gmail_conversations` rows with normalized-matching subject:
   - **(a) Already-represented check**: if any matched row has a non-null `intercom_conversation_id` different from the incoming one, log `subject_match_existing_gmail` and return. Skip everything below.
   - **(b) Stamp check**: only if (a) found nothing, look at the unlinked candidates. If exactly one distinct unlinked thread matches, stamp it (with sibling overwrite guard).
3. **Manual-conversations subject lookup** (7d window) — if exactly one `manual_conversations` row has the same normalized subject, log `subject_match_existing_manual` and return.
4. **Create new manual row** — last resort.

Critical: tier 2 must run BOTH checks even when there's nothing to stamp. The previous bug was that the subject linker only ran when there was an unlinked thread to stamp; for Google-Group duplicates where every sibling was already linked, it silently fell through to manual creation, producing a duplicate manual row.

Overwrite guards on both Gmail linkers (email + subject):
- Before updating, query siblings on the `gmail_thread_id`. If any sibling has a non-null `intercom_conversation_id` that differs from the incoming ticket, log `email_link_conflict` / `subject_link_conflict` and return without overwriting.
- Thread-level update is also constrained with `.or("intercom_conversation_id.is.null,intercom_conversation_id.eq.<newId>")` as a defense-in-depth safety net.

Subject normalization is shared across tiers: strip `Re:`/`Fwd:`/`Fw:`, collapse whitespace, lowercase, trim. Min length 6 chars to avoid trivial collisions.
