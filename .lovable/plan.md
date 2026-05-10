## What

The Top Slack channels panel in Insights → Report shows raw channel IDs for 4 external Slack-Connect channels instead of human names. I resolved them via `conversations.info`:

| ID | Channel name |
|---|---|
| `C08Q0B29A79` | `ext-hubspot-lovable` |
| `C0970Q752E8` | `uber-lovable-external` |
| `C09ATLCF9LK` | `paymentology-lovable` |
| `C0A6PSTENRM` | `autodesk-lovable` |

## Change

Append these 4 entries to the existing `channelNameOverrides` map in `src/lib/channelOverrides.ts`. This is the established pattern (`McKinsey`, `workday-lovable`, etc. are already in there) and `ReportTab.tsx` already applies the overrides on top of API results, so they'll render correctly everywhere channel names are shown.

## Files
- `src/lib/channelOverrides.ts` — add 4 entries

No business-logic changes, no schema changes, no edge-function redeploys.
