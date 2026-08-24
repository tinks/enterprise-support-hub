## Build steps

**1. Migration (additive only).** Add to `public.intercom_tickets_v3`:
`subject_override text`, `subject_override_by uuid`, `subject_override_at timestamptz`.
All nullable, no default, no change to `subject`. Existing update policies already gate
writes to editors, so no policy churn beyond allowing these columns to be updated by the
same editor path.

**2. Shared display helper** — `src/lib/subjectDisplay.ts`:
`displaySubject(row)` returns `subject_override ?? subject ?? "Untitled"`, plus
`isSubjectOverridden(row)` and `originalSubject(row)` so the UI can show the Intercom
value in a tooltip. One helper, imported everywhere, so the rule cannot drift per page.

**3. Editing.**
- `TicketFieldsPanel` gains a `subject` field: a text input pre-filled with the current
  effective subject, included in the single **Update** action. Unlike the other fields it
  writes straight to the Hub table (no `esh-write-action` call, because Intercom is not
  involved) and shows the same per-field result line. A **Clear override** control appears
  when an override exists.
- `subjectColumn` in `src/components/issues/issueColumns.tsx` becomes optionally editable:
  click the cell, type, Enter saves / Escape cancels, gated on `useCanEdit()`. Wired for
  Triage, Inbox v3, Prospects and Escalations.

**4. Read-side sweep.** Every place that selects `subject` from `intercom_tickets_v3` also
selects the override columns and renders through the helper: `Triage`, `InboxV3` (table,
detail sheet title, CSV export), `Prospects`, `Escalations`, `SlaWorkbench` and the SLA
report/dashboard via `useSlaBatch`, `CustomerReport`, and the Action Center signal rows in
`src/lib/actionSignals.ts`.

**5. Audit.** Each set/clear writes a `conversation_audit_logs` row
(`action: 'subject_override'`, old and new value, actor).

**6. Paperwork.** Flow node text, `.lovable/project-knowledge.md` via
`sync-knowledge-pending` (staged for your approval, never written live), and a
`changelog_entries` row.

## Boundaries and known gaps

- **SLA channel inference untouched.** `slaMetrics.ts` reads the subject off
  `raw_payload.source`, not the mirrored column, so the override cannot change how a
  ticket is classified as email vs messenger. Verified: that is the only measurement path
  that looks at a subject.
- **The Customers unattributed queue is a named exception.** Its rows come from
  `SECURITY DEFINER` RPCs (`v3_no_signal_tickets`, `v3_personal_unlabeled_tickets`,
  `v3_tickets_for_channel`) that return `subject` directly from SQL. Those keep showing the
  raw Intercom subject in this step; extending the RPCs is a small follow-up, called out
  rather than silently skipped.
- **Severity eval sampling** (`v3_severity_eval_sample`) also returns the raw subject.
  Left as-is on purpose: eval inputs should reflect what the model actually saw, not a
  later human relabel.
- **Legacy sources unchanged.** `manual_conversations`, `gmail_conversations` and Inbox v2
  keep their own subject handling; this is a v3-only change.

## Verification before I call it done

- Set an override on `215474865211089`, confirm it renders in Triage, Inbox v3, the detail
  sheet title, and the CSV export, and that the Intercom subject is still readable.
- Run a v3 open sync afterwards and re-read the row to prove the override survived and
  `subject` still tracks Intercom.
- Clear the override and confirm the display falls back to `Intercom #215474865211089`.
- Confirm a read-only account sees the text with no editable control.
