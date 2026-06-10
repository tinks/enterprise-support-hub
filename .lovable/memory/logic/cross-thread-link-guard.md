---
name: Cross-thread link guard
description: intercom-webhook skips email linker on @lovable.dev contacts and refuses to stamp an Intercom id onto a second Gmail thread
type: feature
---
Two layered protections in `supabase/functions/intercom-webhook/index.ts` prevent one Intercom ticket from fanning out across unrelated Gmail threads:

1. **Internal-domain skip (Option 1):** when `contactEmail` is in `GROUP_ALIASES` or ends in `@lovable.dev`, the email-based Gmail linker is skipped entirely. Falls through to subject tier + pending-link path. Logs `[email-linker-skip]`. Rationale: internal employees authoring Intercom tickets on behalf of customers have many unrelated open threads — the most-recent-thread heuristic mis-stamps.

2. **Inverse uniqueness guard (Option 2):** at both email and subject stamping tiers, before writing `intercom_conversation_id = X` onto Gmail thread `Y`, query whether `X` is already linked to a different `gmail_thread_id`. If yes, refuse and log `[cross_thread_link_conflict:email]` or `[cross_thread_link_conflict:subject]`. Complements the existing per-thread overwrite guard.

Trade-off: legitimate Intercom-side merges (rare) would also be blocked — handled manually if it happens. Look for `cross_thread_link_conflict` in edge logs.
