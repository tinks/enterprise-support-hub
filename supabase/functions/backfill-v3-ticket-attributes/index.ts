// backfill-v3-ticket-attributes
// ---------------------------------------------------------------------------
// One-time (idempotent) backfill for the v3 attribute store. Walks
// intercom_tickets_v3 in batches and, for each row, flattens raw_payload's
// custom_attributes into the intercom_tickets_v3.custom_attributes jsonb
// mirror and into v3_ticket_attributes.
//
// Safe to invoke repeatedly and safe to invoke concurrently on disjoint id
// ranges. Time-boxed at ~120s per call; use `after` cursor to resume.
//
// Request body (all optional):
//   { batch?: number = 200,          // rows per fetch page
//     limit?: number,                // hard cap on rows processed this run
//     after?: string,                // cursor id (uuid), resume from here
//     force?: boolean = false }      // reprocess rows that already have a
//                                    // non-null custom_attributes mirror
//
// Response:
//   { ok, processed, updated, skipped, errors, last_id, done }
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { V3_CORS_HEADERS, TIME_BUDGET_MS } from "../_shared/v3.ts";
import { syncTicketAttributes } from "../_shared/v3-attributes.ts";
import { requireEditor } from "../_shared/require-editor.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: V3_CORS_HEADERS });

  const gate = await requireEditor(req, V3_CORS_HEADERS);
  if (!gate.ok) return gate.response;

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { batch?: number; limit?: number; after?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const batch = Math.max(1, Math.min(body.batch ?? 200, 500));
  const hardLimit = typeof body.limit === "number" ? Math.max(1, body.limit) : Number.MAX_SAFE_INTEGER;
  const force = !!body.force;
  let after: string | null = body.after ?? null;

  let processed = 0, updated = 0, skipped = 0, errors = 0;
  let lastId: string | null = after;
  let done = false;

  while (processed < hardLimit) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.log("[backfill-v3-ticket-attributes] time budget hit");
      break;
    }

    let q = supabase
      .from("intercom_tickets_v3")
      .select("id, intercom_conversation_id, raw_payload, custom_attributes")
      .order("id", { ascending: true })
      .limit(batch);
    if (after) q = q.gt("id", after);
    if (!force) q = q.is("custom_attributes", null);

    const { data: rows, error } = await q;
    if (error) {
      console.error(`[backfill-v3-ticket-attributes] fetch error: ${error.message}`);
      return json({ ok: false, error: error.message, processed, updated, skipped, errors, last_id: lastId }, 500);
    }
    if (!rows || rows.length === 0) {
      done = true;
      break;
    }

    for (const row of rows) {
      lastId = row.id;
      processed++;
      if (!row.raw_payload) {
        // Open-side rows never get a full GET → no raw_payload. Leave them
        // alone; sync-v3-closed will fill them once finalized.
        skipped++;
        continue;
      }
      try {
        await syncTicketAttributes(supabase, row.id, row.raw_payload, {
          convId: row.intercom_conversation_id,
        });
        updated++;
      } catch (e) {
        console.error(
          `[backfill-v3-ticket-attributes] err ticket=${row.id} conv=${row.intercom_conversation_id}: ${(e as Error).message}`,
        );
        errors++;
      }
      if (processed >= hardLimit) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    }

    if (rows.length < batch) {
      done = true;
      break;
    }
    after = lastId;
  }

  return json({
    ok: true,
    processed,
    updated,
    skipped,
    errors,
    last_id: lastId,
    done,
    elapsed_ms: Date.now() - startedAt,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}
