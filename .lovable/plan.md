

## Add Teams thread parsing and SAP channel option

### Problem
The thread parser only handles Slack copy formats. Microsoft Teams threads have a different format (e.g. `Name 3/26/2025 11:03 AM` or similar). Also, "SAP" needs to be available as a channel name option.

### Changes

**`src/lib/parseThread.ts`** — add Format D for Teams threads
- Teams copied threads typically look like: `Name  3/26/2025 11:03 AM` or `Name  March 26, 2025 11:03 AM`
- Add a new regex format that matches name followed by a date+time pattern (MM/DD/YYYY or month name + date + year)
- This runs after Slack formats A–C, before the AI fallback
- Regex: `/^(.+?)\s{2,}(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm`
- Also handle `Name sent the following message at HH:MM AM` and other Teams variants via the existing AI fallback

**`src/components/ManualLogTab.tsx`** — add source options
- Add "SAP" to the source dropdown options
- Add "teams" if not already present
- Update the paste mode to store source as `"teams_thread"` when channel looks like a Teams thread, or keep `"slack_thread"` — actually simpler: let the user pick source in paste mode too, defaulting based on channel name

**`src/pages/FlowDiagram.tsx`** — note Teams parsing support

### Technical details

**Format D regex** (Teams date+time):
```
/^(.+?)\s{2,}(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*$/gm
```

The AI fallback (`parseThreadWithAI`) already handles arbitrary formats since it uses an LLM — so even unusual Teams formats will work. Format D just makes the common case fast and free.

For SAP: simply add `"sap"` to the source `<Select>` options in ManualLogTab alongside the existing `"teams"`, `"slack"`, `"intercom"`, `"email"`, `"other"`.

### Files to edit
- `src/lib/parseThread.ts` — add Format D for Teams
- `src/components/ManualLogTab.tsx` — add SAP source option
- `src/pages/FlowDiagram.tsx` — note Teams parsing

