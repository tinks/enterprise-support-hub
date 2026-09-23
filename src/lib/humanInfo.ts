/**
 * Human Info Block — review-state model + Slack assembler.
 *
 * The extraction (extract-human-info) is a DRAFT. This module owns the
 * human-reviewed form state, the submit gate, and the text that is prepended
 * above the unchanged Pax request in Slack. Provenance tags travel with every
 * field into the posted text.
 */

export type Provenance = "deterministic" | "direct_quote" | "inferred";

export const PROVENANCE_TAG: Record<Provenance, string> = {
  deterministic: "🟢 Deterministic",
  direct_quote: "🟡 Direct Quote",
  inferred: "🔴 Inferred",
};

export type ReproStatus =
  | "customer_reported_unverified"
  | "support_verified"
  | "attempted_could_not_reproduce_infra_limitation";

export const REPRO_LABEL: Record<ReproStatus, string> = {
  customer_reported_unverified: "Customer reported (unverified)",
  support_verified: "Verified reproduced",
  attempted_could_not_reproduce_infra_limitation: "Could not reproduce (infra limitation)",
};

export type IdField = { primary: string | null; candidates: { id: string; context: string }[] };

export type Extraction = {
  summary: { value: string; provenance: "inferred"; insufficient_data?: boolean };
  customer_statement: { value: string; provenance: "direct_quote" };
  identifiers: {
    user_id: IdField;
    project_id: IdField;
    workspace_id: IdField;
    slack_thread_url: { value: string | null };
  };
  impact: {
    technical_severity: "blocking" | "degraded" | "workaround_available" | "minor";
    technical_scope: "single_user" | "multiple_users" | "workspace_wide" | "unspecified";
    technical_description: string;
    customer_stated_urgency: { value: string | null };
  };
  repro_steps: { status: "customer_reported_unverified"; steps: string[]; provenance: "direct_quote" | "inferred" };
  expected_vs_observed: { expected: string; observed: string; provenance: "direct_quote" | "inferred" };
  evidence_links: { urls: string[] };
};

export type ReviewState = {
  summary: string;
  customerStatement: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  expected: string;
  observed: string;
  evoProvenance: Provenance;
  reproProvenance: Provenance;
  evidence: string;
  reproSteps: string;
  reproStatus: ReproStatus;
  /** True only after a deliberate click on the repro selector. */
  reproTouched: boolean;
  infraReason: string;
};

export function initialReview(x: Extraction): ReviewState {
  return {
    summary: x.summary.value ?? "",
    customerStatement: x.customer_statement.value ?? "",
    userId: x.identifiers.user_id.primary ?? "",
    projectId: x.identifiers.project_id.primary ?? "",
    workspaceId: x.identifiers.workspace_id.primary ?? "",
    expected: x.expected_vs_observed.expected ?? "",
    observed: x.expected_vs_observed.observed ?? "",
    evoProvenance: x.expected_vs_observed.provenance,
    reproProvenance: x.repro_steps.provenance,
    evidence: (x.evidence_links.urls ?? []).join("\n"),
    reproSteps: (x.repro_steps.steps ?? []).join("\n"),
    reproStatus: "customer_reported_unverified",
    reproTouched: false,
    infraReason: "",
  };
}

/** Form validation. Submit is allowed only when this returns []. */
export function reviewBlockers(s: ReviewState): string[] {
  const out: string[] = [];
  if (!s.reproTouched) out.push("Confirm the reproduction status");
  if (s.reproStatus === "attempted_could_not_reproduce_infra_limitation" && !s.infraReason.trim()) {
    out.push("Give the infra limitation reason");
  }
  if (!s.summary.trim()) out.push("Summary is required");
  return out;
}

const SEV: Record<string, string> = {
  blocking: "Blocking",
  degraded: "Degraded",
  workaround_available: "Workaround available",
  minor: "Minor",
};
const SCOPE: Record<string, string> = {
  single_user: "single user",
  multiple_users: "multiple users",
  workspace_wide: "workspace-wide",
  unspecified: "scope unspecified",
};
export const severityLabel = (s: string) => SEV[s] ?? s;
export const scopeLabel = (s: string) => SCOPE[s] ?? s;

/** Slack mrkdwn block posted ABOVE the Pax request. Throws if invalid. */
export function assembleHumanInfo(s: ReviewState, x: Extraction, reviewer: string | null): string {
  const blockers = reviewBlockers(s);
  if (blockers.length) throw new Error(blockers.join("; "));
  const tag = (p: Provenance) => `_${PROVENANCE_TAG[p]}_`;
  const L: string[] = [];
  L.push(`*Human Info — reviewed${reviewer ? ` by ${reviewer}` : ""}*`);
  L.push(`*Summary* ${tag("inferred")}\n${s.summary.trim()}`);
  if (s.customerStatement.trim()) {
    L.push(`*Customer statement* ${tag("direct_quote")}\n> ${s.customerStatement.trim().replace(/\n/g, "\n> ")}`);
  }
  const ids = [
    ["User", s.userId],
    ["Project", s.projectId],
    ["Workspace", s.workspaceId],
  ].filter(([, v]) => v.trim());
  if (ids.length) {
    L.push(`*Identifiers* ${tag("deterministic")}\n${ids.map(([k, v]) => `• ${k}: \`${v.trim()}\``).join("\n")}`);
  }
  const urg = x.impact.customer_stated_urgency.value;
  L.push(
    `*Impact* ${tag("inferred")}\n${severityLabel(x.impact.technical_severity)} · ${scopeLabel(x.impact.technical_scope)} — ${x.impact.technical_description}` +
      (urg ? `\nCustomer-stated urgency ${tag("direct_quote")}: _"${urg}"_` : ""),
  );
  let repro = `*Reproduction:* ${REPRO_LABEL[s.reproStatus]}`;
  if (s.reproStatus === "attempted_could_not_reproduce_infra_limitation") {
    repro += `\nInfra limitation: ${s.infraReason.trim()}`;
  }
  const steps = s.reproSteps.split("\n").map((t) => t.trim()).filter(Boolean);
  if (steps.length) repro += ` ${tag(s.reproProvenance)}\n${steps.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  L.push(repro);
  if (s.expected.trim() || s.observed.trim()) {
    L.push(`*Expected vs observed* ${tag(s.evoProvenance)}\n• Expected: ${s.expected.trim() || "—"}\n• Observed: ${s.observed.trim() || "—"}`);
  }
  const urls = s.evidence.split(/\s+/).map((u) => u.trim()).filter(Boolean);
  if (urls.length) L.push(`*Evidence* ${tag("deterministic")}\n${urls.map((u) => `• ${u}`).join("\n")}`);
  return L.join("\n\n");
}
