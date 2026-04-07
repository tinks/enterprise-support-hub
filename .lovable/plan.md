

## Support additional Slack thread copy formats in parser

### Problem
The parser only handles the `Name [HH:MM AM/PM]` format (copied from Slack's in-app thread view). But Slack also produces a multi-line format when copying from the sidebar or email digests:

```
Akshat Saneja
  Mar 26th at 11:03 AM
message text here
```

This format has the name on one line and the timestamp on the next (indented, with full date like `Mar 26th at 11:03 AM`). The current regex doesn't match it.

### Solution

**`src/components/ManualLogTab.tsx`** — Update `parseThread()` to support both formats:

1. **Format A** (existing): `Name  [HH:MM AM/PM]` — single line
2. **Format B** (new): Name on one line, then `  Mon DDth at HH:MM AM/PM` on the next line

The parser will first try Format A. If it finds zero matches, it tries Format B using a regex like:
```
/^(\S.+)\n\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?\s+at\s+(\d{1,2}:\d{2}\s?(?:AM|PM))/gm
```

Also strip `N replies` lines and `@mentions` cleanup in both paths.

### Files to edit
- `src/components/ManualLogTab.tsx`

