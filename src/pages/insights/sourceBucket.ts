import { NormalizedTicket } from "./useMonthData";

export type SourceBucket = "slack" | "gmail" | "intercom" | "other";

/**
 * Bucket a ticket by ORIGIN. A Slack-originated ticket that was later
 * escalated/mirrored into Intercom still counts as Slack.
 * Manual imports flagged as Intercom-source land in "intercom".
 */
export function sourceBucketOf(t: NormalizedTicket): SourceBucket {
  if (t.route_source === "slack") return "slack";
  if (t.route_source === "gmail") return "gmail";
  if (t.display_source === "intercom") return "intercom";
  return "other";
}

export interface SourceReconciliation {
  total: number;
  counts: Record<SourceBucket, number>;
  sum: number;
  diff: number; // total - sum (should be 0)
  ok: boolean;
  unbucketed: NormalizedTicket[]; // tickets that didn't match any explicit bucket (fell through to "other" with no signals)
}

/**
 * Reconcile source bucket counts against total ticket count.
 * Verifies the invariant: Slack + Gmail + Intercom + Other === Total.
 * Also surfaces tickets with no route_source/display_source signal.
 */
export function reconcileSources(tickets: NormalizedTicket[]): SourceReconciliation {
  const counts: Record<SourceBucket, number> = { slack: 0, gmail: 0, intercom: 0, other: 0 };
  const unbucketed: NormalizedTicket[] = [];
  for (const t of tickets) {
    const b = sourceBucketOf(t);
    counts[b]++;
    if (b === "other" && !t.route_source && !t.display_source) unbucketed.push(t);
  }
  const sum = counts.slack + counts.gmail + counts.intercom + counts.other;
  const total = tickets.length;
  const diff = total - sum;
  return { total, counts, sum, diff, ok: diff === 0, unbucketed };
}
