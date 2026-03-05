

# Unassign + Move to Team Inbox After First AI Reply

## What happens now
When SAM (the AI bot) replies in Intercom, the `intercom-webhook` function posts the reply to Slack as a threaded message with feedback buttons. The conversation stays assigned to SAM.

## What to change
After the Slack message is successfully posted, add an Intercom API call to:
1. **Unassign** the conversation from SAM (the `intercom_assignee_id` bot)
2. **Move it to the team inbox** specified in `intercom_inbox_id` (e.g. "enterprise")

This is done via a single `POST` to `https://api.intercom.io/conversations/{id}/parts` with `message_type: "assignment"` and `assignee_id: "0"` (unassigned) plus `team_id` set to the inbox ID from settings.

## Changes

### 1. Edit `supabase/functions/intercom-webhook/index.ts`
- Add `INTERCOM_API_TOKEN` env var check (already available as a secret)
- After the successful Slack reply (line ~196), fetch settings to get `intercom_inbox_id` and `intercom_assignee_id`
- Call the Intercom Conversations API to assign to the team inbox and unassign individual owner:
  ```
  POST /conversations/{conversationId}/parts
  {
    "message_type": "assignment",
    "type": "team",
    "assignee_id": settings.intercom_inbox_id,
    "admin_id": settings.intercom_assignee_id,
    "body": ""
  }
  ```
- This moves the conversation to the team inbox and removes any individual assignment

No database or UI changes needed.

