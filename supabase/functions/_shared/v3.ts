// Shared constants and helpers for Inbox v3 sync functions.
// Duplicated from src/pages/inbox-v3/constants.ts (Deno cannot import from /src).

export const CLEAN_DATA_START_ISO = "2026-06-01T00:00:00Z";
export const CLEAN_DATA_START_UNIX = Math.floor(
  new Date(CLEAN_DATA_START_ISO).getTime() / 1000,
);

export const V3_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

export function tsToIso(t: number | null | undefined): string | null {
  return typeof t === "number" && t > 0 ? new Date(t * 1000).toISOString() : null;
}

export function intercomHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Intercom-Version": "2.11",
  };
}

export function extractTags(icData: any): string[] {
  const arr = icData?.tags?.tags;
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const t of arr) {
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    if (name) out.push(name);
  }
  return out;
}

export function extractFields(icData: any): {
  product_area: string | null;
  classification: string | null;
} {
  const ca = icData?.custom_attributes || {};
  const pa = typeof ca["Affected Product Area"] === "string"
    ? ca["Affected Product Area"].trim()
    : "";
  const tt = typeof ca["Ticket type"] === "string"
    ? ca["Ticket type"].trim()
    : "";
  return { product_area: pa || null, classification: tt || null };
}

export const TIME_BUDGET_MS = 120_000;
