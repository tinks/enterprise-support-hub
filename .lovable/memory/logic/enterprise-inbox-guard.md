---
name: Enterprise Inbox Guard
description: Manual Intercom imports validate team_assignee_id == settings.intercom_inbox_id; forceInbox=true overrides
type: feature
---
`import-intercom-ticket` and `bulk-import-intercom` now refuse to import any Intercom conversation whose current `team_assignee_id` differs from `settings.intercom_inbox_id`. Single-URL import returns HTTP 409 `{ error: "not_in_enterprise_inbox", currentTeamId, enterpriseInboxId }`; ImportTab shows a toast with an "Import anyway" action that retries with `forceInbox: true`. Bulk import marks rows as `out_of_inbox` and surfaces an "Import N outside-inbox anyway" button that retries those IDs with `forceInbox: true`.

The `audit-out-of-inbox-tickets` edge function (Settings → Inbox audit) scans every Intercom-linked row across `manual_conversations`, `gmail_conversations`, and `conversation_mappings`. Dry-run returns mismatches; `apply: true` sets `is_test=true` and writes a `conversation_audit_logs` entry (`action: "flagged_out_of_inbox"`). Flagged rows drop out of Insights but remain viewable. On apply, the function also collects YYYY-MM months from each flagged row's `created_at` and deletes matching `monthly_insights` rows (`source='intercom'`) so cached buckets regenerate fresh on next Insights visit. Response includes `purgedMonths: string[]`.

Note: real-time webhook + 5-min poll already enforce the inbox guard; only the manual paths needed hardening. Gmail/Google-Group `pending_intercom_links` flow is intentionally exempt (relays from other inboxes are expected).
