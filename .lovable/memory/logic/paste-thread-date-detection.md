---
name: Paste-thread date detection
description: Log conversation paste mode auto-fills Thread date from pasted text via detectThreadDate() regex helper
type: feature
---

`src/lib/parseThread.ts` exports `detectThreadDate(raw, now?)` — pure regex scan for a date signal in pasted Slack/Teams content, in priority order:
1. Full `M/D/YYYY` (Teams)
2. Month-name + day + explicit year (`March 26, 2025`)
3. Month-name + day, no year — uses current year; rolls back 1y if result is in the future
4. Slack relative markers `Today at …` / `Yesterday at …`

`ManualLogTab.handleParse()` calls it after a successful parse and pre-fills `threadDate` only if empty. UI shows "Auto-detected from paste — edit if wrong." Manual edits of the picker clear the auto flag. Reset clears both. No AI call.
