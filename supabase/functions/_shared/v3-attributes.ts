// Shared helpers for flattening Intercom `custom_attributes` into the v3
// attribute store. Called by sync-v3-open, sync-v3-closed, v3-finalize, and
// the backfill edge function. MUST stay idempotent and safe to re-run.
//
// Contract:
//   - `custom_attributes` on the payload is expected to be a flat object of
//     scalar values (string / number / boolean / null). Nested objects/arrays
//     are logged loudly and stored as JSON-stringified text in attr_value_text
//     (with attr_value_num / attr_value_bool left null).
//   - `v3_ticket_attributes` is an exact mirror per ticket: keys missing from
//     the payload are deleted.
//   - We also write the flat object back onto `intercom_tickets_v3.custom_attributes`.

export type FlatAttr = {
  attr_key: string;
  attr_value_text: string;
  attr_value_num: number | null;
  attr_value_bool: boolean | null;
};

export function flattenCustomAttributes(
  rawPayload: any,
  ctx: { convId?: string } = {},
): { flat: Record<string, unknown>; rows: FlatAttr[] } {
  const ca = rawPayload?.custom_attributes;
  const flat: Record<string, unknown> = {};
  const rows: FlatAttr[] = [];

  if (ca == null) return { flat, rows };
  if (typeof ca !== "object" || Array.isArray(ca)) {
    console.warn(
      `[v3-attributes] unexpected custom_attributes shape for conv=${ctx.convId ?? "?"} — got ${Array.isArray(ca) ? "array" : typeof ca}`,
    );
    return { flat, rows };
  }

  for (const [key, value] of Object.entries(ca)) {
    if (!key) continue;
    if (value === null || value === undefined) {
      // Preserve nulls in the jsonb mirror; skip in normalized store.
      flat[key] = null;
      continue;
    }

    let text: string;
    let num: number | null = null;
    let bool: boolean | null = null;

    if (typeof value === "boolean") {
      bool = value;
      text = value ? "true" : "false";
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) num = value;
      text = String(value);
    } else if (typeof value === "string") {
      text = value;
      // Opportunistically type numeric strings — but only when the round-trip
      // is exact, so "007" or "1.10" stay strings.
      const n = Number(value);
      if (value.trim() !== "" && Number.isFinite(n) && String(n) === value.trim()) {
        num = n;
      }
    } else if (typeof value === "object") {
      console.warn(
        `[v3-attributes] non-scalar custom_attribute for conv=${ctx.convId ?? "?"} key=${key} — stringifying`,
      );
      try { text = JSON.stringify(value); } catch { text = String(value); }
    } else {
      console.warn(
        `[v3-attributes] unknown custom_attribute type for conv=${ctx.convId ?? "?"} key=${key} type=${typeof value}`,
      );
      text = String(value);
    }

    flat[key] = value;
    rows.push({ attr_key: key, attr_value_text: text, attr_value_num: num, attr_value_bool: bool });
  }

  return { flat, rows };
}

// Sync the normalized store + jsonb mirror for a single ticket row.
// `ticketId` is the intercom_tickets_v3.id (uuid), not the intercom conv id.
export async function syncTicketAttributes(
  supabase: any,
  ticketId: string,
  rawPayload: any,
  ctx: { convId?: string } = {},
): Promise<{ upserted: number; deleted: number }> {
  const { flat, rows } = flattenCustomAttributes(rawPayload, ctx);

  // Write jsonb mirror. Store {} rather than null so downstream queries have a
  // consistent shape.
  const { error: mirrorErr } = await supabase
    .from("intercom_tickets_v3")
    .update({ custom_attributes: flat })
    .eq("id", ticketId);
  if (mirrorErr) {
    console.error(
      `[v3-attributes] failed to write custom_attributes mirror ticket=${ticketId} conv=${ctx.convId ?? "?"}: ${mirrorErr.message}`,
    );
  }

  // Upsert normalized rows.
  let upserted = 0;
  if (rows.length) {
    const payload = rows.map((r) => ({
      ticket_id: ticketId,
      attr_key: r.attr_key,
      attr_value_text: r.attr_value_text,
      attr_value_num: r.attr_value_num,
      attr_value_bool: r.attr_value_bool,
      synced_at: new Date().toISOString(),
    }));
    const { error: upErr } = await supabase
      .from("v3_ticket_attributes")
      .upsert(payload, { onConflict: "ticket_id,attr_key" });
    if (upErr) {
      console.error(
        `[v3-attributes] upsert failed ticket=${ticketId} conv=${ctx.convId ?? "?"}: ${upErr.message}`,
      );
    } else {
      upserted = rows.length;
    }
  }

  // Delete keys no longer present on the payload — keeps store as exact mirror.
  // Fetch current keys, diff, and delete the stale ones by key. This avoids
  // brittle PostgREST `not.in` quoting when keys contain commas or quotes.
  const keepSet = new Set(rows.map((r) => r.attr_key));
  const { data: currentRows, error: fetchErr } = await supabase
    .from("v3_ticket_attributes")
    .select("attr_key")
    .eq("ticket_id", ticketId);
  if (fetchErr) {
    console.error(
      `[v3-attributes] fetch existing keys failed ticket=${ticketId} conv=${ctx.convId ?? "?"}: ${fetchErr.message}`,
    );
    return { upserted, deleted: 0 };
  }
  const staleKeys = (currentRows ?? [])
    .map((r: any) => r.attr_key as string)
    .filter((k) => !keepSet.has(k));
  let deleted = 0;
  if (staleKeys.length) {
    const { error: delErr } = await supabase
      .from("v3_ticket_attributes")
      .delete()
      .eq("ticket_id", ticketId)
      .in("attr_key", staleKeys);
    if (delErr) {
      console.error(
        `[v3-attributes] delete stale failed ticket=${ticketId} conv=${ctx.convId ?? "?"}: ${delErr.message}`,
      );
    } else {
      deleted = staleKeys.length;
    }
  }

  return { upserted, deleted };
}
