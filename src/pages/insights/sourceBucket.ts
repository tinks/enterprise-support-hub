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
