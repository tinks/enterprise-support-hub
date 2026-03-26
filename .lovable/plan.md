

## Add app name to knowledge file

### What to update

Submit a pending knowledge update that adds "Lovable Enterprise Support Hub" as the official app name. Two changes:

**1. Section 1 (Overview, line 10):** Add the app name at the start — "**Lovable Enterprise Support Hub** — A Slack-to-Intercom support bridge..."

**2. Section 4 (UI Pages table, line 40):** Update the Stats row description from "System statistics" to "Lovable Enterprise Support Hub dashboard — system statistics and metrics"

### How

Use a `read_query` to fetch current content, then `UPDATE` the `pending_content` and `pending_summary` columns on the `knowledge_documents` table (per the established agent workflow in Section 18). The user will review and approve in the Knowledge tab.

### Summary
- No code file changes
- 1 database update (pending knowledge content)
- User approval required via Knowledge tab

