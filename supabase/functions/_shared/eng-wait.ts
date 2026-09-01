// Engineering-wait escalation facts loader.
//
// The engineering-wait bucket needs two things the Intercom payload does not
// carry: when the Hub first recorded the escalation, and when the Linear issue
// actually finished. Both live on public.dev_escalations (mirrored read-only
// from Linear by sync-linear-escalations).
//
// Read-only. Returns a map keyed by intercom_conversation_id.

import type { EngEscalation } from "./sla-core.ts";

function toSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export type EngEscalationMap = Map<string, EngEscalation>;

/** Load escalation facts for the given conversation ids (chunked). */
export async function loadEngEscalations(
  supabase: any,
  conversationIds: string[],
): Promise<EngEscalationMap> {
  const map: EngEscalationMap = new Map();
  const ids = Array.from(new Set(conversationIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabase
      .from("dev_escalations")
      .select(
        "intercom_conversation_id, created_at, linear_created_at, linear_completed_at, linear_canceled_at",
      )
      .in("intercom_conversation_id", chunk);
    if (error) {
      console.error(`[eng-wait] escalation load failed: ${error.message}`);
      continue; // absent facts degrade the window, they never fabricate one
    }
    for (const r of data ?? []) {
      map.set(r.intercom_conversation_id, {
        escalationRowAtS: toSec(r.created_at),
        linearCreatedAtS: toSec(r.linear_created_at),
        linearCompletedAtS: toSec(r.linear_completed_at),
        linearCanceledAtS: toSec(r.linear_canceled_at),
      });
    }
  }
  return map;
}

/** Single-conversation convenience wrapper used by the finalize writer. */
export async function loadEngEscalation(
  supabase: any,
  conversationId: string,
): Promise<EngEscalation | null> {
  const map = await loadEngEscalations(supabase, [conversationId]);
  return map.get(conversationId) ?? null;
}

/** Cheap pre-check: does this payload reference a Linear issue at all? */
export function hasLinearReference(icData: any): boolean {
  const attrs = (icData?.custom_attributes ?? {}) as Record<string, unknown>;
  for (const k of ["Escalated Issue", "Linear Issue"]) {
    const v = attrs[k];
    if (typeof v === "string" && v.trim()) return true;
  }
  const parts = icData?.conversation_parts?.conversation_parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const name = p?.event_details?.attribute?.name;
      if (name === "Escalated Issue" || name === "Linear Issue") {
        const val = p?.event_details?.value?.name;
        if (typeof val === "string" && val.trim()) return true;
      }
    }
  }
  return false;
}
