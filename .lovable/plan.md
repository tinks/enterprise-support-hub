

## Update knowledge file with all 6 missing items

### What's changing

Submit a pending knowledge update covering these gaps:

**1. App name** — Title line updated to "Project Knowledge — Lovable Enterprise Support Hub"

**2. Route table fix** — Correct the UI Pages table:
- `/` → Stats → "Lovable Enterprise Support Hub dashboard"
- `/settings` → Settings → "Configure channels, Intercom IDs, testing mode"
- Add `/knowledge` → Knowledge → "Project knowledge document with review workflow"

**3. Channel overrides** — Add new section (§11b or append to §11) documenting `src/lib/channelOverrides.ts` and the manual override map for private/unresolvable channels

**4. Slack-reply echo dedup** — Add to dedup table (§10) a new row: "Slack-origin echo guard | `intercom-webhook` | Skips replies containing `[From:...via Slack]` prefix to prevent echoing Slack-forwarded messages back"

**5. Stats math formula** — Add new section (§19) documenting:
- `Total = Open + Resolved + Cancelled`
- "Open" includes: `active`, `active_pending`, `awaiting_context`, `escalated`, `escalated_pending`, `processing`
- "Escalated to human" is an informational subset of Open
- Card order: Total → Resolved → Cancelled → Open → Escalated to human → Success rate → Avg/day

**6. Context-reminder in architecture table** — Add `context-reminder` row to the Edge Functions table in §2: "Cron-triggered function that reminds idle users and auto-proceeds after 30 min"

### How

- Read current `content` from `knowledge_documents`
- Apply all 6 changes to produce new text
- Write to `pending_content` + `pending_summary` via database update
- User reviews and approves in Knowledge tab

### Summary
- No code file changes
- 1 database update (pending knowledge content)
- User approval required via Knowledge tab

