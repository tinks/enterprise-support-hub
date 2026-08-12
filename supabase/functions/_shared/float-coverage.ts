// Float-coverage shift matching (Deno copy).
// ---------------------------------------------------------------------------
// KEEP IN SYNC with src/lib/floatCoverage.ts. Same logic, duplicated only
// because Deno cannot import from src/. The browser preview ("on call right
// now") and the actual Slack ping must never disagree; the browser copy carries
// the unit tests.
// ---------------------------------------------------------------------------

export type FloatShift = {
  slack_user_id: string;
  display_name?: string;
  starts_on: string;
  ends_on: string;
  start_time: string;
  end_time: string;
  time_zone: string;
  active?: boolean;
};

export function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

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
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const inRange = (date: string, start: string, end: string) => date >= start && date <= end;

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
  if (now.minutes >= start && inRange(now.date, shift.starts_on, shift.ends_on)) return true;
  if (now.minutes < end && inRange(addDays(now.date, -1), shift.starts_on, shift.ends_on)) return true;
  return false;
}

export function coveringSlackIds(shifts: FloatShift[], instant: Date): string[] {
  return Array.from(
    new Set(shifts.filter((s) => shiftCoversInstant(s, instant)).map((s) => s.slack_user_id)),
  );
}
