// In-app support request form detection — single source of truth.
// ---------------------------------------------------------------------------
// A ticket counts as "in-app form" when ANY of these hold, in priority order:
//   1. tag       — an Intercom tag in IN_APP_FORM_TAGS (most durable; survives
//                  any redesign of the form copy).
//   2. attribute — a custom attribute naming the intake channel
//                  (e.g. "Intake channel" = "In-app form", or "Source" = ...).
//   3. signature — fallback on the CURRENT form template: subject starts with
//                  "[Lovable support] - " OR the opening body carries all three
//                  metadata labels (User ID:, Workspace:, Project:).
//
// The signature tier is deliberately last: it is the brittle one. Once the form
// emits a tag or attribute, tiers 1–2 take over and the template can change
// freely without breaking the metric.
// Never throws.

export const IN_APP_FORM_TAGS = new Set([
  "in-app-form",
  "in_app_form",
  "in-app-support-form",
  "app-support-form",
]);

const INTAKE_ATTR_KEYS = ["intake channel", "intake_channel", "source", "request source", "origin"];
const INTAKE_ATTR_VALUES = ["in-app form", "in app form", "in-app-form", "in_app_form", "app form"];

const SUBJECT_RE = /^\s*\[lovable support\]\s*-\s*/i;

export type InAppFormDetection = {
  is_in_app_form: boolean;
  in_app_form_source: "tag" | "attribute" | "signature" | null;
};

const NONE: InAppFormDetection = { is_in_app_form: false, in_app_form_source: null };

function textOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function detectInAppForm(icData: any): InAppFormDetection {
  try {
    if (!icData || typeof icData !== "object") return NONE;

    // 1. Tag
    const tags: any[] = Array.isArray(icData?.tags?.tags) ? icData.tags.tags : [];
    for (const t of tags) {
      const name = textOf(t?.name).trim().toLowerCase();
      if (name && IN_APP_FORM_TAGS.has(name)) {
        return { is_in_app_form: true, in_app_form_source: "tag" };
      }
    }

    // 2. Custom attribute
    const attrs = icData?.custom_attributes;
    if (attrs && typeof attrs === "object") {
      for (const [k, v] of Object.entries(attrs)) {
        const key = k.trim().toLowerCase();
        if (!INTAKE_ATTR_KEYS.includes(key)) continue;
        const val = textOf(v).trim().toLowerCase();
        if (INTAKE_ATTR_VALUES.includes(val)) {
          return { is_in_app_form: true, in_app_form_source: "attribute" };
        }
      }
    }

    // 3. Signature on the current template
    const subject = textOf(icData?.source?.subject) || textOf(icData?.title);
    if (SUBJECT_RE.test(subject)) {
      return { is_in_app_form: true, in_app_form_source: "signature" };
    }
    const body = textOf(icData?.source?.body);
    if (/user id:/i.test(body) && /workspace:/i.test(body) && /project:/i.test(body)) {
      return { is_in_app_form: true, in_app_form_source: "signature" };
    }

    return NONE;
  } catch (e) {
    console.warn(`[v3-in-app-form] detect error: ${(e as Error).message}`);
    return NONE;
  }
}
