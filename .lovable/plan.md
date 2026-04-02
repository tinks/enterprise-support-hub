

## Import Intercom tickets by URL

### What it does
Adds a second import card on the Import page for pasting Intercom conversation/ticket URLs. It extracts the conversation ID from the URL, fetches basic details (contact name, subject/title) from the Intercom API via a new edge function, and creates a `manual_conversation` entry pre-linked to the Intercom conversation ID.

### How it works

1. User pastes an Intercom URL like `https://app.intercom.com/.../conversation/215473724302724`
2. The conversation ID (`215473724302724`) is extracted from the URL
3. A new edge function calls the Intercom API to fetch the conversation title and contact info
4. A `manual_conversation` row is created with `source = "intercom"`, `intercom_conversation_id` pre-filled, and fetched metadata (contact name, subject)
5. The user is navigated to the conversation detail page

### Changes

**`supabase/functions/import-intercom-ticket/index.ts`** (new)
- Parse the Intercom conversation ID from the request body
- Check for duplicates across all three tables (`manual_conversations`, `conversation_mappings`, `gmail_conversations`) by `intercom_conversation_id`
- Call `GET https://api.intercom.io/conversations/{id}` with the existing `INTERCOM_API_TOKEN`
- Extract contact name (from the conversation source contact) and subject/title
- Insert a `manual_conversation` row with `source = "intercom"`, contact name, subject, intercom_conversation_id, and a link back to the Intercom URL
- Return the created row ID

**`src/components/ImportTab.tsx`**
- Add a second card below the Slack import card: "Import Intercom ticket"
- Input field for Intercom URL with basic client-side validation (must contain `/conversation/`)
- On submit, invoke the `import-intercom-ticket` edge function
- Handle duplicate errors (toast with link to existing conversation)
- On success, navigate to `/conversations/{id}?source=manual`

**`src/pages/Conversations.tsx`**
- Add `"intercom"` as a recognized source value so Intercom-imported rows show a distinct badge (e.g., "Intercom import")

**`supabase/config.toml`**
- Add `[functions.import-intercom-ticket]` with `verify_jwt = false`

**`src/pages/FlowDiagram.tsx`** — Document the new import option

### Files to create/edit
- `supabase/functions/import-intercom-ticket/index.ts` (new)
- `supabase/config.toml`
- `src/components/ImportTab.tsx`
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`

