

# Button-Based Flow (No Thread Reply Detection Needed)

## Overview
Replace thread reply detection with Slack Block Kit buttons. All interactions route through the existing `slack-interactions` function — no new event subscriptions needed.

## Flow
```text
User @mentions bot
  → slack-events: posts threaded message with 2 buttons

User clicks "Proceed"
  → slack-interactions: creates Intercom ticket with original message only
  → posts "Thanks! Generating a response..." in thread

User clicks "Add Details"
  → slack-interactions: opens modal (email + project link fields)
  → User submits modal
  → slack-interactions: creates Intercom ticket with context
  → posts "Thanks! Generating a response..." in thread
```

## Changes

### 1. `slack-events/index.ts`
- Replace plain text auto-reply with Block Kit message: section text + two buttons ("Add Details" and "Proceed")
- Button values encode `channelId|threadTs` so `slack-interactions` can find the mapping
- **Remove** the entire thread reply handler (`message` event with `awaiting_context` logic, ~lines 200-310) — no longer needed

### 2. `slack-interactions/index.ts`
- Add handler for `proceed_without_context`: look up mapping by channel+threadTs from button value, create Intercom ticket with original message, post acknowledgment, update status
- Add handler for `add_details`: call `views.open` to show a modal with email and project link text inputs. Pass channel+threadTs in `private_metadata`
- Add handler for `view_submission` (payload type): extract email/project from modal fields, create Intercom ticket with full context, post acknowledgment, update status
- Extract the Intercom ticket creation logic into a shared helper function to avoid duplication across the three existing handlers + new ones

### 3. Slack App Config
No changes needed — buttons use the Interactivity URL which is already pointing to `slack-interactions`. Modals also route through the same URL via `view_submission`.

