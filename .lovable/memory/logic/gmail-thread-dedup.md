---
name: Gmail thread deduplication
description: Analytics and UI deduplicate Gmail rows by gmail_thread_id, keeping the EARLIEST row per thread so threads bucket on origin date. Gmail-linked Intercom rows are also skipped from the Intercom series to prevent double-counting.
type: feature
---
Gmail creates one DB row per message. All analytics (Stats page) and the ImportTab "Recently imported" list deduplicate by `gmail_thread_id`, keeping the **earliest** row per thread (by `received_at || created_at`). This ensures threads are attributed to when the conversation started, not when the latest reply landed. Applies to: gmailTotal, gmailUniqueEmails, volume charts, resolved/open counts, customer domain analysis, hourly activity, and heatmap. Resolution time calculation uses raw rows (already groups by thread internally).

**Order of operations matters:** dedupe against the FULL unfiltered `gmailData` set first (picking the earliest row per thread), THEN apply the date-range/view filters against that representative row. Filtering before dedup causes a thread whose origin pre-dates the cutoff but has an in-range reply to be re-attributed to the reply's date, which inflates certain days.

**Gmail ↔ Intercom precedence:** when a Gmail thread has an `intercom_conversation_id`, the Intercom series in `mergedVolumeData` skips the matching `manual_conversations` row. The Gmail series is the source of truth for that conversation; counting it in both series double-counts on the daily volume chart.
