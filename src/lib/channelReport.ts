/**
 * Access points (intake channels) for the v3 dataset.
 *
 * Truth is computed server-side by the `v3_channel_report` RPC so the large
 * `raw_payload` jsonb never ships to the browser. Classification there is
 * mutually exclusive and ordered:
 *
 *   in_app_form -> slack -> email -> messenger -> other
 *
 * This module only carries labels, ordering and colours so every surface that
 * renders the dimension reads the same names.
 *
 * Legacy Insights (`/insights?tab=channels`) is a separate, older surface built
 * on legacy tables. It is intentionally untouched by this module.
 */

export const CHANNEL_KEYS = ["email", "slack", "messenger", "in_app_form", "other"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  email: "Direct email",
  slack: "Slack relay",
  messenger: "Intercom widget",
  in_app_form: "In-app support form",
  other: "Other / admin-initiated",
};

export const CHANNEL_DESCRIPTION: Record<ChannelKey, string> = {
  email: "Customer emailed support directly; Intercom ingested it as an email conversation.",
  slack: "Relayed from a shared Slack channel (detected Slack channel on the ticket).",
  messenger: "Opened from the in-product Intercom messenger widget.",
  in_app_form: "Submitted through the in-app support request form (tag, attribute or form template).",
  other: "Admin-initiated outreach or a ticket with no usable source payload.",
};

/** Chart colours — stable per channel so trend and mix bars always agree. */
export const CHANNEL_COLOR: Record<ChannelKey, string> = {
  email: "hsl(var(--primary))",
  slack: "hsl(340 75% 55%)",
  messenger: "hsl(220 70% 55%)",
  in_app_form: "hsl(150 55% 42%)",
  other: "hsl(var(--muted-foreground))",
};

export function channelKeyOf(v: unknown): ChannelKey {
  const s = String(v ?? "");
  return (CHANNEL_KEYS as readonly string[]).includes(s) ? (s as ChannelKey) : "other";
}
