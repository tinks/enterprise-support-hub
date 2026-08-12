// Slack alert for brand-new Enterprise Inbox tickets.
// ---------------------------------------------------------------------------
// Fires exactly once per Intercom conversation: the `new_ticket_alerts` table
// has the conversation id as PRIMARY KEY, so the insert is the dedup guard
// (a duplicate insert fails and we skip posting). Never throws — alerting must
// not break a sync run.
// ---------------------------------------------------------------------------

import { coveringSlackIds, type FloatShift } from "./float-coverage.ts";

const SLACK_API_URL = "https://slack.com/api";
const DEFAULT_CHANNEL = "C0BPDU4JH71"; // #enterprise-support-tickets


export type NewTicketAlertInput = {
  convId: string;
  subject: string | null;
  contactName: string | null;
  contactEmail: string | null;
  owner: string | null;
  createdIso: string | null;
};

export async function notifyNewTicket(
  supabase: any,
  t: NewTicketAlertInput,
): Promise<"sent" | "duplicate" | "skipped" | "failed"> {
  try {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) return "skipped";
    const channel = Deno.env.get("NEW_TICKET_ALERT_CHANNEL") || DEFAULT_CHANNEL;

    // Claim the alert first — PK collision means someone already announced it.
    const { error: claimErr } = await supabase
      .from("new_ticket_alerts")
      .insert({ intercom_conversation_id: t.convId, slack_channel_id: channel });
    if (claimErr) return "duplicate";

    // Float-coverage ping. Two independent sources, unioned:
    //   1. The shift schedule (float_coverage_shifts) — whoever is on point at
    //      this exact instant, in their own timezone. Nobody on shift (nights,
    //      weekends, gaps) means no mention: the alert still posts, it just
    //      doesn't buzz anyone.
    //   2. settings.new_ticket_alert_mentions — an always-on list, pinged
    //      regardless of the schedule. Normally blank.
    // Env var NEW_TICKET_ALERT_MENTION overrides both, for tests.
    // Any read failure degrades to fewer mentions — never a blocked alert.
    let mentionIds: string[] = [];
    const envMention = Deno.env.get("NEW_TICKET_ALERT_MENTION");
    if (envMention) {
      mentionIds = envMention.split(/[,\s]+/).filter(Boolean);
    } else {
      const now = new Date();
      let onShift: string[] = [];
      try {
        const { data: shifts } = await supabase
          .from("float_coverage_shifts")
          .select("slack_user_id, starts_on, ends_on, start_time, end_time, time_zone, active")
          .eq("active", true);
        onShift = coveringSlackIds((shifts ?? []) as FloatShift[], now);
      } catch (e) {
        console.error(`[new-ticket-alert] shift lookup failed: ${(e as Error).message}`);
      }

      const { data: cfg } = await supabase
        .from("settings")
        .select("new_ticket_alert_mentions")
        .limit(1)
        .maybeSingle();
      const alwaysOn = String(cfg?.new_ticket_alert_mentions ?? "")
        .split(/[,\s]+/)
        .filter(Boolean);

      mentionIds = Array.from(new Set([...onShift, ...alwaysOn]));
    }
    const mentions = mentionIds
      .map((id) => (id.startsWith("<@") ? id : id.startsWith("!") ? `<${id}>` : `<@${id}>`))
      .join(" ");


    const link = `https://app.intercom.com/a/inbox/_/inbox/conversation/${t.convId}`;
    const contact = [t.contactName, t.contactEmail].filter(Boolean).join(" · ") || "Unknown contact";
    const lines = [
      `:inbox_tray: *New Enterprise Inbox ticket* — <${link}|#${t.convId}>`,
      `*${t.subject || "Untitled"}*`,
      `${contact}${t.owner ? ` · owner: ${t.owner}` : ""}`,
      mentions
        ? `${mentions} — new ticket for float coverage. Awaiting triage; set a Severity in Intercom.`
        : `_Awaiting triage — set a Severity in Intercom._`,
    ];


    const res = await fetch(`${SLACK_API_URL}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        text: lines.join("\n"),
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[new-ticket-alert] slack error for ${t.convId}: ${data.error}`);
      // Release the claim so a later run can retry.
      await supabase.from("new_ticket_alerts").delete().eq("intercom_conversation_id", t.convId);
      return "failed";
    }
    await supabase
      .from("new_ticket_alerts")
      .update({ slack_ts: data.ts })
      .eq("intercom_conversation_id", t.convId);
    return "sent";
  } catch (e) {
    console.error(`[new-ticket-alert] threw for ${t.convId}: ${(e as Error).message}`);
    return "failed";
  }
}
