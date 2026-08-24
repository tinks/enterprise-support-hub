import { supabase } from "@/integrations/supabase/client";

/**
 * Hub-only subject override for v3 tickets.
 *
 * WHY a second column: `intercom_tickets_v3.subject` is rewritten from Intercom
 * on every sync run, so a hand-typed value stored there would silently vanish.
 * `subject_override` is never written by sync and never sent to Intercom — it is
 * a Hub label, and the Intercom subject stays readable underneath it.
 *
 * Display rule, used by EVERY surface so the Hub can never show two different
 * titles for one ticket: override -> synced subject -> "Untitled".
 *
 * Deliberately NOT used by the SLA engine: `slaMetrics` reads the subject off
 * `raw_payload.source` to infer email vs messenger intake, and an operator's
 * label must never move a measurement.
 */
export type SubjectRow = {
  subject?: string | null;
  subject_override?: string | null;
};

export function displaySubject(row: SubjectRow | null | undefined, fallback = "Untitled"): string {
  const o = row?.subject_override?.trim();
  if (o) return o;
  const s = row?.subject?.trim();
  if (s) return s;
  return fallback;
}

/** The raw Intercom subject, for tooltips and "what it was" hints. */
export function originalSubject(row: SubjectRow | null | undefined): string | null {
  const s = row?.subject?.trim();
  return s ? s : null;
}

export function isSubjectOverridden(row: SubjectRow | null | undefined): boolean {
  return Boolean(row?.subject_override?.trim());
}

/** Columns every v3 select needs so the display rule can be applied. */
export const SUBJECT_SELECT = "subject,subject_override";

async function actorLabel(): Promise<{ id: string | null; label: string }> {
  const { data } = await supabase.auth.getUser();
  return { id: data.user?.id ?? null, label: data.user?.email ?? "unknown" };
}

/**
 * Set or clear the override. `value === null` (or empty) clears it.
 * Hub-only write: no `esh-write-action`, no Intercom call.
 */
export async function saveSubjectOverride(
  conversationId: string,
  value: string | null,
): Promise<{ error: string | null; saved: string | null }> {
  const next = value?.trim() ? value.trim() : null;
  const actor = await actorLabel();

  const { data: before, error: readError } = await supabase
    .from("intercom_tickets_v3")
    .select("id,subject,subject_override")
    .eq("intercom_conversation_id", conversationId)
    .maybeSingle();

  if (readError) return { error: readError.message, saved: null };
  if (!before) return { error: `No v3 row for Intercom #${conversationId}`, saved: null };

  const { data, error } = await supabase
    .from("intercom_tickets_v3")
    .update({
      subject_override: next,
      subject_override_by: next ? actor.id : null,
      subject_override_at: next ? new Date().toISOString() : null,
    })
    .eq("intercom_conversation_id", conversationId)
    .select("subject,subject_override")
    .maybeSingle();

  if (error) return { error: error.message, saved: null };
  if (!data) {
    // RLS refused the update: the row exists but nothing came back.
    return { error: "Update refused — editor role required.", saved: null };
  }

  // Audit trail. A failure here must not hide the fact the write landed.
  await supabase.from("conversation_audit_logs").insert({
    conversation_id: before.id,
    conversation_source: "intercom_v3",
    action: next ? "subject_override_set" : "subject_override_cleared",
    old_value: before.subject_override ?? before.subject ?? null,
    new_value: next,
    performed_by: actor.label,
  });

  return { error: null, saved: data.subject_override ?? null };
}
