

## Update project knowledge file with missing knowledge

### Goal
Sync `.lovable/project-knowledge.md` (and the DB-backed `knowledge_documents` row) with recent changes that aren't yet documented.

### What's missing (based on recent work)
Recent unrecorded changes from this session and prior:

1. **Intercom as a first-class source**
   - `manual_conversations.source = 'intercom'` is now distinct from `'manual'`
   - Filter dropdowns (Inbox, Analytics, Flow Diagram) expose Intercom as its own option
   - Legacy data fix: rows with `intercom_conversation_id IS NOT NULL` were re-labeled from `manual` → `intercom`
   - All Intercom import paths (`backfill-enterprise-inbox`, `poll-intercom-inbox`, `intercom-webhook`, `import-intercom-ticket`, `bulk-import-intercom`) write `source = 'intercom'`

2. **Dedicated Intercom analytics section** in `Stats.tsx`
   - Own KPI cards: total, resolved %, active, avg resolution time, escalation rate, top product area, bug rate
   - Own charts: volume over time, status breakdown, product area breakdown
   - Honors environment + date filters; visible when source filter is "all" or "intercom"

3. **Source color palette** in Analytics charts
   - Slack: purple `#9B87F5`
   - Gmail: pink/red
   - Manual entry: teal
   - Intercom: amber `#F59E0B`
   - Conversation volume chart renders Manual and Intercom as separate Area series

4. **5-minute Intercom polling** via pg_cron (`poll-intercom-inbox-every-5min`) — already in memory but worth surfacing in the main knowledge doc

### Approach
- Read current `.lovable/project-knowledge.md` to find the right insertion points (Architecture / UI Pages / Integrations / Analytics sections)
- Add concise additions — do not rewrite existing content
- Submit via the **pending_content** mechanism (per the project rule: never modify live KB directly; require UI approval via diff viewer)

### Files
- Update `knowledge_documents` row `id = 'project-knowledge'`: set `pending_content`, `pending_summary`, `pending_at` so the user reviews/approves in the Project Knowledge UI
- Optionally also update `.lovable/project-knowledge.md` static file to match once approved

### Open question
Should I also update the **Flow page** (`src/pages/FlowDiagram.tsx`) to reflect the Intercom source as part of the flow, per the project rule "Whenever a logic change is made to the app, make sure to update the Flow page"? I'd recommend yes — but as a follow-up task, not part of this knowledge-doc update.

