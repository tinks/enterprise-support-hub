// Short-lived in-isolate cache for the single-row `settings` table.
//
// High-frequency functions (slack-events, intercom-webhook, polls) read the same
// one-row table on every invocation, which produced >1.5M sequential scans.
// Warm isolates now reuse the row for TTL_MS, which cuts reads dramatically while
// keeping staleness bounded to under a minute.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const TTL_MS = 30_000;

let cached: Record<string, unknown> | null = null;
let cachedAt = 0;

export async function getSettings(
  sb: SupabaseClient,
  opts?: { force?: boolean },
): Promise<Record<string, unknown> | null> {
  if (!opts?.force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  const { data } = await sb.from("settings").select("*").limit(1).maybeSingle();
  if (data) {
    cached = data as Record<string, unknown>;
    cachedAt = Date.now();
  }
  return cached;
}

// Call after writing to `settings` so the next read does not serve a stale row.
export function invalidateSettings(): void {
  cached = null;
  cachedAt = 0;
}
