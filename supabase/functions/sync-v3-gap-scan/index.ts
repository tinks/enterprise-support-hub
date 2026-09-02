// sync-v3-gap-scan
// ---------------------------------------------------------------------------
// Safety net. Walks the last N days, asks Intercom how many CLOSED enterprise
// tickets exist per day, compares to our intercom_tickets_v3 count per day,
// and invokes sync-v3-closed for any day where we're short.
//
// This is the mechanism that catches "we never finished backfilling" — the
// case that produced the 5 missing tickets in v2.
// ---------------------------------------------------------------------------

import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveInboxes, inboxSearchClause } from "../_shared/v3-inboxes.ts";
import {
  CLEAN_DATA_START_ISO,
  intercomHeaders,
  TIME_BUDGET_MS,
  V3_CORS_HEADERS,
} from "../_shared/v3.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: V3_CORS_HEADERS });

  const gate = await requireEditorOrSecret(req, V3_CORS_HEADERS);
  if (!gate.ok) return gate.response;

  const startedAt = Date.now();
  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { lookbackDays?: number } = {};
  try { body = await req.json(); } catch {}
  const lookbackDays = Math.max(1, Math.min(60, body.lookbackDays ?? 30));

  const { data: settings } = await supabase.from("settings").select("*").limit(1).single();
  if (!settings?.intercom_inbox_id) return json({ error: "No enterprise inbox configured" }, 400);
  const inboxes = resolveInboxes(settings);

  const { data: jobRow } = await supabase.from("intercom_sync_jobs_v3").insert({
    kind: "gap_scan",
    status: "running",
    started_at: new Date().toISOString(),
  }).select("id").single();

  // Day buckets, clamped to CLEAN_DATA_START
  const cleanStart = new Date(CLEAN_DATA_START_ISO);
  const now = new Date();
  const buckets: { dayStart: Date; dayEnd: Date }[] = [];
  for (let i = lookbackDays - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - i);
    if (day < cleanStart) continue;
    const end = new Date(day);
    end.setUTCDate(end.getUTCDate() + 1);
    buckets.push({ dayStart: day, dayEnd: end });
  }

  const discrepancies: Array<{ day: string; intercom: number; ours: number; diff: number }> = [];
  const enqueued: Array<{ day: string; result: any }> = [];

  for (const b of buckets) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;

    const sinceSec = Math.floor(b.dayStart.getTime() / 1000);
    const untilSec = Math.floor(b.dayEnd.getTime() / 1000);

    // Intercom side — total_count via per_page:1
    const icCount = await intercomClosedCount(
      INTERCOM_API_TOKEN, inboxes.ids, sinceSec, untilSec,
    );

    // Our side
    const { count: ourCount } = await supabase
      .from("intercom_tickets_v3")
      .select("id", { count: "exact", head: true })
      .gte("intercom_closed_at", b.dayStart.toISOString())
      .lt("intercom_closed_at", b.dayEnd.toISOString())
      .eq("lifecycle_status", "finalized");

    const ours = ourCount ?? 0;
    const dayLabel = b.dayStart.toISOString().slice(0, 10);
    const diff = (icCount ?? 0) - ours;

    if (icCount != null && diff > 0) {
      discrepancies.push({ day: dayLabel, intercom: icCount, ours, diff });
      // Self-invoke sync-v3-closed in backfill mode for this day
      try {
        const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-v3-closed`;
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            mode: "backfill",
            windowStart: b.dayStart.toISOString(),
            windowEnd: b.dayEnd.toISOString(),
            maxBatch: Math.max(50, diff + 10),
          }),
        });
        const result = await r.json().catch(() => ({}));
        enqueued.push({ day: dayLabel, result });
      } catch (e) {
        console.error(`[gap-scan] backfill ${dayLabel} failed:`, (e as Error).message);
      }
    }
  }

  await supabase.from("intercom_sync_jobs_v3").update({
    status: "done",
    processed: buckets.length,
    finished_at: new Date().toISOString(),
    cursor_extra: { discrepancies, enqueued } as any,
  }).eq("id", jobRow?.id);

  return json({
    ok: true,
    lookbackDays,
    bucketsChecked: buckets.length,
    discrepancies,
    enqueued: enqueued.length,
    elapsed_ms: Date.now() - startedAt,
  });
});

async function intercomClosedCount(
  token: string,
  inboxIds: string[],
  sinceSec: number,
  untilSec: number,
): Promise<number | null> {
  const res = await fetch("https://api.intercom.io/conversations/search", {
    method: "POST",
    headers: intercomHeaders(token),
    body: JSON.stringify({
      query: {
        operator: "AND",
        value: [
          inboxSearchClause(inboxIds),
          { field: "state", operator: "=", value: "closed" },
          { field: "statistics.last_close_at", operator: ">", value: sinceSec },
          { field: "statistics.last_close_at", operator: "<", value: untilSec },
        ],
      },
      pagination: { per_page: 1 },
    }),
  });
  if (!res.ok) {
    console.error("[gap-scan] count search failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return typeof data.total_count === "number" ? data.total_count : null;
}

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}
