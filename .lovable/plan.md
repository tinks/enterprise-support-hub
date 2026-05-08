## Root cause

Intercom delivered Kristina's reply "human says hi" as part `45036616972` with `part_type = "assignment"` (it was an "assign-and-reply" — she assigned the conversation to herself and wrote a body in the same action).

In `supabase/functions/intercom-webhook/index.ts` (lines 1001–1013), the part-picker only accepts `part_type === "comment"`:

```
if (conversationParts[i].part_type === "comment" && conversationParts[i].body) { … }
```

So the picker walked back past the assignment part and stopped on `45036591803` (the auto-posted "ticket has been escalated…" comment), which had already been claimed and surfaced. Result: "human says hi" never reached Slack.

## Fix

Extend the part-picker to also accept `assignment` parts that carry a non-empty body — those represent admins replying while assigning. Internal `note` parts stay excluded (they must not leak to Slack).

Edit at lines 1006–1013 of `supabase/functions/intercom-webhook/index.ts`:

```ts
const FORWARDABLE_TYPES = new Set(["comment", "assignment"]);
for (let i = conversationParts.length - 1; i >= 0; i--) {
  const p = conversationParts[i];
  if (FORWARDABLE_TYPES.has(p.part_type) && p.body && String(p.body).trim()) {
    lastCommentPart = p;
    break;
  }
}
```

The downstream pipeline (HTML→text strip, attachment extraction, dedup via `claim_intercom_part`, admin-name detection, Slack posting) already operates on `lastCommentPart.body` and `lastCommentPart.author`, so no other change is needed.

## Verification

1. Deploy `intercom-webhook`.
2. Re-trigger by replying via "assign and reply" on the same conversation (or a fresh one) — the body should appear in the Slack thread within seconds.
3. Confirm logs show: `Loaded N conversation parts…` followed by a Slack post (no "No comment part found" / "Duplicate part skipped" for that new part id).
4. Backfill the missing message for `215474223331403` (mapping `b9bd2ede…`) by re-posting "human says hi" into the Slack thread `1778239301.198169`.

## Out of scope

- Surfacing internal Intercom `note` parts in Slack (intentionally private).
- Other multi-action part types (`snoozed`, `assign_and_unsnooze`, `ticket_state_updated_by_admin`) — none of those carry user-authored body text in current usage.

## Files touched

- `supabase/functions/intercom-webhook/index.ts` — broaden part-picker filter
- `.lovable/memory/logic/message-processing.md` — note that assignment-with-body parts are forwarded
- `.lovable/project-knowledge.md` — same one-line addition
