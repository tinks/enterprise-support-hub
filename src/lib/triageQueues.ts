// Shared predicates for the Triage page's queues, so the page and the Action
// Center signal can never drift (same pattern as slaExclusions.ts).

export type TriageQueueMode = "needs_severity" | "unassigned" | "either";

export const TRIAGE_MODE_LABEL: Record<TriageQueueMode, string> = {
  needs_severity: "Needs severity",
  unassigned: "Unassigned",
  either: "Either missing",
};

export function isTriageMode(v: string | null | undefined): v is TriageQueueMode {
  return v === "needs_severity" || v === "unassigned" || v === "either";
}

export type AssignmentRow = {
  admin_assignee_id?: string | null;
  owner?: string | null;
};

const blank = (v: string | null | undefined) => v == null || String(v).trim() === "";

/** No Intercom assignee at all, OR an assignee that isn't mapped to a Hub owner. */
export function isUnassigned(row: AssignmentRow): boolean {
  return blank(row.admin_assignee_id) || blank(row.owner);
}

/** Which half of "unassigned" is missing — for the queue's Missing column. */
export function assignmentGap(row: AssignmentRow): "no_assignee" | "unmapped" | null {
  if (blank(row.admin_assignee_id)) return "no_assignee";
  if (blank(row.owner)) return "unmapped";
  return null;
}

export const ASSIGNMENT_GAP_LABEL: Record<"no_assignee" | "unmapped", string> = {
  no_assignee: "no Intercom assignee",
  unmapped: "assignee not mapped",
};

export function hasSeverityValue(attrs: any): boolean {
  const v = attrs?.["Severity"];
  return v != null && String(v).trim() !== "";
}

/** True when the row belongs in the given queue mode. */
export function inTriageMode(
  mode: TriageQueueMode,
  row: AssignmentRow & { custom_attributes?: any },
): boolean {
  const needsSeverity = !hasSeverityValue(row.custom_attributes);
  const unassigned = isUnassigned(row);
  if (mode === "needs_severity") return needsSeverity;
  if (mode === "unassigned") return unassigned;
  return needsSeverity || unassigned;
}
