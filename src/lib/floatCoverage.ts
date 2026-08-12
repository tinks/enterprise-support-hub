// Float-coverage shift matching.
// ---------------------------------------------------------------------------
// Decides who is on point for new-ticket Slack alerts at a given instant.
//
// KEEP IN SYNC with supabase/functions/_shared/float-coverage.ts — the browser
// preview ("on call right now") and the actual Slack ping must never disagree.
// The two copies exist only because Deno cannot import from src/; the logic is
// intentionally identical and covered by the same cases in floatCoverage.test.ts.
// ---------------------------------------------------------------------------

export type FloatShift = {
  id?: string;
  slack_user_id: string;
  display_name: string;
  /** Inclusive, YYYY-MM-DD, interpreted in the shift's own time_zone. */
  starts_on: string;
  /** Inclusive, YYYY-MM-DD, interpreted in the shift's own time_zone. */
  ends_on: string;
  /** HH:MM or HH:MM:SS, local to time_zone. */
  start_time: string;
  /** HH:MM or HH:MM:SS, local to time_zone. end < start means the window crosses midnight. */
  end_time: string;
  /** IANA zone, e.g. America/Los_Angeles. */
  time_zone: string;
  active?: boolean;
};

/** Minutes since local midnight for "HH:MM" / "HH:MM:SS". */
export function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/**
 * Wall-clock date + minute-of-day at `instant`, as observed in `timeZone`.
 * Uses Intl so DST is handled by the runtime's tz database rather than a
 * fixed offset — a noon-Pacific shift stays at noon across a DST boundary.
 * An invalid zone throws; callers treat that shift as non-matching.
 */
export function zonedParts(instant: Date, timeZone: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  // en-CA renders midnight as "24" in some runtimes; normalize to 0.
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** Shift the YYYY-MM-DD calendar date by `days` without touching timezones. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const inRange = (date: string, start: string, end: string) => date >= start && date <= end;

/**
 * Is `shift` covering `instant`?
 *
 * Same-day window: the local date must fall inside [starts_on, ends_on] and the
 * local time inside [start_time, end_time) — end-exclusive so back-to-back
 * shifts don't double-ping on the boundary minute.
 *
 * Midnight-crossing window (end_time < start_time): the block that BEGINS on
 * date D runs from D start_time to D+1 end_time. So the early-morning tail is
 * matched against the previous local date, which is what keeps the last day of
 * a range from silently losing its overnight hours.
 */
export function shiftCoversInstant(shift: FloatShift, instant: Date): boolean {
  if (shift.active === false) return false;
  let now: { date: string; minutes: number };
  try {
    now = zonedParts(instant, shift.time_zone);
  } catch {
    return false;
  }
  const start = parseTimeToMinutes(shift.start_time);
  const end = parseTimeToMinutes(shift.end_time);

  if (end > start) {
    return inRange(now.date, shift.starts_on, shift.ends_on) &&
      now.minutes >= start && now.minutes < end;
  }
  // Crosses midnight.
  if (now.minutes >= start && inRange(now.date, shift.starts_on, shift.ends_on)) return true;
  if (now.minutes < end && inRange(addDays(now.date, -1), shift.starts_on, shift.ends_on)) return true;
  return false;
}

/** Every shift covering `instant`, in input order. */
export function shiftsCovering<T extends FloatShift>(shifts: T[], instant: Date): T[] {
  return shifts.filter((s) => shiftCoversInstant(s, instant));
}

/** De-duplicated Slack user IDs on point at `instant`. */
export function coveringSlackIds(shifts: FloatShift[], instant: Date): string[] {
  return Array.from(new Set(shiftsCovering(shifts, instant).map((s) => s.slack_user_id)));
}
