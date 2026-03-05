
# Slack ↔ Intercom Support Bridge

## Overview
A connector app that bridges Slack and Intercom: when an enterprise user tags a specific bot user in a monitored Slack channel, a ticket is created in Intercom and assigned to the AI bot "Sam." Sam's replies flow back to Slack as threaded replies, with interactive 👍/👎 buttons for feedback. Thumbs down escalates to a human agent.

## Architecture

### Edge Functions (Supabase/Cloud backend)
1. **`slack-events`** — Receives Slack events (app_mention). When the configured user is tagged in a monitored channel, it creates an Intercom conversation via the Intercom API, stores the mapping (Slack thread ↔ Intercom conversation), and assigns it to the configured inbox + AI bot.

2. **`intercom-webhook`** — Receives Intercom webhook events (conversation.admin.replied). Looks up the Slack thread from the stored mapping, then sends the AI reply back to Slack as a threaded message with 👍/👎 buttons via the Slack connector gateway.

3. **`slack-interactions`** — Receives Slack interactive payloads (button clicks). On 👎, updates the Intercom conversation to unassign from the AI bot so a human can pick it up. On 👍, optionally marks the conversation as resolved.

### Database Tables
- **`settings`** — Stores configuration: monitored channel IDs, Intercom inbox ID, assigned bot user ID, Slack bot user mention trigger.
- **`conversation_mappings`** — Maps Slack thread timestamps to Intercom conversation IDs for routing replies back and forth.

### Settings UI (Simple admin page)
- A single-page dashboard with form fields to configure:
  - Monitored Slack channels (comma-separated channel IDs)
  - Intercom inbox ID
  - Intercom assignee (AI bot) ID
  - Slack bot user ID to watch for mentions
- Save/load settings from the database
- A log/status section showing recent conversation mappings

## Flow Summary
1. User in Slack: `@Joel Samuelson help with billing` → Slack sends event to `slack-events`
2. Edge function creates Intercom conversation with the message, assigns to inbox + Sam
3. Sam (Intercom AI) replies → Intercom webhook hits `intercom-webhook`
4. Edge function posts threaded reply in Slack with 👍/👎 buttons
5. If 👎 → `slack-interactions` unassigns from Sam in Intercom, human takes over
6. If human replies in Intercom → same webhook flow posts to Slack thread

## Setup Requirements
- Slack connector (already connected) — for sending messages
- Custom Slack app — needed to **receive** events (mentions, button clicks). Since the Slack connector can't receive events, a custom Slack app manifest will be provided with the edge function URLs pre-filled.
- Intercom API token — stored as a secret
- Intercom webhook — pointed at the `intercom-webhook` edge function URL

## Important Note on Slack
Since you need to **receive** Slack events (mentions and button interactions), the built-in Slack connector alone won't work for receiving. We'll need to set up a custom Slack app for receiving events, while still using the connector gateway for sending messages. I'll provide a ready-to-paste Slack app manifest once the edge functions are created.
