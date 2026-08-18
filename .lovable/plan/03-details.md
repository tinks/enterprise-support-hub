## Build steps

**Step 1 — schema (one migration)**

- `public.severity_rubric_versions` — `id`, `version int`, `body text`, `status ('draft'|'active'|'retired')`, `label`, `created_by`, timestamps. Exactly one `active` row. Seeded with a placeholder until the Notion text is pasted in.
- `public.severity_proposals` — `id`, `intercom_conversation_id`, `pass ('triage'|'reclassify')`, `proposed_severity smallint (1..4)`, `confidence ('high'|'medium'|'low')`, `rationale text`, `evidence text`, `rubric_version int`, `model text`, `input_chars int`, `input_tokens int`, `output_tokens int`, `content_hash text`, `status ('proposed'|'accepted'|'overridden'|'superseded')`, `final_severity smallint`, `decided_by uuid`, `decided_at`, `created_at`. Unique on `(intercom_conversation_id, content_hash)`.
- RLS: read for `authenticated`; writes only via `service_role` (the edge function) except the decision columns, which are gated by `public.can_edit()`. Rubric edits gated by `has_role(auth.uid(),'admin')`. GRANTs alongside each table.
- `settings`: add `severity_ai_enabled boolean default true`, `severity_ai_daily_call_cap int default 200`.

**Step 2 — edge function `propose-severity`**

- Input `{ ticketIds: string[] (1..25), pass: 'triage'|'reclassify', force?: boolean }`, guarded by the existing `require-user` + editor guard.
- Loads active rubric, pulls the last ~12 human decisions (mix of accepted and overridden, most recent first) as few-shot examples.
- Fetches the Intercom conversation with `?display_as=plaintext`; triage pass uses only the source message (~4k chars), reclassify uses source + non-note parts (~12k).
- Computes `content_hash` over the truncated input + rubric version; if a proposal already exists for that hash and `force` is not set, skips without calling the model.
- Calls the Lovable AI gateway (`google/gemini-3-flash-preview`) with a strict tool schema: `{ severity: 1|2|3|4, confidence, rationale (<=200 chars), evidence }`. Refuses if the daily call count exceeds the cap. Gateway 402/429/5xx are surfaced verbatim, never swallowed.
- Writes the proposal row and marks any earlier proposal for that ticket `superseded`. Writes an `integration_health` key `severity_ai` on success/failure.

**Step 3 — Triage / Inbox v3 UI**

- New `SeverityProposalCard` rendered directly above the existing `SeverityWriteControl` in `IssueDetailSheet`: proposed badge, confidence chip, rationale, rubric version, and "proposed from limited info" vs "re-scored with full thread".
- **Accept** → calls `esh-write-action` `set_severity` with the proposed value; only on Intercom acceptance does the proposal flip to `accepted`. **Set a different value** → the existing control, and on success the proposal is stamped `overridden` with `final_severity`.
- A "Propose severity" button (single ticket) and a toolbar "Propose for visible" (capped at 25, skips tickets that already have a current-hash proposal).
- Read-only accounts see the proposal but no buttons (`useCanEdit`).

**Step 4 — `/severity-ai` calibration page (admin)**

- Rubric editor (versioned; saving creates a new version and retires the old).
- Agreement rate over a date window, 4×4 proposed-vs-final matrix, off-by-one vs off-by-two split.
- Disagreement list with rationale and links to Intercom, so rubric edits are driven by real cases.
- Cost panel: calls, tokens, and calls-per-day against the cap.

**Step 5 — nightly cron (ships disabled)**

`pg_cron` entry calling `propose-severity` with `pass: 'reclassify'` over open tickets changed since their last proposal, hard-capped per run. Created in a disabled state; enable only after cost data exists.

## Notes and boundaries

- No change to `esh-write-action`'s allowlist, kill switch, or conflict checking — accept goes through the existing path unchanged.
- No change to `v3_derive_customer`, the SLA engine, or triage-time computation. The triage queue keeps ranking by age; the proposal is decoration on the detail sheet.
- Docs pass per convention: `.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node.
- Verification before "done": one live proposal on a real ticket, one accept that lands in Intercom, one override recorded, one refusal (cap exceeded), and the unchanged-hash skip proven. Anything not exercised gets named UNVERIFIED.
