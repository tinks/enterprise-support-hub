---
name: Gmail thread deduplication
description: Analytics and UI deduplicate Gmail rows by gmail_thread_id, keeping the EARLIEST row per thread so threads bucket on origin date.
type: feature
---
Gmail creates one DB row per message. All analytics (Stats page) and the ImportTab "Recently imported" list deduplicate by `gmail_thread_id`, keeping the **earliest** row per thread (by `received_at || created_at`). This ensures threads are attributed to when the conversation started, not when the latest reply landed. Applies to: gmailTotal, gmailUniqueEmails, volume charts, resolved/open counts, customer domain analysis, hourly activity, and heatmap. Resolution time calculation uses raw rows (already groups by thread internally).
