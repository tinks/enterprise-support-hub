

## Improve Channel Browsing UX

The current "Browse" button opens a dialog listing all Slack channels, but it only adds channel IDs (not names), doesn't show which channels are already monitored, and doesn't allow removing channels. Let's make this a proper multi-select experience.

### Changes to `src/pages/Index.tsx`

1. **Show monitored channels as removable chips/badges** instead of a raw comma-separated text input:
   - Parse `monitored_channels` into an array of IDs
   - For each ID, resolve the channel name (from cached channel list or show the ID)
   - Render as `Badge` components with an `X` button to remove

2. **In the Browse dialog, show checkboxes** next to each channel:
   - Pre-check channels that are already in `monitored_channels`
   - Allow toggling multiple channels on/off without closing the dialog
   - Add a "Done" button to close

3. **Keep the raw input as a fallback** (collapsible or secondary) for manual entry of channel IDs

4. **Cache channel names** — when channels are fetched, store a `Map<id, name>` in state so the chips can show `#channel-name` instead of raw IDs

### UI Layout

```text
Monitored Channels
┌──────────────────────────────────────────────┐
│ [#general ×] [#support ×] [#bugs ×]  [+ Browse] │
└──────────────────────────────────────────────┘

Browse Dialog:
┌─────────────────────────────┐
│ Search channels...          │
│ ☑ #general         C123... │
│ ☑ #support         C456... │
│ ☐ #engineering     C789... │
│ ☐ #random          C012... │
│              [Done]         │
└─────────────────────────────┘
```

### Technical Details

- Store a `channelNameMap: Record<string, string>` in component state, populated when Browse is opened
- On first load, also try to resolve existing channel IDs by fetching the channel list in the background
- `selectChannel` toggles instead of only adding
- Keep saving as comma-separated IDs to the `settings` table (no schema change needed)

