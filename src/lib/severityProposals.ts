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

/**
 * Stamps the live proposal with what the human actually settled on. Called ONLY
 * after Intercom accepted the write — a refused write leaves the proposal open,
 * because nothing was decided.
 *
 * accepted   → the human took the AI's number
 * overridden → the human wrote a different number; this is the signal the
 *              few-shot loop leans on hardest.
 */
export async function recordSeverityDecision(
  conversationId: string,
  finalSeverity: number,
): Promise<void> {
  const live = await supabase
    .from("severity_proposals")
    .select("id, proposed_severity")
    .eq("intercom_conversation_id", conversationId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = live.data as { id: string; proposed_severity: number } | null;
  if (!row) return; // no open proposal — a plain human triage, nothing to label

  const { data: userData } = await supabase.auth.getUser();

  await supabase
    .from("severity_proposals")
    .update({
      status: row.proposed_severity === finalSeverity ? "accepted" : "overridden",
      final_severity: finalSeverity,
      decided_by: userData.user?.id ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", row.id);
}
