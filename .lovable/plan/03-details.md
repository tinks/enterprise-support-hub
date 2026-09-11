## Behaviour

- New action on the engineering card: **Mark workaround provided**, with a short note field
  (one or two lines, e.g. the manual procedure dev gave). Stores who set it and when.
- Once set:
  - the ticket leaves the `dev_wait` / `dev_resolved` buckets and falls back to the normal
    queue rules (ready for follow-up, waiting on customer, no activity data);
  - `needsChase` returns false, so it drops out of the **Chase due** filter and count;
  - the engineering card still shows the Linear key, title, live state and assignee, plus a
    "Workaround provided" pill, the note, and who/when.
- **Clear workaround** puts it straight back into the dev bucket with the normal cadence.
- Auto re-surface: if the Linear issue moves to Done / Canceled, the ticket returns to
  **Dev resolved / needs action** even while flagged, so a shipped fix is never missed.
- Nothing is written to Intercom or Linear. No reported number changes — the flag is Hub-only
  and lives outside the SLA clocks.

## Technical notes

- Migration: add `dev_workaround_at timestamptz`, `dev_workaround_by text`,
  `dev_workaround_note text` to `public.dev_escalations`. Additive and nullable only.
- `src/lib/devEscalation.ts`: extend `DevEscalation`; add `hasWorkaround(esc)`; make
  `needsChase` return false when a workaround is set and the issue is not done.
- `src/pages/MyQueue.tsx`: bucket derivation skips the dev buckets when `hasWorkaround(esc)`
  and `!isDevDone(esc)`; add the workaround pill to the row badges; add the set/clear control
  and note field to the engineering card in the detail panel; include the three new columns in
  the escalation select.
- Doc pass afterwards: Flow page node, `.lovable/project-knowledge.md` via **Sync from app**,
  and a `changelog_entries` row.

## Verification

- Set the flag on 215475214997973, confirm it leaves **Waiting on dev** and **Chase due** while
  the CLO-1074 card and link stay visible.
- Clear it, confirm the bucket and 24h cadence come back.
- Negative case: a flagged escalation whose Linear state flips to Done must appear under
  **Dev resolved / needs action** — verified by temporarily reading a done escalation, not assumed.
