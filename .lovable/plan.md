## Slack CSAT for Sam / Ask Lovable conversations

Post a 1–5 emoji rating widget in the Slack thread the moment a Slack-originated conversation is marked resolved by Intercom. Capture the click, prompt for an optional remark, and store the rating on the existing Slack-side conversation row so it shows up alongside the Intercom CSAT we already track.

### Flow
```text
Intercom resolved ──► intercom-webhook posts:
  "This issue has been marked as resolved…"
  + CSAT block: 😠 Terrible | 🙁 Bad | 😐 OK | 😀 Great | 🤩 Amazing
                                  │
                User clicks an emoji (slack-interactions)
                                  │
                ├─ Save rating immediately to conversation_mappings
                ├─ Replace block with "Thanks for rating: <emoji> <label>"
                └─ Open modal "Anything else you'd like to share?" (optional)
                                  │
                          User submits modal
                                  │
                          Save remark to conversation_mappings
```

### Database
New migration on `conversation_mappings` (parallels gmail/manual tables):
- `csat_rating smallint` (1–5, validated by reusing `validate_csat_rating` trigger)
- `csat_remark text`
- `csat_rated_at timestamptz`
- `csat_prompt_ts text` (the message ts of the CSAT block, so we can update it after a click)

No changes to gmail/manual — they keep using Intercom's `conversation_rating` via `refresh-intercom-csat`.

### Edge functions
1. **`intercom-webhook`** — in the existing "conversation closed/resolved" branch (around line 850), after posting the closing message, also post a second thread message containing a Slack `actions` block with 5 buttons (`csat_1`…`csat_5`, value = rating). Save the returned `ts` into `csat_prompt_ts`. Skip if `csat_rating` is already set or `csat_prompt_ts` already exists (idempotent on retries).
2. **`slack-interactions`** —
   - Handle `csat_1`…`csat_5` `block_actions`: update `conversation_mappings.csat_rating` + `csat_rated_at`, replace the prompt message via `chat.update` with "Thanks for rating: <emoji> <label>", then call `views.open` with a modal containing a single optional `plain_text_input` (multiline) labeled "Anything else you'd like to share? (optional)". Pass the mapping id in `private_metadata`.
   - Handle `view_submission` for that modal: write `csat_remark` to the row keyed by `private_metadata`. Empty submission = no-op.
   - Bot-identity / signing-secret verification reuses existing helpers.

### Frontend
- **Stats page CSAT card**: extend the data source to also count Slack-originated ratings from `conversation_mappings` (currently only `manual_conversations` + `gmail_conversations`). Same averages, distribution, and 1–2★ recent list. Response rate denominator becomes "resolved Slack + Intercom-linked manual/gmail in scope".
- **Conversation detail page**: when viewing a Slack conversation, show the same CSAT badge component already used for manual/gmail (rating stars + remark + rated-at). Read-only.
- No new admin toggle — feature is on by default. Can be disabled later behind a settings flag if needed.

### Edge cases
- If the same conversation gets re-resolved (Intercom reopen → resolve), don't re-prompt: guard on `csat_rating IS NOT NULL OR csat_prompt_ts IS NOT NULL`.
- Re-rating: if the user clicks a different emoji on the same prompt before the chat.update lands, last-write-wins on the rating field (acceptable).
- Modal dismissal: rating is already saved on click, so closing the modal without text is fine.

### Out of scope
- DM/Email CSAT for gmail/manual contacts (not requested).
- A standalone settings toggle to disable the prompt.
- Backfilling CSAT for already-resolved Slack conversations.

### Docs to update after implementation
- `mem://features/csat` — extend to mention Slack-side capture + new columns.
- `.lovable/project-knowledge.md` and the Flow page — add the resolution → CSAT step.
