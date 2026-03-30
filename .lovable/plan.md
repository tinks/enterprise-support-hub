

## Add Gmail inbox monitoring to conversations and stats

### Overview
Poll a Google Group inbox (via the Gmail connector gateway) on a schedule, store email metadata in a new `gmail_conversations` table, and surface the data alongside Slack conversations in both the Conversations and Stats pages.

### Step 1: Connect Gmail connector

Link the **Community inbox** Gmail connection (`std_01kkgr30teey39damrjnv83bdv`) to this project so the gateway credentials are available to edge functions.

### Step 2: Create `gmail_conversations` table

New database table to store Gmail email metadata:

| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | auto-generated |
| gmail_message_id | text (unique) | Gmail message ID for dedup |
| gmail_thread_id | text | Gmail thread ID |
| from_email | text | sender |
| from_name | text | sender display name |
| subject | text | email subject |
| received_at | timestamptz | email date |
| snippet | text | Gmail snippet preview |
| is_test | boolean | default false |
| created_at | timestamptz | row insert time |

RLS: open (matches existing tables' pattern). Unique constraint on `gmail_message_id` prevents duplicates.

### Step 3: Create `poll-gmail` edge function

- Calls Gmail API via connector gateway: `GET /users/me/messages?q=newer_than:1d`
- For each new message, fetches metadata (`format=metadata`)
- Inserts into `gmail_conversations` with `ON CONFLICT (gmail_message_id) DO NOTHING`
- Tracks a high-water mark (latest message timestamp) in the `settings` table (new column `gmail_last_polled_at`) to avoid re-scanning old emails
- Uses `LOVABLE_API_KEY` + `GOOGLE_MAIL_API_KEY` headers for gateway auth

### Step 4: Set up cron to poll every 15 minutes

Add a pg_cron job that invokes the `poll-gmail` edge function every 15 minutes.

### Step 5: Update Conversations page

- Add a **source filter** (Slack / Gmail / All) at the top
- When showing Gmail conversations: display sender, subject, received time, and a "Gmail" badge instead of channel/thread columns
- Both sources in one unified table, sorted by date descending
- Gmail rows link to the Gmail thread in Google (if possible) instead of Slack

### Step 6: Update Stats page

- Add a **source filter** (Slack / Gmail / All)
- Include Gmail volume in the total count and volume chart
- Add a "Gmail" bar/line alongside Slack data for comparison
- Gmail conversations don't have statuses like Slack ones, so they contribute to volume metrics only (not resolution/escalation metrics)

### Step 7: Update flow diagram

Add a new branch node documenting the Gmail polling flow per project knowledge rules.

### Files changed
- `gmail_conversations` table (new, via migration)
- `settings` table (add `gmail_last_polled_at` column, via migration)
- `supabase/functions/poll-gmail/index.ts` (new edge function)
- `src/pages/Conversations.tsx` (add source filter, Gmail rows)
- `src/pages/Stats.tsx` (add source filter, Gmail volume metrics)
- `src/pages/FlowDiagram.tsx` (add Gmail polling node)
- pg_cron job for 15-minute polling

### Notes
- The Gmail connector gateway handles OAuth token refresh automatically
- No user authentication changes needed (existing open RLS pattern)
- Gmail emails are read-only in this integration (no replies from the dashboard)

