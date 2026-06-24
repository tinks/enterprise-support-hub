## Add source icon to Inbox v2

Intercom exposes the ticket origin via `raw_payload.source.type`. In the current sandbox data only two values appear:

- `email` (189) — ticket came in via email (Gmail → Intercom)
- `conversation` (112) — in-app Messenger chat

No Slack-originated tickets land in this enterprise inbox, so we don't need a Slack icon here. (If one ever appears with another `source.type` like `chat`, `push`, `api`, `facebook`, etc., we'll fall back to a generic icon.)

### UI change

In `src/pages/InboxV2.tsx`, next to the Intercom ID cell, render a small icon based on `raw_payload.source.type`:

- `email` → `Mail` icon (lucide-react), tooltip "Email"
- `conversation` → `MessageCircle` icon, tooltip "Messenger chat"
- anything else → `HelpCircle`, tooltip shows the raw `source.type`

Icon: 14px, `text-muted-foreground`, placed immediately before the Intercom ID link, same row.

### Out of scope

- No schema change — we read straight from the existing `raw_payload` JSON.
- No filter/column for source (can add later if useful).
- No changes to sync, classifier, or other pages.

### Docs

Update `.lovable/project-knowledge.md` and the Flow page note for Inbox v2 to mention the source icon, per the standing rule.
