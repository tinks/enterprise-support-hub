

## Add email format validation to the "Add Details" modal

### Current state
The modal uses `plain_text_input` for the email field (line 718) with no validation. Users can submit any string — typos, random text, etc. — which then gets passed to Intercom's contact search/create. Invalid emails cause silent failures or create junk contacts.

### Fix
Slack's Block Kit supports an `email_text_input` element type instead of `plain_text_input`. This gives native email format validation in the Slack UI itself — Slack will show an error and block submission if the format is invalid.

### Change — `supabase/functions/slack-interactions/index.ts`

**Line 718**: Change `type: "plain_text_input"` to `type: "email_text_input"` in the email block element. That's the only change needed — Slack handles the rest client-side.

```typescript
element: {
  type: "email_text_input",  // was: "plain_text_input"
  action_id: "email_input",
  placeholder: { type: "plain_text", text: "your@email.com" },
},
```

One line change, one file.

