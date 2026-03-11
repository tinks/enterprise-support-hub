

## Update SLACK_BOT_TOKEN Secret

Since you reinstalled the Slack app, the bot token has changed. I need to update the `SLACK_BOT_TOKEN` secret with your new token.

### What you need to do
1. Go to your Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Click **OAuth & Permissions**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

I'll then update the secret in your backend so the edge functions use the new token.

