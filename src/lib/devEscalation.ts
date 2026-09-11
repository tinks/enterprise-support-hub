/**
 * Dev-escalation follow-up model shared by My Queue.
 *
 * READ-ONLY over Linear facts (linear_* columns are written only by
 * sync-linear-escalations). The only Hub-owned fields here are the follow-up
 * cadence and the human acknowledgement of a shipped fix — neither of which
 * touches Intercom, Linear, or any reported number.
 */

export type DevEscalation = {
  id: string;
  intercom_conversation_id: string;
  hub_state: string;
  linear_key: string | null;
  linear_title: string | null;
  linear_state: string | null;
  linear_state_type: string | null;
  linear_assignee: string | null;
  linear_url_override: string | null;
  created_at: string | null;
  dev_followed_up_at: string | null;
  dev_followed_up_by: string | null;
  dev_next_followup_at: string | null;
  dev_followup_source: string | null;
  dev_fix_ack_at: string | null;
  dev_fix_ack_by: string | null;
  /** Hub-only: dev handed over a manual workaround, so stop chasing. */
  dev_workaround_at: string | null;
  dev_workaround_by: string | null;
  dev_workaround_note: string | null;
};

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Linear state types that mean engineering considers the work finished. */
const DONE_TYPES = ["completed", "canceled", "cancelled"];
/** Linear state types that mean nobody has actually picked the work up yet. */
const PRE_ACK_TYPES = ["backlog", "triage", "unstarted"];

function stateType(esc: DevEscalation): string {
  const t = (esc.linear_state_type ?? "").toLowerCase();
  if (t) return t;
  const s = (esc.linear_state ?? "").toLowerCase();
  if (!s) return "";
  if (["done", "completed", "fix shipped", "shipped", "released"].includes(s)) return "completed";
  if (["canceled", "cancelled", "duplicate", "won't do", "wont do"].includes(s)) return "canceled";
  if (["in progress", "started", "in review"].includes(s)) return "started";
  if (["backlog", "todo", "to do", "triage"].includes(s)) return "backlog";
  return "";
}

/** Engineering finished the work (Done / Canceled / Fix shipped). */
export function isDevDone(esc: DevEscalation): boolean {
  return DONE_TYPES.includes(stateType(esc));
}

/** Nobody has acknowledged the escalation yet — chase hard. */
export function isPreAck(esc: DevEscalation): boolean {
  const t = stateType(esc);
  if (!t) return !esc.linear_assignee;
  return PRE_ACK_TYPES.includes(t) || !esc.linear_assignee;
}

/**
 * Lifecycle default cadence:
 *   pre-ack / unassigned → 24 hours
 *   in flight            → 3 days
 */
export function defaultCadenceMs(esc: DevEscalation): number {
  return isPreAck(esc) ? 24 * HOUR_MS : 3 * DAY_MS;
}

export function cadenceLabel(esc: DevEscalation): string {
  return isPreAck(esc) ? "every 24h (awaiting ack)" : "every 3 days (in flight)";
}

/** When the next chase is due. Explicit override wins; otherwise derived. */
export function nextFollowupMs(esc: DevEscalation): number | null {
  if (esc.dev_next_followup_at) return new Date(esc.dev_next_followup_at).getTime();
  const base = esc.dev_followed_up_at ?? esc.created_at;
  if (!base) return null;
  return new Date(base).getTime() + defaultCadenceMs(esc);
}

/**
 * A human recorded that dev handed over a workaround. Hub-only: it silences the
 * chase clock and takes the ticket out of the dev buckets, but it never hides a
 * shipped fix — `isDevDone` still wins.
 */
export function hasWorkaround(esc: DevEscalation): boolean {
  return !!esc.dev_workaround_at;
}

export function needsChase(esc: DevEscalation): boolean {
  if (isDevDone(esc)) return false;
  if (hasWorkaround(esc)) return false;
  const due = nextFollowupMs(esc);
  return due != null && due <= Date.now();
}

/** A resolved escalation still waiting for a human to sign it off. */
export function needsFixAck(esc: DevEscalation): boolean {
  return isDevDone(esc) && !esc.dev_fix_ack_at;
}

export function linearUrl(esc: DevEscalation): string | null {
  if (esc.linear_key) return `https://linear.app/issue/${esc.linear_key}`;
  const raw = esc.linear_url_override ?? "";
  const m = raw.match(/https?:\/\/linear\.app\/[^\s]+/i);
  return m ? m[0] : null;
}

/** Quick-pick overrides offered on "Mark followed up". */
export const CADENCE_CHIPS: { label: string; ms: number }[] = [
  { label: "+1d", ms: DAY_MS },
  { label: "+3d", ms: 3 * DAY_MS },
  { label: "+1w", ms: 7 * DAY_MS },
];
