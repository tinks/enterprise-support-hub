-- Import the canonical Notion feeder rubric ("Locked v2, 2026-07-21") as rubric version 2 and activate it.
UPDATE public.severity_rubric_versions SET status = 'retired' WHERE status = 'active';

INSERT INTO public.severity_rubric_versions (version, body, status, label)
VALUES (
  2,
  $rubric$Source: Notion — "Severity Rubric — Rules & Worked Examples (Feeder)" (Locked v2, 2026-07-21). Imported 2026-08-18.

## Core tiers
- Sev 1 — Critical: core/production functionality down, no workaround, or a security risk.
- Sev 2 — Major: functionality reduced, but a workaround exists or impact is contained to non-core.
- Sev 3 — Minor: isolated fault that does not affect daily use.
- Sev 4 — Trivial: not a fault — question / config request / feature ask / cosmetic (no SLA).

## Clarifying rules
Rule A — the "production down" carve-out (Sev 1 vs 2). Unavailable != automatically Sev 1. A recoverable pause / block where data is intact and restorable = Sev 2. Reserve Sev 1 for unrecoverable outage, data loss / no restore path, or a security risk.

Rule B — SCOPE drives severity. Severity scales with blast radius, for any "can't do X" (access, SSO, publishing, etc.):
- One user affected -> Minor (Sev 3).
- A team / subset -> Major (Sev 2).
- Entire org / all users -> Major (Sev 2) — or Critical (Sev 1) if it also meets Rule A (data loss / unrecoverable / no workaround).

Rule C — triage provisional, then curate (scope is often unknown at the door). When blast radius is not yet known, triage conservatively (often Sev 2), then downgrade to Sev 3 once you confirm it is a single user / isolated — or upgrade if it turns out org-wide. Expect a lot of "Initial Sev 2 -> Working Sev 3." Always rate on confirmed reality, not the customer's alarm.

Rule D — questions & config = Sev 4. Nothing is broken — a request for education/information, or a configuration change to a system, is Sev 4 (no SLA).

Scope note: exclude non-Lovable products from this analysis entirely (e.g. the Ask-Lovable bot) — tag enterprise-fyi.

## Worked examples
Sev 1 — Critical (rare)
- Backend down and DB tables empty / possible data loss (...994111803) — unrecoverable + data loss (Rule A).

Sev 2 — Major
- Cloud project "paused," credits restored, data intact (...989310028) — whole project down but recoverable (Rule A + broad scope).
- Project blocked by a false "out of credits" state post-migration (...989449680) — whole project blocked, recoverable.

Sev 3 — Minor
- "Cloud & AI show disabled" but were enabled (...097735599) — transient glitch, no real impact.
- Cannot locate/access their project, but the site is healthy & live (...013955541) — access-only, service fine -> Minor. (Human had this at 2; the scope rule makes it 3.)

Sev 4 — Trivial
- Credit-limit how-to question (...119771658).
- Procurement / licensing inquiry (...007789953).
- De-link an account config request (...038653003) — the customer feared lost projects, but they were intact (permissions/visibility) -> stays Sev 4 (Rule C: rate on reality).

Rule C in action (the "starts 2, settles 3" pattern):
- SSO "not working for some users" (...005815190) — triaged as a Sev 2 access concern, but it was only a couple of users and their own firewall -> Working Sev 3.
- "Users can't log in" to TP Hub (...130473783) — reported outage, but the backend was actually healthy -> confirmed reality kept it Sev 3.

## Why severity is mutable (lifecycle connection)
Rule C is the case for treating severity as a lifecycle value, not set-and-forget:
- Scope is often unknown at intake -> start conservative and curate as data confirms.
- The system should snapshot the INITIAL severity (immutable) and keep the curated CURRENT/finalized value, plus the change trail.
- Leadership concern: a ticket first called Sev 3 that then misses the finalized Sev SLA was really higher all along — keeping both values lets us report compliance by initial AND final and flag the drift (and stops a retroactive downgrade from hiding a breach).
- The AI intake classifier fills the initial-severity gap (it will often suggest Sev 2 on unknown scope — human curates down to 3). AI recommends, human overrides.$rubric$,
  'active',
  'Notion feeder — Locked v2 (2026-07-21)'
);

INSERT INTO public.esh_backlog_items (title, description, category, status, priority, area, source)
VALUES (
  'Auto-sync severity rubric from Notion',
  'Link the Enterprise Support Hub Notion connection to the project and add a Pull from Notion action on /severity-ai that fetches the Severity Rubric feeder page via the connector gateway, diffs it against the active rubric, and stages a new rubric version for human activation. Blocked today: both Enterprise Support Hub Notion connections show linkable=no (project owner lacks access). Rubric v2 was imported manually on 2026-08-18.',
  'feature_request',
  'open',
  'med',
  'Severity AI',
  'agent'
);