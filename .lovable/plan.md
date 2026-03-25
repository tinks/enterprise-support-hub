

## Add Resolution Time Tracking to Project Knowledge

### What to add

The `resolved_at` column and resolution time reporting feature need to be documented. Two sections of the knowledge file need updates:

**1. Database Tables section (line 30)** — Update the `conversation_mappings` row to mention `resolved_at`:
```
| `conversation_mappings` | Maps Slack threads ↔ Intercom conversations with status tracking. Includes `resolved_at` timestamp for resolution time metrics |
```

**2. New section (after Stats/Section 11 area)** — Add a "Resolution Time Tracking" section:
- `resolved_at` column: set automatically when status changes to `"resolved"` (in `slack-interactions` and `intercom-webhook`)
- Historical data backfilled using `updated_at` as proxy
- Stats page displays: median resolution time, average resolution time, distribution chart (buckets: <15m, 15m–1h, 1–4h, 4–24h, 24h+), and 7-day rolling trend line
- Only conversations with both `created_at` and `resolved_at` are included in time metrics

### How
Write the updated full markdown to `pending_content` + `pending_summary` on the `knowledge_documents` row via database query, then you review and approve in the Knowledge tab.

