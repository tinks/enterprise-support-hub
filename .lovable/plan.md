

## Fix: Missing line breaks in Intercom → Slack message rendering

### Problem
Line 267 in `intercom-webhook/index.ts` strips HTML with a naive `.replace(/<[^>]*>/g, "")`. Intercom sends replies as HTML with `<p>`, `<br>`, `<li>` tags etc. Stripping all tags without converting block-level elements to newlines first causes paragraphs to merge together — exactly what the screenshot shows.

### Fix — `supabase/functions/intercom-webhook/index.ts`

Replace line 267's single regex with proper HTML-to-text conversion:

```typescript
replyText = (lastPart.body || "")
  .replace(/<br\s*\/?>/gi, "\n")           // <br> → newline
  .replace(/<\/p>/gi, "\n\n")              // </p> → double newline (paragraph break)
  .replace(/<\/li>/gi, "\n")               // </li> → newline
  .replace(/<li[^>]*>/gi, "• ")            // <li> → bullet
  .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")    // list wrappers → newline
  .replace(/<[^>]*>/g, "")                 // strip remaining tags
  .replace(/\n{3,}/g, "\n\n")             // collapse excessive newlines
  .trim();
```

This ensures `<p>` blocks become visually separated paragraphs and `<br>` tags become line breaks in Slack's mrkdwn rendering.

### Scope
One file, one line change (line 267). No schema changes.

