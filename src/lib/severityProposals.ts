import { supabase } from "@/integrations/supabase/client";

export type SeverityProposal = {
  id: string;
  intercom_conversation_id: string;
  pass: "triage" | "reclassify";
  proposed_severity: number;
  confidence: "high" | "medium" | "low";
  rationale: string;
  evidence: string | null;
  rubric_version: number | null;
  model: string | null;
  status: "proposed" | "accepted" | "overridden" | "superseded";
  final_severity: number | null;
  created_at: string;
};

/** Newest proposal for a ticket, whatever its status. */
export async function fetchLatestProposal(
  conversationId: string,
): Promise<SeverityProposal | null> {
  const { data } = await supabase
    .from("severity_proposals")
    .select("*")
    .eq("intercom_conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SeverityProposal | null) ?? null;
}

/** Reason codes offered when a human overrides the AI's number. */

export const OVERRIDE_REASON_CODES = [
  { code: "wrong_impact_scope", label: "Wrong impact / scope" },
  { code: "wrong_urgency", label: "Wrong urgency" },
  { code: "missed_workaround", label: "Missed a workaround" },
  { code: "customer_tier", label: "Customer tier not weighted" },
  { code: "known_issue_duplicate", label: "Known issue / duplicate" },
  { code: "rubric_gap", label: "Rubric gap — no line covers this" },
  { code: "ai_misread_ticket", label: "AI misread the ticket" },
  { code: "other", label: "Other" },
] as const;

export type SeverityDecision = {
  proposalId: string;
  status: "accepted" | "overridden";
  proposedSeverity: number;
  finalSeverity: number;
};

/**
 * Stamps the live proposal with what the human actually settled on. Called ONLY
 * after Intercom accepted the write — a refused write leaves the proposal open,
 * because nothing was decided.
 *
 * accepted   -> the human took the AI's number
 * overridden -> the human wrote a different number; this is the signal the
 *               few-shot loop leans on hardest, so the caller then asks why.
 *
 * Returns the decision (so an override can be given a reason), or null when
 * there was no open proposal to label.
 */
export async function recordSeverityDecision(
  conversationId: string,
  finalSeverity: number,
): Promise<SeverityDecision | null> {
  const live = await supabase
    .from("severity_proposals")
    .select("id, proposed_severity")
    .eq("intercom_conversation_id", conversationId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = live.data as { id: string; proposed_severity: number } | null;
  if (!row) return null; // no open proposal - a plain human triage, nothing to label

  const { data: userData } = await supabase.auth.getUser();
  const status = row.proposed_severity === finalSeverity ? "accepted" : "overridden";

  await supabase
    .from("severity_proposals")
    .update({
      status,
      final_severity: finalSeverity,
      decided_by: userData.user?.id ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return {
    proposalId: row.id,
    status,
    proposedSeverity: row.proposed_severity,
    finalSeverity,
  };
}

/** The negative signal: why the human disagreed. Attached to a real decision. */
export async function saveOverrideReason(
  proposalId: string,
  code: string,
  note?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("severity_proposals")
    .update({
      override_reason_code: code,
      override_reason_note: (note ?? "").trim().slice(0, 500) || null,
    })
    .eq("id", proposalId);
  return { error: error?.message ?? null };
}
