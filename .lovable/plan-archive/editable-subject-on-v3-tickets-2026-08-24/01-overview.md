# Editable subject on v3 tickets

## The problem

Intercom does not always produce a meaningful title. Ticket `215474865211089` has the
subject `Intercom #215474865211089` — verified in the database, where both the stored
`subject` and the raw Intercom `title` are empty/placeholder. Every Hub surface that lists
tickets therefore shows a title that identifies nothing.

The synced `subject` column cannot simply be edited: every sync run rewrites it from
Intercom, so a hand-typed value would silently disappear on the next poll.

## What gets built

A **Hub-only subject override**, stored beside the synced subject and never sent to
Intercom. The original Intercom subject is preserved and stays visible, so an override is
always a label, never a rewrite of source truth.

- A new nullable override column on the v3 ticket table, with who set it and when.
- One shared display rule: **override if present, otherwise the Intercom subject,
  otherwise "Untitled"** — used by every surface, so the Hub never shows two different
  titles for one ticket.
- Editing in two places, both editor-gated (read-only accounts see the text, no control):
  - the consolidated **Update** panel in the Triage and Inbox v3 detail sheets, alongside
    severity, owner, product area and ticket type;
  - **click-to-edit directly in the Subject cell** of the issue tables, the same
    interaction the escalations board already uses for Hub state.
- A visible marker on overridden rows (a small "edited" hint with the original Intercom
  subject on hover) plus a one-click **Clear override** to fall back to Intercom's value.
- Every set and clear is written to the existing conversation audit log, with the old and
  new value.

## What deliberately does not change

- **Intercom is not written to.** No new write-through action, no allowlist change; the
  existing `esh-write-action` path is untouched.
- **The SLA engine keeps reading the raw Intercom subject.** It uses the presence of a
  source subject to infer whether a ticket arrived by email or messenger, so an
  operator-typed label must never feed that inference.
- **Sync functions are untouched.** They keep writing `subject`; the override lives in its
  own column, so nothing can overwrite it.
