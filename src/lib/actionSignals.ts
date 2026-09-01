import { supabase } from "@/integrations/supabase/client";
import {
  computeSla,
  parseSeverity,
  resolvePolicy,
  policyToEngine,
  businessHoursBetween,
  DEFAULT_BUSINESS_HOURS,
  type SlaPolicy,
  type SlaPolicyTargetRow,
  type SlaPolicyVersionRow,
} from "@/lib/slaMetrics";
import { isSlaExcluded } from "@/lib/slaExclusions";
import { showTestDataNow } from "@/lib/testTickets";
import { isUnassigned, assignmentGap, ASSIGNMENT_GAP_LABEL } from "@/lib/triageQueues";



/**
 * Action Center signal registry.
 *
 * ONE array is the source of truth for both the /action-center page and the
 * sidebar badge, so the two can never disagree. Adding a signal = one entry.
 *
 * v1 rules (deliberate):
 *  - Any count > 0 is "needs attention". No thresholds, no age gates, no mute.
 *  - Every count is read LIVE from the same source the destination page uses.
 *    No cached counters, no new tables.
 *  - A loader that throws surfaces as an ERROR card, never as 0. A failed query
 *    must never look like a clear queue.
 */

export type SignalFamily = "queues" | "sla" | "pipeline" | "review";

export const FAMILY_LABEL: Record<SignalFamily, string> = {
  queues: "Queues",
  sla: "SLA risk",
  pipeline: "Pipeline health",
  review: "Review items",
};

export type SignalReading = {
  count: number;
  /** ISO ts of the oldest waiting item, when the source has one. */
  oldestAt?: string | null;
  /** Optional one-line extra context rendered under the count. */
  detail?: string | null;
  /**
   * Optional identifiers for the actual rows behind the count, so a card can
   * name what it is alerting on instead of only linking to a page to hunt in.
   */
  items?: Array<{ id: string; label?: string | null; intercomId?: string | null }>;
};

export type ActionSignal = {
  id: string;
  label: string;
  family: SignalFamily;
  /** Destination page (pre-filtered where the destination supports it). */
  route: string;
  routeLabel: string;
  /** What a non-zero count means. */
  meaning: string;
  load: () => Promise<SignalReading>;
};

// ---------------------------------------------------------------- helpers

const minIso = (values: Array<string | null | undefined>): string | null => {
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (!best || v < best) best = v;
  }
  return best;
};

const unwrap = <T,>(res: { data: T | null; error: any }): T => {
  if (res.error) throw new Error(res.error.message ?? String(res.error));
  return (res.data ?? []) as unknown as T;
};

const hasSeverity = (attrs: any): boolean => {
  const v = attrs?.["Severity"];
  return v != null && String(v).trim() !== "";
};

/** Loads the effective-dated policy set (same rows as useSlaPolicy). */
async function loadPolicies(): Promise<SlaPolicy[]> {
  const [versionsRes, targetsRes] = await Promise.all([
    supabase
      .from("sla_policy_versions" as any)
      .select("id,effective_from,status,business_hours,label")
      .order("effective_from", { ascending: true }),
    supabase.from("sla_policy_targets" as any).select("version_id,metric,severity,target_seconds,clock"),
  ]);
  const versions = unwrap<SlaPolicyVersionRow[]>(versionsRes as any);
  const targets = unwrap<SlaPolicyTargetRow[]>(targetsRes as any);
  return versions.map((v) => policyToEngine(v, targets.filter((t) => t.version_id === v.id)));
}

// Plan scoping. Self-serve Enterprise (SSE) carries NO first-response or
// resolution commitment but DOES carry a 1-hour triage target, so the two
// families are scoped differently instead of suppressing SSE wholesale:
//   - queue signals (untriaged, unassigned) cover every plan;
//   - SLA-risk signals stay Enterprise-only, because there is no SSE target to
//     be past;
//   - sse_triage_risk watches the SSE-specific 1-hour triage clock.
const enterpriseOnly = <T,>(q: T): T => (q as any).eq("plan_tier", "enterprise");
const sseOnly = <T,>(q: T): T => (q as any).eq("plan_tier", "sse");
/** SSE triage target: 1 hour (Enterprise is 30 minutes). */
const SSE_TRIAGE_TARGET_S = 60 * 60;

