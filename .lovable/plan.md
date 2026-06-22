## Changelog page

A new `/changelog` page in the sidebar (bottom utility section, next to Settings/Flow/Knowledge) that lists time-stamped, tagged release notes. Backed by a database table so entries persist and so anyone signed in can add a new entry from the UI without a code change. Seeded with a first batch of entries summarising what we shipped over roughly the last four weeks so the page isn't empty on day one.

### What you'll see

- A "Changelog" item at the bottom of the sidebar (below Knowledge), using a scroll/history icon.
- The page itself, a single reverse-chronological column:
  - Each entry shows a date, a title, a short body (markdown supported), and one or more tags (New / Improved / Fixed / Under the hood).
  - Entries are grouped by month with a sticky month header.
- An "Add entry" button at the top-right of the page that opens a dialog with: date (defaults to today), title, body (textarea, markdown), tag multi-select, and optional "area" free-text (e.g. Inbox v2, Integration health). Save inserts a row and the list refreshes.
- An edit/delete affordance on each entry (pencil + trash icons) for fixing typos after the fact.
- Empty-state copy after the seed is exhausted: "No entries yet — click Add entry to log a change."

### Seed entries (drafted from the last ~4 weeks of work)

I'll draft these from chat + edit history before inserting. Expected buckets, one line each:

- Inbox v2 sandbox page and parallel sync from Intercom (Owner / Product area / Classification).
- Integration health card on Settings now correctly surfaces Intercom auth errors (no longer overwritten by a trailing "ok" write).
- Flow diagram updated to reflect the Inbox v2 sync node.
- CSAT panel and refresh cron.
- Manual contact account normalisation (McKinsey roll-up, lovable.dev filtered from Top accounts).
- Paste-thread date auto-detection and AI subject summary in Log Conversation.
- Pending Intercom links table to close the Gmail/Google Group race.
- Cross-thread link guard alerts in `#enterprise-support-hub-alerts`.

You'll see the full list in the page once seeded and can edit/delete any line that isn't quite right.

### Out of scope (call out so we don't surprise you later)

- No public/marketing changelog or RSS feed — this page is in-app only.
- No automatic generation from git/edit history going forward. New entries are added by you or by me when you ask. We can layer auto-generation on later if you want.
- No email/Slack broadcast of new entries.

---

### Technical details

**Database** (one migration)

- `public.changelog_entries`:
  - `id uuid PK default gen_random_uuid()`
  - `entry_date date not null default current_date` — the user-facing date shown on the entry
  - `title text not null`
  - `body text` — markdown
  - `tags text[] not null default '{}'` — values from `{new, improved, fixed, internal}`
  - `area text` — optional free-text bucket
  - `author_user_id uuid` — `auth.uid()` at insert time, nullable for seed rows
  - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` with the existing `update_updated_at_column` trigger
- Grants: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.changelog_entries TO authenticated; GRANT ALL ON public.changelog_entries TO service_role;` (no anon — page is behind auth like the rest of the app).
- RLS: enable; policies:
  - `SELECT` to `authenticated` (`USING (true)`) — anyone signed in can read.
  - `INSERT / UPDATE / DELETE` to `authenticated` (`USING (true) WITH CHECK (true)`) — matches the trust model of Settings/Knowledge today; we can tighten to an admin role later.
- Index: `CREATE INDEX changelog_entries_date_idx ON public.changelog_entries (entry_date DESC, created_at DESC);`

**Frontend**

- `src/pages/Changelog.tsx` — reads the table via the existing supabase client, groups by month, renders markdown body with `react-markdown` (already in deps; will confirm — if not, fall back to plain text with line breaks).
- `src/components/changelog/AddEntryDialog.tsx` — dialog with the form described above; uses shadcn Dialog/Input/Textarea/Badge components already in the project.
- Route added in `src/App.tsx` at `/changelog`, wrapped in `AppLayout` like the other authenticated pages.
- `src/components/AppLayout.tsx` — append a `Changelog` item (icon: `ScrollText` from lucide-react) to `navItems`, positioned after `Knowledge` so it sits at the bottom of the sidebar.

**Seeding**

- A second data migration (insert tool, not schema migration) inserts the ~8 seed rows with realistic `entry_date` values pulled from chat history dates.

**Docs**

- Append a "Changelog page — `/changelog`" section to `.lovable/project-knowledge.md` describing the table, route, and intent.
- Add a node for the Changelog page on the Flow diagram (Knowledge-style: read-only page, no edge function).

### Open questions I'll assume defaults on unless you say otherwise

- Anyone signed in can add/edit/delete entries (no separate admin role). Say the word if you want to gate to specific users.
- Tags fixed to the four buckets above. Easy to extend.
