## Goal

Make "Log conversation → Paste thread" auto-detect the conversation date from the pasted content, so the Thread date field is pre-filled instead of needing manual entry. Manual override stays available.

## Current behavior

- The Thread date picker is empty by default and required before save.
- `parseThread()` extracts each message's raw timestamp string (`1:47 PM`, `Mar 26th at 11:03 AM`, `3/26/2025 11:03 AM`).
- `combineDateTime()` combines that string with the picked Thread date:
  - Full date format → uses date from the paste
  - Month-day format → uses current year
  - Time-only → uses the picked Thread date (or today)

So today, time-only Slack copies always need manual date entry.

## Plan

### 1. Add `detectThreadDate()` helper in `src/lib/parseThread.ts`

Scans the raw pasted text for the first usable date signal (in priority order):

1. **Full date** like `3/26/2025 11:03 AM` (Teams paste) → return that date.
2. **Month-day** like `Mar 26th at 11:03 AM` (Slack older messages) → return `Month Day, current-year`. If the resulting date is in the future, roll back one year.
3. **Slack "Yesterday at 5:43 PM" / "Today at 1:47 PM"** → today / today − 1 day.
4. **Date headers Slack inserts between messages** like `Wednesday, March 26th` or `March 26, 2025` → parse and return.
5. Otherwise `undefined`.

Pure function, unit-testable, no side effects.

### 2. Wire into `ManualLogTab.tsx` paste flow

In `handleParse()`:
- After successful parse, call `detectThreadDate(rawThread)`.
- If it returns a date AND `threadDate` is still empty, set it and toast: "Detected thread date: <formatted>".
- If detection fails, keep current behavior (user picks manually).
- Never overwrite a date the user has already chosen.

Also: when the user edits the textarea after a detected date, do not clear the date (treat detection as a one-shot assist).

### 3. Surface detection in the UI

- Under the Thread date picker, add small muted helper text:
  - When auto-detected: "Auto-detected from paste — edit if wrong."
  - When empty: existing behavior.

### 4. Keep existing fallback

`combineDateTime()` and per-message timestamps stay unchanged. The auto-detected Thread date simply becomes the base date for time-only headers, same as a manually picked one.

### 5. Out of scope

- No AI call for date detection — regex only, to stay instant and free. The existing AI parse fallback (`parse-thread` edge function) is untouched.
- No schema changes; `manual_conversations.created_at` is still set from the earliest message timestamp as today.
- No changes to Gmail/Slack/Intercom import paths.

## Files touched

- `src/lib/parseThread.ts` — add and export `detectThreadDate()`.
- `src/components/ManualLogTab.tsx` — call it in `handleParse`, add helper text.
- `.lovable/project-knowledge.md` + Flow page note: "Paste thread auto-detects date from full-date, month-day, and Today/Yesterday markers; manual picker overrides."
- New memory leaf `mem://logic/paste-thread-date-detection`.
