// Shared derivation helper for v3 ticket customer_key.
//
// LOCKSTEP CONTRACT (Phase 2b):
// The BEFORE INSERT/UPDATE trigger `intercom_tickets_v3_apply_customer` on the
// DB is authoritative — it re-derives customer_key/kind/source/confidence/
// resolution_method on every write regardless of what the caller passes in.
// This helper exists so sync-time code can compute the same value pre-write
// for logging or fallback purposes, AND so any future edge function that
// needs to display a derived customer without touching the DB can call it.
//
// Rule order (first match wins):
//   1. customer_override_key -> use as-is (method=override, confidence=high)
//   2. slack_channel_id_detected present AND not in v3_internal_channels AND
//      in v3_channel_account_map -> mapped account (method=slack_channel, high)
//   3. contact-email domain in v3_customer_accounts.domains, excluding
//      lovable.dev and personal domains -> account (method=domain, high)
//   4. workspace_id_detected in v3_workspace_customer_map -> account
//      (method=workspace_id, medium — best-guess pending confirmation)
//   5. otherwise -> customer_key='unattributed' (method=unresolved)
//
// If you change the rule order or add a rule here, you MUST update:
//   1. public.v3_derive_customer (SQL) — authoritative
//   2. public.intercom_tickets_v3_apply_customer trigger fn
//   3. propagate triggers on v3_customer_accounts, v3_workspace_customer_map,
//      v3_channel_account_map, v3_internal_channels — they bump ticket
//      updated_at to re-fire the derive trigger.
// Keep all in lockstep.

export type DerivedCustomer = {
  customer_key: string;
  customer_kind: "account" | "domain" | "personal" | "unknown";
  customer_source: string;
  customer_confidence: "high" | "medium" | "low" | "unresolved";
  customer_resolution_method:
    | "override"
    | "slack_channel"
    | "domain"
    | "workspace_id"
    | "unresolved";
};

export async function resolveV3Customer(
  supabase: any,
  contactEmail: string | null,
  overrideKey: string | null,
  opts: {
    contactDomain?: string | null;
    slackChannelIdDetected?: string | null;
    workspaceIdDetected?: string | null;
  } = {},
): Promise<DerivedCustomer> {
  const { data } = await supabase.rpc("v3_derive_customer", {
    _contact_email: contactEmail,
    _override_key: overrideKey,
    _contact_domain: opts.contactDomain ?? null,
    _slack_channel_id_detected: opts.slackChannelIdDetected ?? null,
    _workspace_id_detected: opts.workspaceIdDetected ?? null,
  });
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) {
    return {
      customer_key: "unattributed",
      customer_kind: "unknown",
      customer_source: "unresolved",
      customer_confidence: "unresolved",
      customer_resolution_method: "unresolved",
    };
  }
  return r as DerivedCustomer;
}
