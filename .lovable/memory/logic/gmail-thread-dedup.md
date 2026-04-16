---
name: Gmail thread deduplication
description: Analytics and UI deduplicate Gmail rows by gmail_thread_id, not subject. One representative row per thread for all KPIs.
type: feature
---
Gmail creates one DB row per message. All analytics (Stats page) and the ImportTab "Recently imported" list deduplicate by `gmail_thread_id`, keeping only the latest row per thread. This applies to: gmailTotal, gmailUniqueEmails, volume charts, resolved/open counts, customer domain analysis, hourly activity, and heatmap. Resolution time calculation still uses raw rows (already groups by thread internally). The old subject-based dedup has been replaced.
