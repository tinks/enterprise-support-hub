// Normalises free-text `manual_conversations.contact_name` into a stable
// account key + label so multi-variant contacts (e.g., "McKinsey",
// "*@mckinsey.com", known contractor names) roll up into a single account
// in the Top accounts panel.
//
// Pure function — no IO. Extend ALIAS_MAP as new accounts surface.

import { accountFromEmail, extractEmail } from "./useMonthData";

// Keys are LOWERCASED, trimmed exact matches against contact_name.
const ALIAS_MAP: Record<string, { key: string; label: string }> = {
  // McKinsey — generic label + known McKinsey contractors who log under their own name
  "mckinsey": { key: "account:mckinsey", label: "McKinsey" },
  "sergey gorchichko-wroc": { key: "account:mckinsey", label: "McKinsey" },
  "sergey gorchichko": { key: "account:mckinsey", label: "McKinsey" },
  "pulkit agarwal": { key: "account:mckinsey", label: "McKinsey" },

  // Lovable internal (will be filtered out by INTERNAL_KEYS)
  "lovable support": { key: "account:lovable_internal", label: "Lovable (internal)" },
  "lovable": { key: "account:lovable_internal", label: "Lovable (internal)" },

  // Other recognisable accounts
  "zendesk": { key: "account:zendesk", label: "Zendesk" },
};

// Domain → canonical account override. Applied after accountFromEmail so
// e.g. `*@mckinsey.com` rolls into the same bucket as the "McKinsey" alias.
const DOMAIN_TO_ACCOUNT: Record<string, { key: string; label: string }> = {
  "mckinsey.com": { key: "account:mckinsey", label: "McKinsey" },
};

// Keys hidden from the Top manual contacts panel (mirrors the existing
// Top accounts filter rule for lovable.dev internal traffic).
export const INTERNAL_MANUAL_KEYS = new Set<string>([
  "account:lovable_internal",
  "domain:lovable.dev",
]);

export function normalizeManualContact(
  contactName: string | null | undefined
): { key: string; label: string } {
  const raw = (contactName || "").trim();
  if (!raw) return { key: "contact:unknown", label: "Unknown contact" };

  // 1. Email embedded in the contact_name → resolve to domain bucket,
  //    then optionally collapse via DOMAIN_TO_ACCOUNT.
  const email = extractEmail(raw);
  if (email) {
    const acct = accountFromEmail(email);
    if (acct.key.startsWith("domain:")) {
      const domain = acct.key.slice("domain:".length);
      const override = DOMAIN_TO_ACCOUNT[domain];
      if (override) return override;
    }
    // Personal/unknown domains shouldn't roll everyone into one bucket —
    // fall through to alias/contact handling using the raw name.
    if (acct.key !== "domain:_personal" && acct.key !== "domain:unknown") {
      return acct;
    }
  }

  // 2. Alias map (case-insensitive exact match).
  const aliased = ALIAS_MAP[raw.toLowerCase()];
  if (aliased) return aliased;

  // 3. Fallback — the contact stays as-is.
  return { key: "contact:" + raw.toLowerCase(), label: raw };
}
