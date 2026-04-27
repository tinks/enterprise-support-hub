## Goal

Let users **manually backdate the resolution time** of any conversation from the detail page, so analytics reflect when the work actually wrapped up — not when someone remembered to click "Resolve".

## Where this lives

The Conversation detail page (`/conversations/:id`) already has a Timeline card on the right rail with editable `Created` dates (uses `EditableDateCell` + `handleDateChange`). I'll extend that same pattern to `Resolved`.

## Changes — `src/pages/ConversationDetail.tsx`

### 1. Make the Resolved row always visible and editable

Currently the "Resolved" row only renders when `resolved_at` is set, and is read-only. Update `renderDates()` so:

- For all three sources (slack / gmail / manual) the Timeline always includes a **Resolved** row.
- When `resolved_at` is set → editable date cell (same UX as Created).
- When `resolved_at` is null → a small "Set resolved time" button that opens the same date picker.
- Add the missing `resolved_at` push for the `manual` branch (it was never rendered, even when set).

### 2. Generalize `handleDateChange` to handle either field

Take a `field: "created_at" | "resolved_at"` argument. The existing `created_at` callsite stays the same; the new resolved-cell calls it with `"resolved_at"`.

### 3. Auto-flip status to `resolved` when a resolved date is set

If the user picks a resolved date and `status !== "resolved"`, also update `status = "resolved"` in the same write. This is the whole point — backdating closes the ticket so it stops being counted as open.

If the user **clears** the resolved date (separate "Clear" button on the editable cell when set), revert `status` back to a sensible value: `active` for slack/manual, `open` for gmail (matches existing reset logic in `updateStatus`).

### 4. Audit + toast + optimistic update

Audit log entry: `"updated_resolved_at"` with old → new (or `"cleared"`). Toast: "Resolution time updated". Optimistic local state update so the UI reflects immediately (mirrors `handleDateChange` for created_at).

### 5. Minor: extend `EditableDateCell` with an optional Clear button

Add an optional `onClear?: () => void` prop. When present, render a small "Clear" link next to the time input inside the popover. Used only by the Resolved cell, not Created.

## What's intentionally NOT changing

- **Inbox table** — no inline resolved-date editor in the table; this stays a detail-page action to avoid accidental clicks (and there's no good column for it). The existing "mark resolved" status dropdown still works for "I'm closing this right now."
- **Analytics math** — `Stats.tsx` already computes resolution time as `resolved_at - created_at`. No formula changes; just better data flowing in.
- **Sync to Intercom/Gmail/Slack** — manually setting a resolved time is **local only** and does not close the upstream Intercom conversation, Gmail thread, or Slack mapping. Closing upstream is a different action with side effects (Slack reactions, Intercom assignee credit, etc.) and would surprise users. I'll add a small inline note under the picker: *"Local resolution time only — does not close the ticket in Intercom."*
- **Bulk backdating** — out of scope; ask if you want it later.

## Memory

Add a short note to `mem://logic/resolution-sync` (or a sibling) recording that resolved_at is now manually editable on the detail page, that it auto-flips status to resolved, and that it is intentionally local-only (no upstream close).
