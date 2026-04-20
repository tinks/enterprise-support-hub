

The user is showing me another mis-imported conversation (`02c3ec8c-ca91-48cd-9c03-fd0132fc932d`, Intercom ID `215473894213254`) that was NOT in the enterprise inbox but still got imported. The previous cleanup only removed rows created after `2026-04-15`, but this one must be older OR the cleanup missed it.

Let me check the data to understand the scope.
<lov-tool-use id="toolu_vrtx_01NvgmDD1GEU3aKitpnBEPNG" name="tool_search" data="{\"target\": \"supabase--read_query\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01LTwYNun9Xv7DHXyo8EdUs2" name="tool_search" data="{\"target\": \"supabase--read_query\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01HCyr5mniZUZaR2Kh4Z5cti" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT id, source, contact_name, subject, intercom_conversation_id, owner, status, created_at, updated_at FROM manual_conversations WHERE id = '02c3ec8c-ca91-48cd-9c03-fd0132fc932d' OR intercom_conversation_id = '215473894213254';\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01GJjDGv4ngVRsuySiJA2ynu" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT COUNT(*) AS total, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM manual_conversations WHERE source = 'intercom';\"}">
</lov-tool-use>
This conversation was created `2026-04-13` — **before** the 4/15 cleanup cutoff. So it was imported by something earlier (likely manual import, bulk import, or the intercom-webhook auto-import path). The previous cleanup only deleted rows created after 4/15. Let me check more.
<lov-tool-use id="toolu_vrtx_01C8Ntp25DtHm55ZvLXn6Mw1" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT created_at::date AS day, COUNT(*) FROM manual_conversations WHERE source='intercom' GROUP BY 1 ORDER BY 1 DESC LIMIT 30;\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01FwpgyawUiihcBMgkHGyWAp" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT action, performed_by, old_value, new_value, created_at FROM conversation_audit_logs WHERE conversation_id = '02c3ec8c-ca91-48cd-9c03-fd0132fc932d' ORDER BY created_at ASC LIMIT 50;\"}">
</lov-tool-use>
So there are still ~225 intercom-source rows pre-4/15, including this one from 4/13. The intercom-webhook also auto-imports on assignment events (mem://logic/intercom-routing). That webhook handler also needs the same strict guard, AND the cleanup needs to extend to all `source='intercom'` rows that don't actually belong to the enterprise inbox.

Let me check the webhook code briefly.
<lov-tool-use id="toolu_vrtx_01QPCUqGYp1SJ1n9Xd6LyeaT" name="code--exec" integration-id="code" data="{\"command\": \"rg -n \\\"team_assignee_id\\\\|enterpriseInboxId\\\\|intercom_inbox_id\\\\|manual_conversations\\\" supabase/functions/intercom-webhook/index.ts | head -50\", \"user_facing_description\": \"Checking intercom-webhook for inbox guard logic\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01Pmse1impgCanKsX6pdgUM3" name="code--exec" integration-id="code" data="{\"command\": \"rg -n \\\"team_assignee|inbox|manual_conversations|ASSIGNMENT\\\" supabase/functions/intercom-webhook/index.ts | head -60\", \"user_facing_description\": \"Searching webhook for inbox/team logic\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_019QLzuZuG58waezM5ijr2Lc" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/intercom-webhook/index.ts\", \"lines\": \"160-220\"}">
</lov-tool-use>
Found it. The webhook has a "Fallback 3" that says: if `admin_assignee_id` is in `admin_owner_map` (Joel/Kristina/Sam), **treat as enterprise inbox** even when the actual `team_assignee_id` doesn't match. This is why conversations like 215473894213254 — assigned to Joel but in a different inbox — got auto-imported via webhook back on 4/13.

Let me verify by checking how many pre-4/15 intercom rows exist and need cleaning.
<lov-tool-use id="toolu_vrtx_01XFdCT3intrudTax5gKYgpk" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT COUNT(*) FROM manual_conversations WHERE source='intercom' AND created_at < '2026-04-15';\"}">
</lov-tool-use>
225 pre-4/15 rows. Many likely came from this faulty webhook fallback. But some may be legitimate manual imports (via ImportTab). I need a way to distinguish. The safest approach: verify each against Intercom API, then delete those that aren't in the enterprise inbox today.

<lov-plan>

## Fix the webhook fallback bug + clean up older mis-imports

### Problem
The previous cleanup only removed Intercom rows created **after 4/15/2026**, but `02c3ec8c` (created 4/13) shows mis-imports go back further. Root cause: `intercom-webhook/index.ts` has a "Fallback 3" rule that treats any conversation assigned to a known admin (Joel/Kristina/Sam) as belonging to the enterprise inbox — even when Intercom explicitly says it's in a different team. That's how `215473894213254` (assigned to Joel, not in enterprise inbox) got auto-imported.

### Root cause (lines 203–207 of `intercom-webhook/index.ts`)
```typescript
// Fallback 3: admin_assignee_id is in admin_owner_map
if (!isEnterpriseInbox && resolvedOwner) {
  isEnterpriseInbox = true; // ← BUG: overrides the actual inbox check
}
```
This makes the API verification (Fallback 2) useless — even after confirming `actualTeamId !== enterpriseInboxId`, we still import if Joel/Kristina/Sam touched it.

### Fix

**1. Remove Fallback 3 from `intercom-webhook/index.ts`**
Trust the actual `team_assignee_id` (direct match or Intercom API verification). If the conversation isn't in the enterprise inbox at fetch time, skip it — same strict guard as the poller now uses.

**2. Verify-then-delete the 225 pre-4/15 Intercom rows**
Build a one-shot cleanup edge function `cleanup-bad-intercom-imports` that:
- Selects all `manual_conversations` where `source='intercom'`
- For each, calls Intercom API to fetch current `team_assignee_id`
- Deletes the row (+ cascaded `manual_messages`, `conversation_audit_logs`, `conversation_notes`) if `team_assignee_id != enterprise inbox ID`
- Skips (preserves) rows that are legitimately in the enterprise inbox
- Returns counts: checked / deleted / kept / api_errors
- Rate-limited (small delay between calls) — ~5–8 minutes for 237 rows

Run it once from a button on Settings, then it can be removed.

**3. Update Flow diagram**
Note on the Intercom webhook node: "Strict inbox guard — admin-only fallback removed. Only imports if `team_assignee_id == enterprise inbox ID`."

### Files
- **Edit**: `supabase/functions/intercom-webhook/index.ts` — remove Fallback 3 (lines ~203–207)
- **New**: `supabase/functions/cleanup-bad-intercom-imports/index.ts` — verify-and-delete cleanup
- **Edit**: `src/pages/Index.tsx` — add a "Clean up mis-imported Intercom rows" button that invokes the cleanup function
- **Edit**: `src/pages/FlowDiagram.tsx` — note the webhook guard fix

