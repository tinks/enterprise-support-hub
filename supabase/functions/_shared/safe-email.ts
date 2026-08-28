// safe-email.ts
// ---------------------------------------------------------------------------
// Guard for values that get interpolated into PostgREST filter strings
// (e.g. `.or("from_email.ilike.%x%,...")`). PostgREST parses `,` `.` `(` `)`
// and `%` structurally, so an Intercom contact email containing those
// characters could inject extra filter clauses and broaden which
// gmail_conversations rows are matched.
//
// Policy: only well-formed, plainly-safe email addresses may be used in a
// filter string. Anything else is rejected and the caller skips the
// email-linker path (subject/pending-link fallbacks still apply).
// ---------------------------------------------------------------------------

// Conservative: local part limited to common safe chars (no quotes, commas,
// parens, percent, whitespace); domain is dotted labels.
const SAFE_EMAIL_RE = /^[A-Za-z0-9!#$&'*+\/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$&'*+\/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** PostgREST-reserved characters that must never reach a filter string. */
const RESERVED = /[,()%*\\"'\s]/;

/**
 * True when `value` is a well-formed email that is safe to interpolate into a
 * PostgREST filter string.
 */
export function isFilterSafeEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length === 0 || v.length > 254) return false;
  if (RESERVED.test(v)) return false;
  return SAFE_EMAIL_RE.test(v);
}
