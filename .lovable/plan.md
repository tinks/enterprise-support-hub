## Goal

Wire `eren@lovable.dev` into the only place teammate emails are meaningful in this codebase: the teammate roster used to attribute pasted Slack-thread messages.

## Honest finding

I checked everywhere teammate identity is referenced. The app does **not** use teammate emails for routing, notifications, or auto-assignment:

- **Intercom auto-assignment** is keyed by Intercom admin ID (set in Settings → Admin → owner mapping). Eren's email doesn't help here — you'll need his Intercom admin ID once he's added as an Intercom teammate.
- **Slack group-DM notifications on new tickets** use hardcoded Slack user IDs (`slack-interactions/index.ts:422`). Adding Eren here requires his Slack user ID, not his email. Also, you may not want every new SSO/SCIM ticket pinging him.
- **Owner display name** (`"Eren"`) is already wired everywhere from the previous step.
- **Authentication / login** is handled by workspace SSO — adding Eren's email here is a workspace-admin action, not a code change.

The only code location where an email is genuinely useful is `src/lib/parseThread.ts`, the teammate roster used by paste-thread import to distinguish admin replies from user replies.

## Change

### `src/lib/parseThread.ts`

Add Eren to `ADMIN_OPTIONS` with his email; make `slackId` and `email` both optional in the type so we can record what we know without inventing missing IDs.

```ts
export const ADMIN_OPTIONS: Array<{ name: string; slackId?: string; email?: string }> = [
  { name: "Joel Samuelson", slackId: "U091GANMA2U" },
  { name: "Kristina Bodurova", slackId: "U0AFU714807" },
  { name: "Eren",            email: "eren@lovable.dev" },
];
```

`ADMIN_NAMES` (derived from `name`) continues to work unchanged. When you have Eren's Slack user ID, add it to the same row.

### Memory update

Append Eren's email to `mem://team/owners` so future agent runs know it without re-asking.

## What I'm explicitly NOT doing (and why)

- **Not** adding Eren to the new-ticket Slack DM notifier in `slack-interactions/index.ts`. That fires on every new enterprise ticket; he should only see SSO/SCIM ones. If you want him notified for SSO/SCIM specifically, that's a separate filtered-notifier feature — call it out and I'll build it.
- **Not** touching `settings.admin_owner_map` from code. That's runtime config you'll fill in via Settings UI once Eren has an Intercom admin ID.
- **Not** inventing a Slack user ID for Eren. If you share it, I'll add it to `parseThread.ts` in one line.

## Follow-ups you may want

1. Once Eren is in Intercom: add `<his admin ID> → Eren` in Settings → Admin → owner mapping.
2. Send me his Slack user ID so paste-thread import can attribute his Slack messages by ID rather than name match.
3. Decide whether SSO/SCIM tickets should DM him on creation (separate task).
