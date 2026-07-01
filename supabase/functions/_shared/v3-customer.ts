// Shared derivation helper for v3 ticket customer_key.
//
// LOCKSTEP CONTRACT:
// The BEFORE INSERT/UPDATE trigger `intercom_tickets_v3_apply_customer` on the
// DB is authoritative — it re-derives customer_key/kind/source on every write
// regardless of what the caller passes in. This helper exists so sync-time
// code (sync-v3-closed / sync-v3-open) can compute the same value pre-write
// for logging or fallback purposes, AND so any future edge function that needs
// to display a derived customer without touching the DB can call it.
//
// If you change the rule order or add a rule here, you MUST update:
//   1. public.v3_derive_customer (SQL) in the initial migration
//   2. public.v3_customer_accounts_propagate (SQL) — implements its own
//      domain-match to compute affected tickets when accounts change
// Keep all three in lockstep.

export type DerivedCustomer = {
  customer_key: string;
  customer_kind: "account" | "domain" | "personal" | "unknown";
  customer_source: "override" | "domain_match" | "personal_allowlist" | "generic_domain" | "no_email";
};

export async function resolveV3Customer(
  supabase: any,
  contactEmail: string | null,
  overrideKey: string | null,
): Promise<DerivedCustomer> {
  const { data } = await supabase.rpc("v3_derive_customer", {
    _contact_email: contactEmail,
    _override_key: overrideKey,
  });
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { customer_key: "unknown", customer_kind: "unknown", customer_source: "no_email" };
  return r as DerivedCustomer;
}
