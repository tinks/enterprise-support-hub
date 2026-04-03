

## Highlight unactioned conversations (no owner assigned)

### Approach
A conversation is "new / unactioned" when its `owner` field is `null` — meaning neither Joel nor Kristina has claimed it yet. This is already tracked in all three conversation tables, so no database changes are needed.

### What changes

**`src/pages/Conversations.tsx`**

Add a subtle left-border highlight and light background tint to every `TableRow` where `owner` is null:

- Slack rows (line ~1381): add a colored left border and faint background when `m.owner` is null
- Gmail rows (line ~1400): same check on `g.owner`
- Manual rows (line ~1436): same check on `mc.owner`

The styling will be a 3px left border in the primary/coral color plus a very faint coral background tint, e.g.:
```
border-l-3 border-primary/70 bg-primary/5
```

This makes unactioned rows clearly stand out without being overwhelming. When someone sets an owner, the highlight disappears automatically.

### Files to edit
- `src/pages/Conversations.tsx`

