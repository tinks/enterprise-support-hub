---
name: Duplicate Intercom Ticket Detection
description: Manual-conversations subject lookup + thread-overwrite guards in intercom-webhook to prevent duplicate records when Intercom creates a second ticket for the same thread
type: feature
---
When an outbound Intercom reply loops back through the enterprise-support Google Group, Intercom can create a second ticket for the same logical conversation. Without guards, the email/subject linkers would re-stamp an already-linked Gmail thread with the new Intercom ID, and the manual-creation fallback would insert a duplicate row.

`intercom-webhook` linker priority order (auto-import path):
1. **Email-based Gmail link** — match `gmail_conversations` by contact email; if a thread is found, link.
2. **Subject-based Gmail fallback** (24h window) — for Google-Group-relayed mail where the customer email never appears on the Gmail row.
3. **Manual-conversations subject lookup** (7d window) — if exactly one `manual_conversations` row has the same normalized subject, log `subject_match_existing_manual` and return without creating a new manual row.
4. **Create new manual row** — last resort.

Overwrite guards on both Gmail linkers (email + subject):
- Before updating, query siblings on the `gmail_thread_id`. If any sibling has a non-null `intercom_conversation_id` that differs from the incoming ticket, log `email_link_conflict` / `subject_link_conflict` and return without overwriting. Intercom has a duplicate ticket; our DB already represents the conversation correctly.
- The thread-level update is also constrained with `.or("intercom_conversation_id.is.null,intercom_conversation_id.eq.<newId>")` as a defense-in-depth safety net.

Subject normalization is shared across tiers: strip `Re:`/`Fwd:`/`Fw:`, collapse whitespace, lowercase, trim. Min length 6 chars to avoid trivial collisions.
