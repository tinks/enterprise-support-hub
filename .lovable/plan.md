

# Build a Custom Slack App — Step-by-Step

This replaces the Lovable Slack connector with your own Slack app, giving you full control over the bot identity, real-time event handling, and interactive button payloads.

## Why this is needed

- The current connector posts messages as "Joel" (the installing user) because it lacks `chat:write.customize` scope, and you can't control the connector's OAuth scopes freely
- The connector doesn't support incoming webhooks/events, forcing you to poll
- Interactive buttons (thumbs up/down) require a custom app with an Interactivity URL you control

## Step-by-step instructions

### Step 1: Create a new edge function for Slack events

I'll create a `slack-events` edge function that handles:
- Slack's `url_verification` challenge (required during setup)
- `app_mention` events (replaces polling)
- `message` events in threads (detects user replies for context gathering)
- Request signature verification using the Signing Secret

### Step 2: Update all edge functions

Replace the connector gateway (`connector-gateway.lovable.dev/slack/api`) with direct Slack API calls (`https://slack.com/api/`) using `SLACK_BOT_TOKEN` in all three functions:
- `poll-slack` → becomes optional (events handle mentions in real-time) but kept as fallback
- `intercom-webhook` → uses `SLACK_BOT_TOKEN` directly
- `slack-interactions` → uses `SLACK_BOT_TOKEN` directly, adds signature verification

### Step 3: Create the Slack app at api.slack.com

I'll provide you with a ready-to-paste **App Manifest JSON** that includes:
- Bot name: "Lovable Support Bot"
- Icon: a heart emoji
- OAuth scopes: `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `chat:write.customize`, `users:read`, `users:read.email`
- Event subscriptions pointing to your `slack-events` edge function URL
- Interactivity URL pointing to your `slack-interactions` edge function URL

You'll go to **https://api.slack.com/apps** → "Create New App" → "From an app manifest" → paste the JSON.

### Step 4: Install the app to your workspace

After creating, go to "Install to Workspace" in the Slack app settings. This gives you:
- **Bot User OAuth Token** (starts with `xoxb-`)
- **Signing Secret** (found under Basic Information)

### Step 5: Store credentials as secrets

I'll ask you to add two secrets:
- `SLACK_BOT_TOKEN` — the Bot User OAuth Token
- `SLACK_SIGNING_SECRET` — the Signing Secret

### Step 6: Disconnect the Lovable Slack connector

Once the custom app is working, disconnect the existing Slack connector since you'll no longer need it.

## Code changes

| File | Change |
|------|--------|
| `supabase/functions/slack-events/index.ts` | **New** — handles `url_verification`, `app_mention`, and thread `message` events |
| `supabase/functions/poll-slack/index.ts` | Replace gateway URL with direct Slack API using `SLACK_BOT_TOKEN` |
| `supabase/functions/intercom-webhook/index.ts` | Replace gateway URL with direct Slack API using `SLACK_BOT_TOKEN` |
| `supabase/functions/slack-interactions/index.ts` | Replace gateway URL with direct Slack API, add Slack signature verification |
| `supabase/config.toml` | Add `[functions.slack-events]` with `verify_jwt = false` |

## What this solves

- Bot posts as **"Lovable Support Bot"** with a custom icon (full control via `chat:write.customize`)
- **Real-time** mention detection via Events API (no more polling delay)
- **Real-time** thread reply detection (context gathering triggers instantly)
- Proper signature verification on all incoming Slack payloads
- `users:read` scope available for user lookups

