

## Fix Double-Send Race Condition in Intercom Webhook

### Root Cause

When Intercom fires multiple webhook events for the same reply (e.g., `conversation.admin.replied` + `ticket.admin.replied`), two edge function invocations run simultaneously. Both check `last_intercom_part_id` — if it's `null`, both see `null` and both pass the `.or('last_intercom_part_id.is.null,last_intercom_part_id.lt.${partId}')` filter, posting the same message twice.

The PostgREST update is not a true compare-and-swap at the application level when two requests overlap.

### Fix

Replace the PostgREST-based dedup with a **Postgres function** that uses `SELECT ... FOR UPDATE` to guarantee only one caller wins.

**1. Database migration — Create an atomic claim function**

```sql
CREATE OR REPLACE FUNCTION public.claim_intercom_part(
  p_mapping_id uuid,
  p_part_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_marker text;
BEGIN
  -- Lock the row to prevent concurrent claims
  SELECT last_intercom_part_id INTO current_marker
  FROM conversation_mappings
  WHERE id = p_mapping_id
  FOR UPDATE;

  -- If marker is already >= this part, reject (duplicate)
  IF current_marker IS NOT NULL THEN
    IF current_marker ~ '^\d+$' AND p_part_id ~ '^\d+$' THEN
      IF current_marker::bigint >= p_part_id::bigint THEN
        RETURN false;
      END IF;
    ELSIF current_marker = p_part_id THEN
      RETURN false;
    END IF;
  END IF;

  -- Claim it
  UPDATE conversation_mappings
  SET last_intercom_part_id = p_part_id
  WHERE id = p_mapping_id;

  RETURN true;
END;
$$;
```

**2. Update `supabase/functions/intercom-webhook/index.ts` (lines ~375-446)**

Replace the entire dedup block with a single RPC call:

```typescript
const { data: claimed, error: claimError } = await supabase
  .rpc("claim_intercom_part", {
    p_mapping_id: mapping.id,
    p_part_id: partId,
  });

if (claimError) {
  console.error(`Dedup claim RPC failed:`, claimError);
  // Default: proceed to avoid dropping messages
}

if (!claimError && claimed === false) {
  console.log(`Duplicate part ${partId} for mapping ${mapping.id}, skipping`);
  return new Response(JSON.stringify({ ok: true, message: "Duplicate skipped" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

This replaces ~70 lines of fallback logic with a single atomic database call that uses row-level locking (`FOR UPDATE`) to guarantee exactly one winner.

