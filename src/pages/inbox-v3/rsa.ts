// Required Support Action (RSA) helper — single source of truth.
// Mirrors the engagement-chain shape used in inbox-v2/engagement.ts.
//
// Resolution priority:  manual override → tag → default (required)
// Tag rule: Intercom tags `enterprise-fyi` or `enterprise-duplicate` → not required.

export type Rsa = "required" | "not_required";
export type RsaSource = "manual" | "tag" | "default";

export type RsaTicket = {
  tags: string[] | null;
  rsa_override: boolean | null;
};

export const RSA_FALSE_TAGS = new Set(["enterprise-fyi", "enterprise-duplicate"]);

export const hasRsaFalseTag = (tags: string[] | null) =>
  (tags ?? []).some((t) => RSA_FALSE_TAGS.has(t.trim().toLowerCase()));

export function effectiveRsa(r: RsaTicket): { value: Rsa; source: RsaSource } {
  if (r.rsa_override === true) return { value: "required", source: "manual" };
  if (r.rsa_override === false) return { value: "not_required", source: "manual" };
  if (hasRsaFalseTag(r.tags)) return { value: "not_required", source: "tag" };
  return { value: "required", source: "default" };
}
