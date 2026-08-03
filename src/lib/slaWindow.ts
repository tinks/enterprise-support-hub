// Shared date-window helpers for SLA views (Dashboard + Workbench).
export type DateWindow = "7d" | "30d" | "90d" | "month" | "last_month" | "all";

export const WINDOW_LABELS: Record<DateWindow, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
  last_month: "Last month",
  all: "All time",
};

export const WINDOW_CAPTIONS: Record<DateWindow, string> = {
  "7d": "resolved in the last 7 days",
  "30d": "resolved in the last 30 days",
  "90d": "resolved in the last 90 days",
  month: "resolved this month",
  last_month: "resolved last month",
  all: "resolved (all time)",
};

// Bounded window range. endMs is exclusive; null means "no bound".
export function windowRange(
  w: DateWindow,
  now: Date,
): { startMs: number | null; endMs: number | null } {
  if (w === "all") return { startMs: null, endMs: null };
  if (w === "month") {
    return { startMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), endMs: null };
  }
  if (w === "last_month") {
    return {
      startMs: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      endMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    };
  }
  const days = w === "7d" ? 7 : w === "30d" ? 30 : 90;
  return { startMs: now.getTime() - days * 24 * 60 * 60 * 1000, endMs: null };
}

export function windowStartMs(w: DateWindow, now: Date): number | null {
  return windowRange(w, now).startMs;
}

type RowLike = {
  intercom_closed_at?: string | null;
  raw_payload?: { statistics?: { last_close_at?: number | null } | null } | null;
};

export function rowClosedAtMs(r: RowLike): number | null {
  if (r.intercom_closed_at) {
    const t = Date.parse(r.intercom_closed_at);
    if (!Number.isNaN(t)) return t;
  }
  const s = r.raw_payload?.statistics?.last_close_at;
  if (typeof s === "number" && s > 0) return s * 1000;
  return null;
}
