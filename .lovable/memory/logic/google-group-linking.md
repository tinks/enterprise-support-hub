---
name: Google Group Linking
description: Subject-based fallback in intercom-webhook for emails relayed via the enterprise-support Google Group, plus 5-min reply reconciliation cron and thread-overwrite guards
type: feature
---
When inbound mail arrives via the `enterprise-support@lovable.dev` Google Group, the customer's email is stripped before being relayed to our inbox. The Gmail row's `from_email` is the group alias and Matt/etc. never appear on the row. Email-based linking in `intercom-webhook` therefore cannot find the matching Gmail thread and falls through to a subject-based fallback.

The webhook normalizes the Intercom ticket subject (strips `Re:`/`Fwd:`/`Fw:`, collapses whitespace, lowercases) and matches it against unlinked `gmail_conversations` received in the last 24 h. If exactly one distinct `gmail_thread_id` matches, the ticket is linked to the entire thread. If 0 or >1 match, it logs `subject_link_ambiguous` and falls through.

**Overwrite guard (both email and subject linkers):** before linking, the webhook checks if any sibling on the target `gmail_thread_id` is already linked to a *different* `intercom_conversation_id`. If so, it logs `email_link_conflict` / `subject_link_conflict` and returns without overwriting — the new Intercom ticket is treated as a duplicate. Update queries also use `.or("intercom_conversation_id.is.null,intercom_conversation_id.eq.<newId>")` as defense-in-depth. See `mem://logic/duplicate-intercom-ticket-detection`.

A 5-minute pg_cron job `reconcile-intercom-replies-every-5min` calls `backfill-intercom-replies?recent=true` as a safety net for any reply webhooks Intercom drops, races, or topics outside the whitelist. `recent=true` mode targets manual + gmail rows updated/received in the last 7 days (capped at 200). Realtime `REPLY_TOPICS` includes: `conversation.admin.replied`, `conversation.admin.single.reply`, `ticket.admin.replied`, `conversation.user.replied`, `conversation.user.created`, `conversation.operator.replied`, `ticket.contact.replied`.
