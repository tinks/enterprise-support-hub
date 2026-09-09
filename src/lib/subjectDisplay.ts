import { supabase } from "@/integrations/supabase/client";

/**
 * Hub-only subject layers for v3 tickets.
 *
 * WHY extra columns: `intercom_tickets_v3.subject` is rewritten from Intercom
 * on every sync run, so a hand-typed or AI-written value stored there would
 * silently vanish. `subject_override` (human) and `subject_ai` (model) are
 * never written by sync and never sent to Intercom — they are Hub labels, and
 * the Intercom subject stays readable underneath them.
 *
 * Display rule, used by EVERY surface so the Hub can never show two different
 * titles for one ticket:
 *   subject_override -> subject_ai -> subject -> "Untitled"
 *
 * Deliberately NOT used by the SLA engine: `slaMetrics` reads the subject off
 * `raw_payload.source` to infer email vs messenger intake, and a label must
 * never move a measurement.
 */
export type SubjectRow = {
  subject?: string | null;
  subject_override?: string | null;
  subject_ai?: string | null;
};

export type SubjectSource = "manual" | "ai" | "intercom" | "none";

/**
 * The single definition of a "useless" Intercom subject. Mirrored in
 * supabase/functions/generate-ticket-subject/index.ts — the two must agree.
 */
const PLACEHOLDER_RE = /^(intercom\s*#\d+|\(no subject\)|no subject|untitled|-|n\/a)$/i;

export function isPlaceholderSubject(s: string | null | undefined): boolean {
  const t = (s ?? "").trim();
  return t.length === 0 || PLACEHOLDER_RE.test(t);
}

export function displaySubject(row: SubjectRow | null | undefined, fallback = "Untitled"): string {
  const o = row?.subject_override?.trim();
  if (o) return o;
  const ai = row?.subject_ai?.trim();
  if (ai) return ai;
  const s = row?.subject?.trim();
  if (s) return s;
  return fallback;
}

export function subjectSource(row: SubjectRow | null | undefined): SubjectSource {
  if (row?.subject_override?.trim()) return "manual";
  if (row?.subject_ai?.trim()) return "ai";
  if (row?.subject?.trim()) return "intercom";
  return "none";
}

/** The raw Intercom subject, for tooltips and "what it was" hints. */
export function originalSubject(row: SubjectRow | null | undefined): string | null {
  const s = row?.subject?.trim();
  return s ? s : null;
}

export function isSubjectOverridden(row: SubjectRow | null | undefined): boolean {
  return Boolean(row?.subject_override?.trim());
}

export function isSubjectAiWritten(row: SubjectRow | null | undefined): boolean {
  return !isSubjectOverridden(row) && Boolean(row?.subject_ai?.trim());
}

/** Columns every v3 select needs so the display rule can be applied. */
export const SUBJECT_SELECT = "subject,subject_override,subject_ai";

async function actorLabel(): Promise<{ id: string | null; label: string }> {
  const { data } = await supabase.auth.getUser();
  return { id: data.user?.id ?? null, label: data.user?.email ?? "unknown" };
}

/**
 * Set or clear the human override. `value === null` (or empty) clears it.
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

/**
 * Ask the model for a subject for ONE ticket. Works on any ticket, including
 * one whose Intercom subject is perfectly good. The function writes
 * `subject_ai` itself; the returned title is also handed back so the caller can
 * offer it as a draft the operator may edit into a manual label.
 */
export async function requestAiSubject(
  conversationId: string,
): Promise<{ error: string | null; subject: string | null }> {
  const { data, error } = await supabase.functions.invoke("generate-ticket-subject", {
    body: { mode: "manual", conversationId, force: true },
  });

  if (error) {
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const body = await ctx.text();
        if (body) detail = body.slice(0, 300);
      }
    } catch {
      /* keep the generic message */
    }
    return { error: detail, subject: null };
  }

  const first = (data as { results?: Array<{ ok?: boolean; subject_ai?: string; error?: string }> })
    ?.results?.[0];
  if (!first) return { error: "No result returned", subject: null };
  if (!first.ok || !first.subject_ai) {
    return { error: first.error ?? "The model returned no usable title", subject: null };
  }
  return { error: null, subject: first.subject_ai };
}

/** Drop the AI subject for a ticket so Intercom's own subject shows again. */
export async function clearAiSubject(
  conversationId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("intercom_tickets_v3")
    .update({
      subject_ai: null,
      subject_ai_at: null,
      subject_ai_model: null,
      subject_ai_source_hash: null,
    })
    .eq("intercom_conversation_id", conversationId);
  return { error: error ? error.message : null };
}
