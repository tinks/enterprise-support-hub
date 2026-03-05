

# Fix Intercom Message Formatting + Slack Bot Identity

## Issues

### 1. Intercom message contains raw Slack markup
The Intercom screenshot shows `<mailto:joel@lovable.dev|joel@lovable.dev>` and raw HTML `<a href="...">` tags. This happens because Slack encodes links as `<url|label>` and emails as `<mailto:email|email>` in its message format. The code passes this raw Slack text directly to Intercom without cleaning it.

### 2. Slack auto-reply sent as "Joel" instead of "Lovable Support Bot"
The `username` and `icon_emoji` overrides in `chat.postMessage` require the `chat:write.customize` scope on the Slack connection. Without it, the message is posted under the default bot identity (which may show as the installing user).

## Changes

### 1. Add Slack markup cleaning in `poll-slack/index.ts`

Add a helper function to convert Slack mrkdwn to plain text before sending to Intercom:
- `<mailto:email|email>` → `email`
- `<https://url|label>` → `url`
- `<https://url>` → `url`
- `<@U12345>` → remove

Apply this to:
- `messageText` (line 116) — already strips mentions but not links/emails
- Each reply text in the context parsing loop (line 192-206)
- The `fullBody` sent to Intercom

### 2. Reconnect Slack with `chat:write.customize` scope

The Slack connection needs the `chat:write.customize` scope to allow overriding the bot's display name and icon. Will prompt reconnection with this scope.

## Technical details

```typescript
// Helper to clean Slack mrkdwn to plain text
function cleanSlackMarkup(text: string): string {
  return text
    .replace(/<mailto:([^|>]+)\|[^>]+>/g, '$1')  // <mailto:x|y> → x
    .replace(/<(https?:\/\/[^|>]+)\|[^>]+>/g, '$1') // <url|label> → url
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')          // <url> → url
    .replace(/<@[A-Z0-9]+>/g, '')                     // <@U123> → remove
    .trim();
}
```

Apply `cleanSlackMarkup()` to all text extracted from Slack messages before sending to Intercom, and also before running the email/project regex extraction (so regexes match clean URLs/emails).

