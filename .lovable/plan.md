

## Set Intercom "Slack channel" conversation attribute

### Problem
The existing tagging approach isn't working. The Intercom conversation has built-in custom attributes like "Slack channel" and "Slack workspace" (visible in the screenshot) that we can set directly.

### Changes

**`supabase/functions/slack-interactions/index.ts`**

1. **Resolve channel name** — After conversation creation (~line 200), call Slack's `conversations.info` API with the `channelId` to get the channel name.

2. **Replace tagging block with attribute update** — Replace the tag block (lines 226-259) with a `PUT` to update the conversation's custom attributes:
   ```typescript
   // Get channel name from Slack
   const channelInfoRes = await fetch(
     `${SLACK_API_URL}/conversations.info?channel=${channelId}`,
     { headers: { Authorization: `Bearer ${slackBotToken}` } }
   );
   const channelInfo = await channelInfoRes.json();
   const channelName = channelInfo.ok ? channelInfo.channel.name : channelId;

   // Set conversation attributes
   await fetch(`https://api.intercom.io/conversations/${conversationId}`, {
     method: "PUT",
     headers: intercomHeaders,
     body: JSON.stringify({
       custom_attributes: {
         "Slack channel": channelName,
         "source": "Slack",
         "support_tier": "Enterprise Support",
       },
     }),
   });
   ```

3. **Keep existing tag logic removal** — The entire tag create/attach block (lines 226-259) gets replaced by the above.

**`src/pages/FlowDiagram.tsx`**

Update Node 4 detail from `'Tags with "Slack"'` to `'Sets Slack channel + Enterprise Support attributes'`.

### Coordination with Sam's team
Share the attribute name `support_tier: "Enterprise Support"` with Sam's developers so they can configure their AI to not auto-escalate conversations with this attribute.

