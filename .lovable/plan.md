

## Gmail DL monitoring — track & count

### Overview
Add a polling edge function that checks a shared Google Group inbox every 15 minutes, logs new emails into a `gmail_conversations` table, and surfaces the volume on the Stats dashboard.

### Steps

**1. Connect Gmail connector**
- Use the Gmail connector (`google_mail`) to link the Google account that has access to the shared group inbox
- This provides `GOOGLE_MAIL_API_KEY` and uses the connector gateway for auth token refresh

**2. Create `gmail_conversations` table**
- Columns: `id` (uuid), `gmail_message_id` (text, unique — dedup key), `subject` (text), `sender_email` (text), `sender_name` (text), `received_at` (timestamptz), `snippet` (text), `label` (text), `created_at` (timestamptz default now)
- RLS: public read (matches existing pattern)

**3. Create `poll-gmail` edge function**
- Runs on a 15-minute cron schedule via `pg_cron` + `pg_net`
- Queries Gmail API via gateway: `GET /users/me/messages?q=list:{dl-address}` (or a label filter) with `maxResults=50`
- For each message not already in `gmail_conversations` (checked by `gmail_message_id`), fetches full message metadata and inserts a row
- Stores a high-water mark (latest `internalDate`) in the `settings` table to avoid re-scanning old emails

**4. Update Stats dashboard**
- Add a new "Gmail" section or tab on the Stats page showing:
  - Total email cases received (with same time-range filters)
  - Daily volume chart
- Keep it visually consistent with the existing Slack stats cards

**5. Update knowledge file and flow diagram**
- Document the new Gmail polling flow
- Add `poll-gmail` to the architecture table

### Technical details

- **Gmail query**: Use `list:{dl-email@domain.com}` or `to:{dl-email@domain.com}` as the `q` parameter to filter only DL emails
- **Dedup**: `gmail_message_id` unique constraint prevents double-counting
- **Gateway URL**: `https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages`
- **Config**: The DL email address to monitor will be stored in the `settings` table as a new `gmail_dl_address` column

### Files changed
- `supabase/functions/poll-gmail/index.ts` (new)
- `src/pages/Stats.tsx` (add Gmail volume section)
- `src/pages/Index.tsx` (add Gmail DL address setting field)
- 1 migration (new table + settings column)
- 1 cron job insert

