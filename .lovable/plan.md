

## Add channel override for C09A5GSHDGQ

**1. Update `src/lib/channelOverrides.ts`**
Add `C09A5GSHDGQ: "ext-bts-lovable"` to the overrides map.

**2. Update project knowledge**
Add this channel ID to the knowledge document's channel overrides section so it's remembered permanently.

No other changes needed — Conversations and Stats pages already consume `channelOverrides` for display.

