## Technical detail

**1. Notion connection**
Link a Notion App connector to this project (connect card; the workspace already has Notion connections, but this project has none linked). Calls go through the Lovable connector gateway at `connector-gateway.lovable.dev/notion/v1` with `LOVABLE_API_KEY` + `NOTION_API_KEY` — server-side only, from the edge function.

The target page id is stored in `public.settings` (`notion_registry_page_id`), editable from the UI — no hardcoded id. You create the page in Notion, share it with both the Lovable Notion integration and Parahelp, and paste its id/URL into the Hub.

**2. Edge function** — `publish-registry-notion`
- Reads `v3_customer_accounts`, filters to `status = 'active'` and `is_test = false`, unnests `domains`, lowercases, de-duplicates, sorts.
- Renders a single Notion table: `Domain | Account | Tier`, one row per domain, preceded by one paragraph line: `Source: Enterprise Support Hub customer registry — last synced <UTC timestamp> — N domains.`
- Computes a SHA-256 of the sorted domain list. If it matches the stored hash (`settings.notion_registry_hash`), it exits `{ changed: false }` without touching Notion.
- On change: deletes the page's existing child blocks and appends the freshly rendered ones (full rewrite — no partial diffing, so the page can never drift), then stores the new hash.
- Records health under a new `notion_registry_publish` key, so a broken Notion token or revoked page access surfaces in Settings → Integration health rather than silently stalling.
- Accepts `{ dryRun: true }` to render and return the payload plus the change verdict without writing — this is how the first run gets verified.

**3. Schedule + manual trigger**
`pg_cron` daily at 05:00 UTC (after the 04:00 closed-won poll and the 04:30 Parahelp queue job, so a same-morning closed-won win lands on the page the same morning). Plus a **Sync to Notion** button on the Parahelp routing tab showing last sync time, domain count, and whether the last run changed anything.

**4. Scope calls made explicit**
- `inactive` and `prospect` accounts are excluded — Parahelp routes enterprise mail, and a churned or unsigned domain should not route.
- `is_test` accounts excluded.
- Aliases column is not published (it holds account-name variants, not mail domains).
- Removals propagate: a domain deleted in the registry disappears from the page. Parahelp still has to approve any resulting removal on their side — that's their process, not ours.

**5. Docs pass**
`.lovable/project-knowledge.md` via `sync-knowledge-pending` (pending, not live), a `changelog_entries` row, and the Notion node added to `FlowDiagram.tsx` on the closed-won chain.

## Build order

Connect Notion → settings field + UI → edge function with `dryRun` → verify the dry run output against a live `count(distinct domain)` query → first real write → confirm the page renders → cron → docs pass.

## What I need from you

1. Approval to link a Notion connection to this project.
2. The Notion page (created and shared with Parahelp per their instructions) — or say the word and I'll have the function create the page under a parent page you name.
3. Confirm the exclusion rules above, particularly the single `prospect` account.
