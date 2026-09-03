## How it gets built

### 1. Remix and confirm isolation

You remix the project from the editor (project menu, ten seconds). First action in the remix: verify it has its own backend, not a pointer to this one. Nothing destructive runs until that comes back clean.

### 2. Purge

Delete every fixture or seed file holding real people, then wipe the data tables through the seeder rather than ad-hoc SQL. Sweep for leftovers: real names, real emails, real domains, internal chat/doc links, customer names in report copy, office locations. Database column names that reference a vendor stay — they are schema, not something the audience sees.

### 3. Deterministic generator

One module producing the whole dataset from a seeded PRNG, so the demo looks identical every run and screenshots stay stable. It plants the edge cases the Hub exists to surface — the reconciliation screens are pointless with nothing to reconcile:

- breached and near-breach SLA tickets across plan tiers
- tickets that sat in engineering wait, with linked issue-tracker records
- reopened tickets that prove the four-way clock split
- unattributed customers plus channel proposals awaiting confirmation
- a spread of CSAT ratings, including two flagged as internal
- open dev escalations and untriaged tickets for the Action Center

Volumes sized so Analytics, Trend, and Monthly lookback all have several months of movement to show.

### 4. Reset button

A wipe/seed core shared by an admin-gated reset function and a CLI script, plus a "Demo data" card showing current counts and last reset. If a live demo goes sideways, one click puts it back.

### 5. Mock the connectors

Helpdesk, chat, issue tracker, email, and the AI severity proposer keep their exported signatures and return shapes but build payloads from the generator instead of calling out. Vendor secrets get deleted from the remix. Every button stays alive.

### 6. Genericize

Company, teammates, customer accounts, product areas, inbox names, vendor labels, page titles and head metadata all move to neutral equivalents. Sam becomes a generically-named AI agent.

### 7. Presenter overlay

Global shortcut opens a per-page card: what this screen does, the problem it solves, the time it saves, why the approach is defensible. Written so the audience reading over your shoulder sees product context, not a sales script.

### 8. Open the demo up

Sign-in stays, but the domain restriction is dropped and the viewer role is auto-granted on first sign-in so you never land in the approval queue mid-demo. Safe only because every row is fake — noted as such in a code comment.

### 9. Audit gate, then publish

Not "seeding finished" — a written pass/fail:

- leak greps come back clean
- seed to reset round trip returns identical row counts
- a throwaway signup gets a session, the role, and full data under RLS
- a scripted walk of every demo route at 1280 and at ultrawide, screenshots reviewed, no empty states, no console errors, no leftover internal vocabulary on screen

Result lands in a `demo-readiness.md` document with the evidence. Publish only on a fully green file.

## Technical notes

- All work happens in the remix; this project's code, data, and secrets are read-only reference.
- Generator is a single module with a mulberry32-style seeded PRNG — never `Math.random()`, so runs are reproducible.
- Seeding respects the real schema: generated columns unwritten, CHECK constraints honoured, foreign keys inserted parent-first; the wipe goes children-first and nulls self-references. Append-only audit tables with delete-blocking triggers are excluded.
- Responsiveness and four-way clock columns get computed by the existing finalize path or the existing backfill functions against seeded payloads, so the demo's numbers come from the real engine rather than being hand-written.
- Routes outside the core story are removed from the nav rather than deleted, keeping the diff small and reversible.

## What this plan does not do

No case-study slide, no scorecard of real usage metrics, no changes to this project. If you later want a deck slide linking the published demo, that is a separate pass.
