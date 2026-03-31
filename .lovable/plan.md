

## Show conversation ID in recent conversations table

### Change
Add a `#` (ID) column as the first data column in the conversations table, displaying a truncated UUID for each row.

### File: `src/pages/Conversations.tsx`

1. Add a new `<TableHead>` as the first column: `#`
2. For both Slack and Gmail rows, add a `<TableCell>` displaying the first 8 characters of the ID in a monospace font:
   ```tsx
   <TableCell className="text-xs text-muted-foreground font-mono">
     {m.id.slice(0, 8)}
   </TableCell>
   ```
3. Same pattern for Gmail rows using `g.id.slice(0, 8)`

No other files need changes — this is a display-only addition.

