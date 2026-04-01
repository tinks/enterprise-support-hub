

## Fix: Slack thread replies not forwarding to Intercom after ticket conversion

### Root cause
When a conversation is escalated, it gets converted to an Intercom ticket. But `slack-events` always forwards replies to `/conversations/{id}/reply` with `type: "user"`. Intercom rejects or silently drops these because the entity is now a ticket, not a conversation. This explains why even Julia's message (sent moments before escalation) failed — by the time it was processed, the conversion had already happened.

### Solution

**1. Database migration — add `intercom_ticket_id` column**
```sql
ALTER TABLE conversation_mappings ADD COLUMN intercom_ticket_id text;
```

**2. `supabase/functions/slack-interactions/index.ts`**
After the ticket conversion call (`POST /conversations/{id}/convert`), extract the returned ticket ID and store it:
```ts
const convertData = await convertRes.json();
await supabase.from("conversation_mappings")
  .update({ intercom_ticket_id: convertData.ticket_id || convertData.id })
  .eq("id", mapping.id);
```
Apply this in both places where ticket conversion happens (~line 669 and ~line 1448).

**3. `supabase/functions/intercom-webhook/index.ts`**
Same — store ticket ID after conversion (~line 857).

**4. `supabase/functions/slack-events/index.ts`** (~line 684)
Replace the single Intercom reply call with smart routing:
- If `mapping.intercom_ticket_id` exists → use `/conversations/{ticket_id}/reply` with `type: "admin"` and `admin_id`
- Otherwise → use existing `/conversations/{conversation_id}/reply` logic
- If the first attempt fails, retry with the other endpoint
- If both fail, post a warning to the Slack thread so the team knows

**5. `src/pages/FlowDiagram.tsx`** — document that replies now route to tickets after escalation

### Files to edit
- Database migration (1 ALTER TABLE)
- `supabase/functions/slack-events/index.ts` — smart reply routing with fallback
- `supabase/functions/slack-interactions/index.ts` — store ticket ID after conversion (2 locations)
- `supabase/functions/intercom-webhook/index.ts` — store ticket ID after conversion (1 location)
- `src/pages/FlowDiagram.tsx` — document change

