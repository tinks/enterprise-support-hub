

## Toggle "Select All" Behavior for Channels Filter

### What Changes

Make the "Select all" button act as a toggle: if all channels are already selected, clicking it deselects all; otherwise, it selects all.

### Technical Details

**File: `src/pages/Stats.tsx`** — Lines 378-384

Replace the two separate buttons with a single toggle button:

```tsx
<div className="border-t p-1.5 flex gap-1">
  <Button
    variant="ghost"
    size="sm"
    className="flex-1 text-xs"
    onClick={() => {
      if (selectedChannels.length === allChannelIds.length) {
        setSelectedChannels([]);
      } else {
        setSelectedChannels([...allChannelIds]);
      }
    }}
  >
    {selectedChannels.length === allChannelIds.length ? "Deselect all" : "Select all"}
  </Button>
</div>
```

Remove the separate "Clear" button since the toggle handles both states.

