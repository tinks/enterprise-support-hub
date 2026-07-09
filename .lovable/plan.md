## Plan: import TSV rows into `v3_customer_accounts`

Parse the uploaded TSV (205 data rows) and load via the `insert` tool.

### Row handling
- **Skip** `workday` — existing row is identical.
- **Merge** TSV `cactus_gaming` into existing `Cactus Gaming` row: add `anagaming.com.br` and `cactuscorporation.com` to its `domains` array (keep existing `cactusgaming.net`, existing key/label unchanged). Do NOT insert a new row.
- **Insert** the remaining 203 rows as new accounts. `label = company_name`, `account_key = account_key`, `domains = verified_domains` (array). `notes` stays NULL.

### Safety
- Use `INSERT ... ON CONFLICT (account_key) DO NOTHING` as a belt-and-suspenders guard against any other key collisions.
- Domains are already lowercased/deduped by the `BEFORE INSERT` trigger; the domain-collision trigger will abort the batch if any TSV domain overlaps with a *different* existing account. With workday + Cactus Gaming handled above, no known collisions remain, but if the batch fails I'll report which row triggered it before retrying.
- No schema change, no code change, no migration. Data-only via `supabase--insert`.

### Post-insert
- Run `SELECT public.backfill_v3_customer_keys(true, 5000)` so tickets whose contact domains now match a new account re-derive their `customer_key`.
