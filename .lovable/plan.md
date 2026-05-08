Append/update two items in `.lovable/project-knowledge.md` to reflect changes shipped in this session that aren't documented yet.

## 1. Extend the "Slack-side CSAT" section (line 587–589)

Add to that paragraph that when the customer submits the optional remark modal, `slack-interactions` now also surfaces it in three places:
- Posts `💬 Customer remark on N/5: "..."` back into the original Slack thread via `chat.postMessage` (best-effort, in `EdgeRuntime.waitUntil` so the modal closes immediately).
- Adds an internal note on the linked Intercom conversation via `POST /conversations/{id}/reply` with `message_type: "note"`, `admin_id = settings.intercom_assignee_id` (skipped silently if `intercom_conversation_id` is missing).
- Renders a synthetic `csat` entry inline in the Conversation Detail timeline (sorted by `csat_rated_at`), in addition to the existing side card.

## 2. Add a new short section after the assignment-part bullet (~line 535) titled **"Intercom 'assign and reply' parts"**

One paragraph documenting:
- Intercom delivers admins' assign-and-reply text on `part_type === "assignment"` rather than `comment`. The `intercom-webhook` part-picker therefore accepts both `comment` and `assignment` parts that carry a non-empty body. `note` and other system part types remain excluded so internal content never leaks to Slack.
- Dedup still flows through `claim_intercom_part` keyed on `part.id`, so the broader filter cannot cause double-posting.

## Files touched

- `.lovable/project-knowledge.md` — two small edits, no other files.

## Out of scope

- Memory files under `mem://` (already updated in prior turns).
- The Flow page — no logic shape change beyond what's already represented.
