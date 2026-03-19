

## Problem

The `list-slack-channels` edge function returns empty results for all requested channels (including `C0AM32URSVC`). The function has two resolution paths:

1. **Primary**: `conversations.list` — paginate all channels, filter by requested IDs. If the bot lacks `groups:read`, it falls back to `public_channel` only, which won't find private channels.
2. **Fallback**: Connector gateway `conversations.info` — requires `LOVABLE_API_KEY` + `SLACK_API_KEY`. This also returns nothing (likely the gateway connection uses a different workspace token or the endpoint format is wrong).

Neither path resolves private channels that the bot is a member of.

## Root Cause

The bot is a member of these private channels and can call `conversations.info` directly with `SLACK_BOT_TOKEN`, but the code never tries that. It jumps from the bulk `conversations.list` (which fails for private channels without `groups:read` in the list call) straight to the connector gateway fallback (which uses a different token).

## Fix

**`supabase/functions/list-slack-channels/index.ts`** — Add a direct `conversations.info` fallback using `SLACK_BOT_TOKEN` for unresolved channel IDs, before the gateway fallback:

```text
conversations.list (bulk, public+private)
  ↓ missing_scope? retry public-only
  ↓ still unresolved?
NEW → conversations.info per-channel with SLACK_BOT_TOKEN  ← direct API
  ↓ still unresolved?
  → conversations.info via connector gateway (existing)
```

For each unresolved channel ID, call `GET conversations.info?channel=ID` with the bot token. This works for any channel the bot is a member of, regardless of list scopes.