// ---------------------------------------------------------------- signals

export const ACTION_SIGNALS: ActionSignal[] = [
  // ---- Queues -----------------------------------------------------------


  {
    id: "unattributed",
    label: "Unattributed customers",
    family: "queues",
    route: "/customers?tab=unattributed",
    routeLabel: "Unattributed queue",
    meaning: "Tickets the resolver could not attribute to a customer account.",
    load: async () => {
      const { data, error } = await supabase.rpc("v3_unattributed_groups" as any);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ ticket_count: number }>;
      return { count: rows.reduce((s, r) => s + Number(r.ticket_count ?? 0), 0) };
    },
  },
  {
    id: "untriaged",
    label: "Untriaged tickets",
    family: "queues",
    route: "/triage",
    routeLabel: "Triage queue",
    meaning:
      "Open tickets with no Severity set in Intercom. Covers every plan — Enterprise and Self-serve Enterprise alike.",
    load: async () => {
      let q = supabase
        .from("intercom_tickets_v3")
        .select("custom_attributes,intercom_created_at")
        .in("lifecycle_status", ["open", "reopened_after_finalize"]);
      if (!showTestDataNow()) q = q.eq("is_test_ticket", false);
      const res = await q.limit(1000);
      const rows = unwrap<Array<{ custom_attributes: any; intercom_created_at: string | null }>>(res as any);
      const open = rows.filter((r) => !hasSeverity(r.custom_attributes));
      return { count: open.length, oldestAt: minIso(open.map((r) => r.intercom_created_at)) };
    },
  },
  {
    id: "unassigned_tickets",
    label: "Unassigned tickets",
    family: "queues",
    route: "/triage?mode=unassigned",
    routeLabel: "Triage queue",
    meaning:
      "Open tickets with no Intercom assignee, or an assignee that isn't mapped to a Hub owner. Tickets outside the SLA population — fyi, duplicate, merged, prospect, non-enterprise, test accounts — are not counted. Covers every plan — Enterprise and Self-serve Enterprise alike.",
    load: async () => {
      const [ticketsRes, testRes] = await Promise.all([
        (
          supabase
            .from("intercom_tickets_v3")
            .select(
              "intercom_conversation_id,admin_assignee_id,owner,intercom_created_at,tags,rsa_override,customer_resolution_method,customer_key,is_test_ticket",
            )
            .in("lifecycle_status", ["open", "reopened_after_finalize"])
        ).limit(1000),
        supabase.from("v3_customer_accounts").select("account_key,is_test").eq("is_test", true).limit(1000),
      ]);
      const rows = unwrap<
        Array<{
          intercom_conversation_id: string;
          admin_assignee_id: string | null;
          owner: string | null;
          intercom_created_at: string | null;
          tags: string[] | null;
          rsa_override: boolean | null;
          customer_resolution_method: string | null;
          customer_key: string | null;
          is_test_ticket: boolean | null;
        }>
      >(ticketsRes as any);
      const testAccountKeys = new Set(
        unwrap<Array<{ account_key: string }>>(testRes as any).map((r) => r.account_key),
      );
      const showTestData = showTestDataNow();
      const hits = rows.filter(
        (r) => !isSlaExcluded(r, { testAccountKeys, showTestData }) && isUnassigned(r),
      );
      return {
        count: hits.length,
        oldestAt: minIso(hits.map((r) => r.intercom_created_at)),
        items: hits.map((r) => ({
          id: r.intercom_conversation_id,
          intercomId: r.intercom_conversation_id,
          label: ASSIGNMENT_GAP_LABEL[assignmentGap(r) ?? "unmapped"],
        })),
      };
    },
  },
  {

    id: "escalations",
    label: "Open dev escalations",
    family: "queues",
    route: "/escalations",
    routeLabel: "Dev escalations",
    meaning: "Escalations not yet closed out — the customer has not been told.",
    load: async () => {
      const res = await supabase
        .from("dev_escalations")
        .select("created_at,hub_state")
        .not("hub_state", "in", '("customer_notified","wont_do")')
        .limit(1000);
      const rows = unwrap<Array<{ created_at: string | null }>>(res as any);
      return { count: rows.length, oldestAt: minIso(rows.map((r) => r.created_at)) };
    },
  },

  {
    id: "sse_triage_risk",
    label: "SSE triage past 1h",
    family: "sla",
    route: "/triage",
    routeLabel: "Triage queue",
    meaning:
      "Self-serve Enterprise tickets still open with no Severity set more than 1 hour after they arrived. SSE has no first-response or resolution SLA, so triage is the only clock it carries.",
    load: async () => {
      let sseQ = sseOnly(
        supabase
          .from("intercom_tickets_v3")
          .select("intercom_conversation_id,custom_attributes,intercom_created_at")
          .in("lifecycle_status", ["open", "reopened_after_finalize"]),
      );
      if (!showTestDataNow()) sseQ = sseQ.eq("is_test_ticket", false);
      const res = await sseQ.limit(1000);
      const rows = unwrap<
        Array<{ intercom_conversation_id: string; custom_attributes: any; intercom_created_at: string | null }>
      >(res as any);
      const nowS = Date.now() / 1000;
      const hits = rows.filter((r) => {
        if (hasSeverity(r.custom_attributes)) return false;
        if (!r.intercom_created_at) return false;
        return nowS - new Date(r.intercom_created_at).getTime() / 1000 > SSE_TRIAGE_TARGET_S;
      });
      return {
        count: hits.length,
        oldestAt: minIso(hits.map((r) => r.intercom_created_at)),
        items: hits.map((r) => ({
          id: r.intercom_conversation_id,
          intercomId: r.intercom_conversation_id,
          label: "No severity after 1h",
        })),
      };
    },
  },

  // ---- SLA risk ---------------------------------------------------------
  {
    id: "first_response_risk",
    label: "First response past target",
    family: "sla",
    route: "/sla-workbench",
    routeLabel: "SLA workbench",
    meaning:
      "Open, severity-classified tickets with no support reply yet whose first-response clock already exceeds the effective policy target (overrides excluded). Tickets outside the SLA population — fyi, duplicate, merged, prospect, non-enterprise, test accounts — are not counted. Self-serve Enterprise is excluded here because that plan has no first-response commitment; its triage clock is watched by the SSE triage signal.",
    load: async () => {
      const [policies, ticketsRes, overridesRes, testRes, rosterRes] = await Promise.all([
        loadPolicies(),
        enterpriseOnly(
          supabase
            .from("intercom_tickets_v3")
            .select(
              "intercom_conversation_id,custom_attributes,intercom_created_at,raw_payload,tags,rsa_override,customer_resolution_method,customer_key,is_test_ticket",
            )
            .in("lifecycle_status", ["open", "reopened_after_finalize"]),
        ).limit(1000),
        supabase.from("sla_breach_overrides").select("intercom_conversation_id,metric").limit(1000),
        supabase.from("v3_customer_accounts").select("account_key,is_test").eq("is_test", true).limit(1000),
        supabase.from("teammates").select("intercom_admin_id,email,name").eq("role", "support"),
      ]);
      // Same roster the SLA workbench passes in (useSlaBatch): without it a
      // Slack-relayed teammate reply reads as Sam and the ticket looks
      // unanswered forever.
      const roster = unwrap<Array<{ intercom_admin_id: string | null; email: string | null; name: string | null }>>(
        rosterRes as any,
      );
      const supportEmails = new Set<string>();
      const supportAdminIds = new Set<string>();
      const supportSlackNames = new Set<string>();
      const addName = (v: string | null | undefined) => {
        const s = (v ?? "").trim().toLowerCase();
        if (s.length >= 3) supportSlackNames.add(s);
      };
      for (const r of roster) {
        if (r.email) {
          supportEmails.add(r.email.trim().toLowerCase());
          addName(r.email.split("@")[0]);
        }
        if (r.intercom_admin_id) supportAdminIds.add(String(r.intercom_admin_id).trim());
        if (r.name) {
          addName(r.name);
          addName(r.name.trim().split(/\s+/)[0]);
        }
      }
      const slaOpts = { supportEmails, supportAdminIds, supportSlackNames };

      const tickets = unwrap<
        Array<{
          intercom_conversation_id: string;
          custom_attributes: any;
          intercom_created_at: string | null;
          raw_payload: any;
          tags: string[] | null;
          rsa_override: boolean | null;
          customer_resolution_method: string | null;
          customer_key: string | null;
          is_test_ticket: boolean | null;
        }>
      >(ticketsRes as any);
      const overrides = unwrap<Array<{ intercom_conversation_id: string; metric: string }>>(
        overridesRes as any,
      );
      const testAccountKeys = new Set(
        unwrap<Array<{ account_key: string }>>(testRes as any).map((r) => r.account_key),
      );
      const excused = new Set(
        overrides.filter((o) => o.metric === "first_response").map((o) => o.intercom_conversation_id),
      );

      const nowS = Math.floor(Date.now() / 1000);
      let count = 0;
      let oldest: string | null = null;
      const items: Array<{ id: string; intercomId: string }> = [];

      for (const t of tickets) {
        if (excused.has(t.intercom_conversation_id)) continue;
        // Same population rules as the SLA workbench (classifySlaBatchRow).
        if (isSlaExcluded(t, { testAccountKeys, showTestData: showTestDataNow() })) continue;
        const severity = parseSeverity(t.custom_attributes?.["Severity"]);
        if (severity == null) continue; // unclassified is the Triage signal's job

        const anchorMs = t.intercom_created_at ? Date.parse(t.intercom_created_at) : Date.now();
        const policy = resolvePolicy(anchorMs, policies);
        const bh = policy?.businessHours ?? DEFAULT_BUSINESS_HOURS;
        const target = policy?.targets?.[severity];
        if (!target || !Number.isFinite(target.firstResponseS)) continue;

        const sla = computeSla(t.raw_payload, slaOpts, bh);
        // Match the workbench: first-response is only measured on customer-initiated
        // threads. An agent-initiated outbound has no customer demand to answer.
        if (sla.initiatedBy !== "customer") continue;
        const answered =
          sla.firstSupportReplyFromInboxS != null || sla.firstSupportReplyFromInboxBusinessHoursS != null;
        if (answered) continue;

        const startS = sla.slaClockStartS ?? sla.createdAtS;
        if (startS == null) continue;
        const elapsed =
          target.firstResponseClock === "business"
            ? businessHoursBetween(startS, nowS, bh)
            : Math.max(0, nowS - startS);
        if (elapsed > target.firstResponseS) {
          count++;
          if (items.length < 25) {
            items.push({
              id: t.intercom_conversation_id,
              intercomId: t.intercom_conversation_id,
            });
          }
          if (t.intercom_created_at && (!oldest || t.intercom_created_at < oldest)) {
            oldest = t.intercom_created_at;
          }
        }
      }
      return { count, oldestAt: oldest, items };
    },
  },

  // ---- Pipeline health --------------------------------------------------
  {
    id: "integration_failures",
    label: "Integration failures",
    family: "pipeline",
    route: "/settings",
    routeLabel: "Integration health",
    meaning: "Integrations whose last run failed, or that have consecutive failures on record.",
    load: async () => {
      const res = await supabase
        .from("integration_health")
        .select("integration,last_status,consecutive_failures,last_failure_at")
        .limit(200);
      const rows = unwrap<
        Array<{
          integration: string;
          last_status: string | null;
          consecutive_failures: number;
          last_failure_at: string | null;
        }>
      >(res as any);
      const bad = rows.filter((r) => r.last_status === "error" || (r.consecutive_failures ?? 0) > 0);
      return {
        count: bad.length,
        oldestAt: minIso(bad.map((r) => r.last_failure_at)),
        detail: bad.length ? bad.map((r) => r.integration).join(", ") : null,
      };
    },
  },
  {
    id: "stale_sync",
    label: "Stale v3 sync",
    family: "pipeline",
    route: "/settings",
    routeLabel: "Sync status",
    meaning: "A v3 sync job has not completed within its expected cadence.",
    load: async () => {
      // Max tolerated age per job kind, in minutes.
      const MAX_AGE_MIN: Record<string, number> = {
        open_refresh: 60,
        closed_backfill: 60,
        gap_scan: 48 * 60,
      };
      // Query the latest completed job PER KIND — a single global query can be
      // fully consumed by the highest-frequency kind (open_refresh) and make
      // rarer kinds (gap_scan) look infinitely stale.
      const latest = new Map<string, string>();
      await Promise.all(
        Object.keys(MAX_AGE_MIN).map(async (kind) => {
          const res = await supabase
            .from("intercom_sync_jobs_v3")
            .select("kind,finished_at")
            .eq("status", "done")
            .eq("kind", kind)
            .not("finished_at", "is", null)
            .order("finished_at", { ascending: false })
            .limit(1);
          const rows = unwrap<Array<{ kind: string; finished_at: string | null }>>(res as any);
          if (rows[0]?.finished_at) latest.set(kind, rows[0].finished_at);
        }),
      );

      const stale: string[] = [];
      let oldest: string | null = null;
      for (const [kind, maxAge] of Object.entries(MAX_AGE_MIN)) {
        const last = latest.get(kind);
        const ageMin = last ? (Date.now() - Date.parse(last)) / 60000 : Number.POSITIVE_INFINITY;
        if (ageMin > maxAge) {
          stale.push(kind);
          if (last && (!oldest || last < oldest)) oldest = last;
        }
      }
      return { count: stale.length, oldestAt: oldest, detail: stale.length ? stale.join(", ") : null };
    },
  },
  {
    id: "parahelp_pending",
    label: "Parahelp routing pending",
    family: "pipeline",
    route: "/customers?tab=parahelp",
    routeLabel: "Parahelp routing",
    meaning: "Customer domains queued for email-routing setup that have not been pushed or marked done.",
    load: async () => {
      const res = await supabase
        .from("parahelp_routing_sync")
        .select("domain,state,created_at")
        .in("state", ["pending", "failed"])
        .limit(1000);
      const rows = unwrap<Array<{ created_at: string | null }>>(res as any);
      return { count: rows.length, oldestAt: minIso(rows.map((r) => r.created_at)) };
    },
  },
  {
    id: "registry_drift",
    label: "Registry not published",
    family: "pipeline",
    route: "/customers?tab=parahelp",
    routeLabel: "Notion mirror",
    meaning: "The customer registry changed after the last successful publish to the Notion page.",
    load: async () => {
      const res = await supabase
        .from("settings")
        .select("notion_registry_changed_at,notion_registry_synced_at")
        .limit(1);
      const rows = unwrap<
        Array<{ notion_registry_changed_at: string | null; notion_registry_synced_at: string | null }>
      >(res as any);
      const s = rows[0];
      const changed = s?.notion_registry_changed_at ?? null;
      const synced = s?.notion_registry_synced_at ?? null;
      const drift = !!changed && (!synced || changed > synced);
      return { count: drift ? 1 : 0, oldestAt: drift ? changed : null };
    },
  },

  // ---- Review items -----------------------------------------------------
  {
    id: "doc_approvals",
    label: "Knowledge doc approvals",
    family: "review",
    route: "/knowledge",
    routeLabel: "Knowledge",
    meaning: "Staged documentation edits awaiting review before they go live.",
    load: async () => {
      const res = await supabase
        .from("knowledge_documents")
        .select("id,pending_at")
        .not("pending_content", "is", null)
        .limit(200);
      const rows = unwrap<Array<{ pending_at: string | null }>>(res as any);
      return { count: rows.length, oldestAt: minIso(rows.map((r) => r.pending_at)) };
    },
  },
  {
    id: "relay_identity_gaps",
    label: "Slack relay identity gaps",
    family: "review",
    route: "/settings",
    routeLabel: "Settings (teammates)",
    meaning:
      "A Slack↔Intercom relayed reply could not be posted under the teammate's own Intercom admin id — either the teammate has no intercom_admin_id in the roster, or Intercom rejected it. The reply was still delivered, but it lands under the relay admin (Sam), which makes the ticket look unanswered to the SLA engine. Fix the teammate's Intercom admin id, then mark the gap resolved.",
    load: async () => {
      const res = await supabase
        .from("relay_attribution_gaps" as any)
        .select("slack_user_id,slack_email,slack_display_name,reason,last_seen_at,last_conversation_id")
        .is("resolved_at", null)
        .limit(200);
      const rows = (res as any).data ?? [];
      if ((res as any).error) throw new Error((res as any).error.message);
      return {
        count: rows.length,
        oldestAt: minIso(rows.map((r: any) => r.last_seen_at)),
        detail: rows.length ? rows.map((r: any) => r.slack_email || r.slack_display_name || r.slack_user_id).join(", ") : null,
        items: rows.map((r: any) => ({
          id: r.slack_user_id,
          label: `${r.slack_email || r.slack_display_name || r.slack_user_id} — ${r.reason}`,
          intercomId: r.last_conversation_id ?? null,
        })),
      };
    },
  },
  {

    id: "intercom_field_drift",
    label: "Intercom field options drift",
    family: "review",
    route: "/settings",
    routeLabel: "Settings",
    meaning:
      "Intercom's product area options no longer match the legacy settings.product_areas list used by the older Hub surfaces. Writes to Intercom are unaffected (they validate against the Intercom-sourced cache).",
    load: async () => {
      const [optsRes, settingsRes] = await Promise.all([
        supabase.from("intercom_field_options" as any).select("attr_key,option_value,active"),
        supabase.from("settings").select("product_areas").limit(1).maybeSingle(),
      ]);
      if (optsRes.error) throw new Error(optsRes.error.message);
      if (settingsRes.error) throw new Error(settingsRes.error.message);
      const rows = (optsRes.data ?? []) as unknown as Array<{
        attr_key: string;
        option_value: string;
        active: boolean;
      }>;
      const hubAreas = String(settingsRes.data?.product_areas ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const active = (key: string) =>
        rows.filter((r) => r.attr_key === key && r.active).map((r) => r.option_value);

      // Ticket type is fully cache-driven after the Phase 2 cutover, so only the
      // legacy settings.product_areas list can still drift from Intercom.
      const pairs: Array<[string, string[], string[]]> = [
        ["Affected Product Area", active("Affected Product Area"), hubAreas],
      ];

      const drifted = pairs.filter(
        ([, ic, hub]) =>
          ic.length > 0 &&
          (ic.some((v) => !hub.includes(v)) || hub.some((v) => !ic.includes(v))),
      );

      return {
        count: drifted.length,
        detail: drifted.length ? drifted.map(([k]) => k).join(", ") : null,
      };
    },
  },
  {
    id: "channel_proposals",
    label: "Channel → account proposals",
    family: "review",
    route: "/customers?tab=channels",
    routeLabel: "Channels",
    meaning: "Suggested Slack-channel to customer-account mappings awaiting a decision.",
    load: async () => {
      const { data, error } = await supabase.rpc("v3_channel_proposals_pending" as any);
      if (error) throw new Error(error.message);
      return { count: ((data ?? []) as unknown[]).length };
    },
  },
];
