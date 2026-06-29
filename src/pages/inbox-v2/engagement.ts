// Shared engagement helpers for Inbox v2 — single source of truth for the
// override → AI guess → tag → default priority chain. Imported by InboxV2.tsx
// and the Analytics v2 page so both pages compute engagement identically.

export type Engagement = "engaged" | "none";
export type EngagementSource = "manual" | "ai" | "tag" | "default";

export type EngagementTicket = {
  tags: string[] | null;
  engagement_override: Engagement | null;
  engagement_ai_guess: Engagement | null;
};

export const NO_ENGAGEMENT_TAGS = new Set(["enterprise-fyi", "enterprise-duplicate"]);

export const hasNoEngagementTag = (tags: string[] | null) =>
  (tags ?? []).some((t) => NO_ENGAGEMENT_TAGS.has(t.trim().toLowerCase()));

export function effectiveEngagement(r: EngagementTicket): { value: Engagement; source: EngagementSource } {
  if (r.engagement_override === "engaged" || r.engagement_override === "none") {
    return { value: r.engagement_override, source: "manual" };
  }
  if (r.engagement_ai_guess === "engaged" || r.engagement_ai_guess === "none") {
    return { value: r.engagement_ai_guess, source: "ai" };
  }
  if (hasNoEngagementTag(r.tags)) return { value: "none", source: "tag" };
  return { value: "engaged", source: "default" };
}
