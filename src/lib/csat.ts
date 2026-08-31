/**
 * CSAT truth helpers.
 *
 * Two things can make a raw Intercom rating misleading:
 *  1. The rater is internal (a lovable.dev teammate rating our own relay ticket).
 *  2. The rating is a documented misfire (e.g. a 1-star for closing a duplicate).
 *
 * Neither is hidden: internal ratings are flagged (`csat_rater_is_internal`),
 * and suppressions live as visible, reasoned rows in `csat_overrides`. This
 * module is the single place that decides which ratings count, so every
 * surface reports the same number.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CsatFilters = {
  /** Drop ratings given by lovable.dev staff / roster teammates. */
  excludeInternal: boolean;
  /** Drop ratings with a recorded suppression override. */
  excludeOverridden: boolean;
};

export const DEFAULT_CSAT_FILTERS: CsatFilters = {
  excludeInternal: true,
  excludeOverridden: true,
};

const STORAGE_KEY = "esh.csatFilters.v1";
const EVENT = "esh-csat-filters-changed";

function readStored(): CsatFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CSAT_FILTERS;
    const parsed = JSON.parse(raw);
    return {
      excludeInternal: Boolean(parsed?.excludeInternal),
      excludeOverridden: Boolean(parsed?.excludeOverridden),
    };
  } catch {
    return DEFAULT_CSAT_FILTERS;
  }
}

/** Shared, persisted CSAT filter state (all surfaces stay in sync). */
export function useCsatFilters(): [CsatFilters, (next: Partial<CsatFilters>) => void] {
  const [filters, setFilters] = useState<CsatFilters>(() => readStored());

  useEffect(() => {
    const onChange = () => setFilters(readStored());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const update = useCallback((next: Partial<CsatFilters>) => {
    const merged = { ...readStored(), ...next };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* non-fatal */
    }
    window.dispatchEvent(new Event(EVENT));
    setFilters(merged);
  }, []);

  return [filters, update];
}

export type CsatOverride = {
  id: string;
  ticket_id: string;
  intercom_conversation_id: string | null;
  original_rating: number | null;
  reason: string;
  created_by_email: string | null;
  created_at: string;
};

/** All CSAT suppressions, keyed by ticket id. */
export function useCsatOverrides() {
  const [map, setMap] = useState<Map<string, CsatOverride>>(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("csat_overrides")
      .select("id,ticket_id,intercom_conversation_id,original_rating,reason,created_by_email,created_at");
    if (!error) {
      const next = new Map<string, CsatOverride>();
      for (const row of (data ?? []) as CsatOverride[]) next.set(row.ticket_id, row);
      setMap(next);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { overrides: map, loading, refresh };
}

export type CsatRow = {
  id: string;
  csat_rating: number | null;
  csat_rater_is_internal?: boolean | null;
};

export type CsatSummary = {
  /** Ratings that count under the current filters. */
  n: number;
  avg: number | null;
  pctPositive: number | null;
  /** Total ratings before filtering. */
  rawN: number;
  internalExcluded: number;
  overriddenExcluded: number;
};

export function isRatingCounted(
  row: CsatRow,
  overrides: Map<string, CsatOverride>,
  filters: CsatFilters,
): boolean {
  const r = row.csat_rating;
  if (typeof r !== "number") return false;
  if (filters.excludeInternal && row.csat_rater_is_internal === true) return false;
  if (filters.excludeOverridden && overrides.has(row.id)) return false;
  return true;
}

export function summarizeCsat(
  rows: CsatRow[],
  overrides: Map<string, CsatOverride>,
  filters: CsatFilters,
): CsatSummary {
  const kept: number[] = [];
  let rawN = 0;
  let internalExcluded = 0;
  let overriddenExcluded = 0;

  for (const row of rows) {
    const r = row.csat_rating;
    if (typeof r !== "number") continue;
    rawN++;
    const isInternal = row.csat_rater_is_internal === true;
    const isOverridden = overrides.has(row.id);
    if (filters.excludeInternal && isInternal) {
      internalExcluded++;
      continue;
    }
    if (filters.excludeOverridden && isOverridden) {
      overriddenExcluded++;
      continue;
    }
    kept.push(r);
  }

  const n = kept.length;
  return {
    n,
    rawN,
    internalExcluded,
    overriddenExcluded,
    avg: n ? kept.reduce((a, b) => a + b, 0) / n : null,
    pctPositive: n ? (kept.filter((r) => r >= 4).length / n) * 100 : null,
  };
}

/** One-line provenance note for report footers — never hide what was removed. */
export function csatExclusionNote(s: CsatSummary): string | null {
  const parts: string[] = [];
  if (s.internalExcluded > 0) parts.push(`${s.internalExcluded} internal`);
  if (s.overriddenExcluded > 0) parts.push(`${s.overriddenExcluded} overridden`);
  if (parts.length === 0) return null;
  return `${parts.join(" + ")} excluded of ${s.rawN} responses`;
}
