// Engineering-wait escalation facts loader.
//
// The engineering-wait bucket needs two things the Intercom payload does not
// carry: when the Hub first recorded the escalation, and when the Linear issue
// actually finished. Both live on public.dev_escalations (mirrored read-only
// from Linear by sync-linear-escalations).
//
// Read-only. Returns a map keyed by intercom_conversation_id.

import type { EngEscalation } from "./sla-core.ts";
import { isLinearReferenceValue } from "./sla-core.ts";

function toSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export type EngEscalationMap = Map<string, EngEscalation[]>;

/**
 * Load escalation facts for the given conversation ids (chunked).
 *
 * A conversation may carry SEVERAL Linear issues: the Hub decision row lives on
 * dev_escalations, while dev_escalation_links mirrors every referenced issue.
 * Both are read; the engine unions their windows.
 */
export async function loadEngEscalations(
  supabase: any,
  conversationIds: string[],
): Promise<EngEscalationMap> {
  const map: EngEscalationMap = new Map();
  const ids = Array.from(new Set(conversationIds.filter(Boolean)));
  const push = (convId: string, e: EngEscalation) => {
    const list = map.get(convId) ?? [];
    list.push(e);
    map.set(convId, list);
  };

  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [base, links] = await Promise.all([
      supabase
        .from("dev_escalations")
        .select(
          "intercom_conversation_id, linear_key, created_at, linear_created_at, linear_completed_at, linear_canceled_at",
        )
        .in("intercom_conversation_id", chunk),
      supabase
        .from("dev_escalation_links")
        .select(
          "intercom_conversation_id, linear_key, linear_created_at, linear_completed_at, linear_canceled_at",
        )
        .in("intercom_conversation_id", chunk),
    ]);
    if (base.error) {
      console.error(`[eng-wait] escalation load failed: ${base.error.message}`);
      continue; // absent facts degrade the window, they never fabricate one
    }
    if (links.error) {
      console.error(`[eng-wait] escalation links load failed: ${links.error.message}`);
    }

    // Keys already covered by a link row are skipped on the base row so one
    // issue is never counted from two sources.
    const linkKeys = new Map<string, Set<string>>();
    for (const r of links.data ?? []) {
      const set = linkKeys.get(r.intercom_conversation_id) ?? new Set<string>();
      set.add(String(r.linear_key));
      linkKeys.set(r.intercom_conversation_id, set);
      push(r.intercom_conversation_id, {
        escalationRowAtS: null,
        linearCreatedAtS: toSec(r.linear_created_at),
        linearCompletedAtS: toSec(r.linear_completed_at),
        linearCanceledAtS: toSec(r.linear_canceled_at),
      });
    }
    for (const r of base.data ?? []) {
      const covered =
        r.linear_key && linkKeys.get(r.intercom_conversation_id)?.has(String(r.linear_key));
      if (covered) {
        // Keep the Hub row date as evidence the escalation existed before the
        // Linear issue was resolvable.
        const list = map.get(r.intercom_conversation_id)!;
        list[0] = { ...list[0], escalationRowAtS: toSec(r.created_at) };
        continue;
      }
      push(r.intercom_conversation_id, {
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
): Promise<EngEscalation[] | null> {
  const map = await loadEngEscalations(supabase, [conversationId]);
  return map.get(conversationId) ?? null;
}


/** Cheap pre-check: does this payload reference a Linear issue at all? */
export function hasLinearReference(icData: any): boolean {
  const attrs = (icData?.custom_attributes ?? {}) as Record<string, unknown>;
  for (const k of ["Escalated Issue", "Linear Issue"]) {
    if (isLinearReferenceValue(attrs[k])) return true;
  }
  const parts = icData?.conversation_parts?.conversation_parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const name = p?.event_details?.attribute?.name;
      if (name === "Escalated Issue" || name === "Linear Issue") {
        if (isLinearReferenceValue(p?.event_details?.value?.name)) return true;
      }
    }
  }
  return false;
}
