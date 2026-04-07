

## Fix `import-intercom-ticket` missing `stripHtml` function

### Problem
The edge function crashes with `ReferenceError: stripHtml is not defined` because the code references `stripHtml()` (added when message extraction was implemented) but the function was never defined in the file.

### Fix
Add the `stripHtml` helper function to `supabase/functions/import-intercom-ticket/index.ts`, before the `Deno.serve()` call. Same implementation used in `search-intercom-by-email`:

```ts
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
```

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`

