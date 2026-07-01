# v3 Customer slices — SHIPPED

See `mem://features/v3-customer-slices` for the canonical write-up.

Highlights:
- `v3_customer_accounts` + `v3_personal_email_domains` tables (admin-only writes, authenticated reads)
- `customer_key` / `customer_kind` / `customer_source` + override fields on `intercom_tickets_v3`
- Ordered derivation rules with **three lockstep implementations**: SQL derive function, SQL accounts-propagation trigger, Deno helper
- Backfill function `backfill_v3_customer_keys(force, batch)`
- Settings → Customer accounts CRUD (admin-only)
- Inbox v3 per-ticket override + reset-to-auto
- Analytics v3 Customer filter + Top customers table with `/inbox-v3?customer=<key>` deep-link

Next candidate scope: Intercom Company integration (deferred; slots in as rule 2b once we surface `company_id` on ticket rows).
