## Goal

Every day at ~04:00 UTC, poll Slack channel `C09CL5E028N` via the "11 - PICK THIS BOT CONNECTION" Slack connection for the last 2 days of messages, extract `Company Name:` and `Company Domain:` from each message, and insert any missing accounts into `public.v3_customer_accounts`. **Deduplication is by extracted company domain.**

## New edge function: `poll-slack-closed-won`

Location: `supabase/functions/poll-slack-closed-won/index.ts`. Registered in `supabase/config.toml` with `verify_jwt = false` (invoked by pg_cron with the anon key; also callable manually for testing).

Behavior:
1. Read `SLACK_API_KEY` and `LOVABLE_API_KEY` from env; fail with 500 + JSON error if missing.
2. Call Slack `conversations.history` via connector gateway (`https://connector-gateway.lovable.dev/slack/api/conversations.history`) with:
   - `channel=C09CL5E028N`
   - `oldest = (now − 2 days)` as unix seconds
   - `limit=200`, paginated by `response_metadata.next_cursor` until exhausted
   - Headers: `Authorization: Bearer ${LOVABLE_API_KEY}`, `X-Connection-Api-Key: ${SLACK_API_KEY}`
   - Surface non-2xx or `ok:false` bodies as errors with the provider status/body (per gateway rules).
3. For each message, concatenate `text` + any `attachments[].text/fallback` + any `blocks[].text.text` (handles rich bot posts and plaintext).
4. Extract per message:
   - Company name: first `/Company Name:\s*(.+)/i` match, trimmed, stripped of markdown wrappers (`*`, `_`, backticks, `<…>`).
   - Company domain: first `/Company Domain:\s*(\S+)/i` match, lowercased, `https?://` and leading `www.` stripped, trailing slash removed.
   - Skip the message if either is missing/empty.
   - Compute `account_key = name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")`. Skip if empty.
5. **Deduplicate by domain**:
   - Within the batch, keep only the first occurrence per unique domain.
   - Query `v3_customer_accounts` for rows where `domains @> ARRAY[<domain>]` for the batch's domains. Drop any candidate whose domain is already claimed by any existing account.
   - Also drop candidates whose derived `account_key` already exists (avoid PK conflicts even if domain differs, e.g. re-runs after a manual edit).
6. Insert remaining rows with the service-role client:
   ```
   { account_key, label: <name>, domains: [domain], notes: 'Auto-created from Slack #closed-won on <ISO date>' }
   ```
   Wrap each insert in its own try/catch so one row failing (e.g. the DB domain-collision trigger) doesn't abort the batch.
7. Return JSON summary: `{ scanned, extracted, inserted, skipped_domain_exists, skipped_account_key_exists, errors: [...] }` and log the same for edge function logs.

Idempotent: re-running the same day inserts nothing because the domain check catches everything from the previous run.

## Cron schedule

Enable `pg_cron` and `pg_net` via migration if not already active. Then, via `supabase--insert` (per `schedule-jobs-supabase-edge-functions` — the SQL embeds the project URL + anon key and must NOT go through migrations):

```sql
select cron.schedule(
  'poll-slack-closed-won-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url:='https://dzwcgqyznzrntkbobejo.supabase.co/functions/v1/poll-slack-closed-won',
    headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);
```

## Verification

- Deploy the function, invoke it once with `supabase--curl_edge_functions`, inspect JSON summary + `supabase--edge_function_logs`.
- `supabase--read_query` on `v3_customer_accounts` to confirm newly-inserted rows.

## Docs pass (project convention)

Separate docs-only pass after logic lands:
- `.lovable/project-knowledge.md` — document the new daily Slack-driven account ingestion path.
- `src/pages/FlowDiagram.tsx` — add a node/edge for Slack `#closed-won` → `poll-slack-closed-won` → `v3_customer_accounts`.

## Files / objects changed

- New: `supabase/functions/poll-slack-closed-won/index.ts`
- Edit: `supabase/config.toml` (add `[functions.poll-slack-closed-won] verify_jwt = false`)
- Migration: enable `pg_cron` + `pg_net` if missing
- Data (`supabase--insert`): create the cron schedule
- Docs pass: `.lovable/project-knowledge.md`, `src/pages/FlowDiagram.tsx`
