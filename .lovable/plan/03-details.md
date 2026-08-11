## Page layout

Header: title, "Read-only" badge, target chip ("Triage target: 30 min, business hours — provisional"), "Data as of HH:mm (syncs every 5 min)" and a manual refresh button.

Summary strip: total awaiting triage, and counts per band (breached / at risk / approaching / OK).

Table, sorted oldest business-hours age first:

| Column | Notes |
| --- | --- |
| Age (business) | primary, drives the row grade |
| Elapsed (wall) | secondary honesty column |
| Subject | links out to the Intercom conversation |
| Customer | account label from `v3_customer_accounts`, same resolution as other views |
| Contact | name / email |
| Owner | assignee |
| Anchor | timestamp used, with a marker when it came from Enterprise-Inbox assignment vs creation |

Filters, matching the Prospects page conventions: free-text search, owner select, customer select. No write actions anywhere on the page; the future "assign triage" action is out of scope for this build.

## Technical notes

- New `src/pages/Triage.tsx`; route `/triage` in `App.tsx` behind `ProtectedRoute`; entry "Triage" in the **Issues** group in `AppLayout.tsx`, placed above Inbox.
- Query `intercom_tickets_v3` directly (select `id, intercom_conversation_id, subject, contact_name, contact_email, owner, customer_key, custom_attributes, intercom_created_at, last_synced_at, raw_payload`) filtered to `lifecycle_status in ('open','reopened_after_finalize')`, then drop rows whose `custom_attributes->>'Severity'` is non-empty client-side. `useSlaBatch` is not reused — it deliberately loads only finalized tickets.
- Anchor comes from `computeSla(raw_payload).slaClockStartS ?? createdAtS`, reusing the existing engine; business-hours elapsed from `businessHoursBetween(anchorS, nowS, businessHours)`.
- Policy read through the existing `useSlaPolicy` hook: triage target seconds and business hours come from the version in force now; `PolicyFallbackBanner` renders when the config is unavailable.
- A one-minute ticking clock re-renders the ages so bands advance without a reload; the data itself refetches on mount and on manual refresh.
- No migration, no schema change, no edge-function change — read-only against existing tables.
- Follow-up pass (not in this build): `.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and the FlowDiagram node for the new surface.
