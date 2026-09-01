// Single source of truth for "is this ticket outside the Enterprise SLA population?".
//
// Extracted from useSlaBatch.classifySlaBatchRow so that every surface that
// counts SLA risk (SLA workbench, Action Center signals) applies the SAME
// exclusion rules. Previously the Action Center queried the ticket mirror
// directly and knew nothing about tags / RSA / resolution method, so a ticket
// tagged `enterprise-duplicate` could alert on the card while being absent from
// the workbench.

export type SlaExclusionRow = {
  tags: string[] | null;
  rsa_override: boolean | null;
  customer_resolution_method: string | null;
  customer_key?: string | null;
  /** Hub-only per-ticket test designation (intercom_tickets_v3.is_test_ticket). */
  is_test_ticket?: boolean | null;
};

export type SlaExclusionOpts = {
  /** customer_key values marked v3_customer_accounts.is_test. */
  testAccountKeys?: Set<string>;
  /** When true, test accounts are NOT excluded (demo view). Default false. */
  showTestData?: boolean;
};

// Tags that mark a ticket as outside the Enterprise support population.
// `enterprise-not-enterprise` was previously only excluded via the
// customer_resolution_method disposition, so tickets carrying the tag alone
// still counted as resolution work. A manual rsa_override=true still wins.
export const RSA_FALSE_TAGS = [
  "enterprise-fyi",
  "enterprise-duplicate",
  "enterprise-not-enterprise",
] as const;


export const EXCLUDED_RESOLUTION_METHODS = [
  "not_enterprise",
  "prospect_personal",
  "enterprise_prospect",
] as const;

/**
 * True when the ticket is outside the Enterprise SLA population.
 * Order mirrors the original inline predicate exactly.
 */
export function isSlaExcluded(row: SlaExclusionRow, opts?: SlaExclusionOpts): boolean {
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const hasTag = (t: string) => tags.includes(t);

  const isTest =
    row.is_test_ticket === true ||
    !!(row.customer_key && opts?.testAccountKeys?.has(row.customer_key));
  if (isTest && !opts?.showTestData) return true;

  return (
    row.rsa_override === false ||
    (row.rsa_override == null && RSA_FALSE_TAGS.some((t) => hasTag(t))) ||
    hasTag("merged_ticket") ||
    (row.customer_resolution_method != null &&
      (EXCLUDED_RESOLUTION_METHODS as readonly string[]).includes(row.customer_resolution_method))
  );
}
