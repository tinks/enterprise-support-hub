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
    meaning: "Open tickets with no Severity set in Intercom.",
    load: async () => {
      const res = await supabase
        .from("intercom_tickets_v3")
        .select("custom_attributes,intercom_created_at")
        .in("lifecycle_status", ["open", "reopened_after_finalize"])
        .limit(1000);
      const rows = unwrap<Array<{ custom_attributes: any; intercom_created_at: string | null }>>(res as any);
      const open = rows.filter((r) => !hasSeverity(r.custom_attributes));
      return { count: open.length, oldestAt: minIso(open.map((r) => r.intercom_created_at)) };
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

  // ---- SLA risk ---------------------------------------------------------
  {
    id: "first_response_risk",
    label: "First response past target",
    family: "sla",
    route: "/sla-workbench",
    routeLabel: "SLA workbench",
    meaning:
      "Open, severity-classified tickets with no support reply yet whose first-response clock already exceeds the effective policy target (overrides excluded). Tickets outside the SLA population — fyi, duplicate, merged, prospect, non-enterprise, test accounts — are not counted.",
    load: async () => {
      const [policies, ticketsRes, overridesRes, testRes] = await Promise.all([
        loadPolicies(),
        supabase
          .from("intercom_tickets_v3")
          .select(
            "intercom_conversation_id,custom_attributes,intercom_created_at,raw_payload,tags,rsa_override,customer_resolution_method,customer_key",
          )
          .in("lifecycle_status", ["open", "reopened_after_finalize"])
          .limit(1000),
        supabase.from("sla_breach_overrides").select("intercom_conversation_id,metric").limit(1000),
        supabase.from("v3_customer_accounts").select("customer_key,is_test").eq("is_test", true).limit(1000),
      ]);
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
        }>
      >(ticketsRes as any);
      const overrides = unwrap<Array<{ intercom_conversation_id: string; metric: string }>>(
        overridesRes as any,
      );
      const testAccountKeys = new Set(
        unwrap<Array<{ customer_key: string }>>(testRes as any).map((r) => r.customer_key),
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
        if (isSlaExcluded(t, { testAccountKeys })) continue;
        const severity = parseSeverity(t.custom_attributes?.["Severity"]);
        if (severity == null) continue; // unclassified is the Triage signal's job

        const anchorMs = t.intercom_created_at ? Date.parse(t.intercom_created_at) : Date.now();
        const policy = resolvePolicy(anchorMs, policies);
        const bh = policy?.businessHours ?? DEFAULT_BUSINESS_HOURS;
        const target = policy?.targets?.[severity];
        if (!target || !Number.isFinite(target.firstResponseS)) continue;

        const sla = computeSla(t.raw_payload, undefined, bh);
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
      const res = await supabase
        .from("intercom_sync_jobs_v3")
        .select("kind,status,finished_at")
        .eq("status", "done")
        .order("finished_at", { ascending: false })
        .limit(200);
      const rows = unwrap<Array<{ kind: string; finished_at: string | null }>>(res as any);
      const latest = new Map<string, string>();
      for (const r of rows) {
        if (!r.finished_at) continue;
        if (!latest.has(r.kind)) latest.set(r.kind, r.finished_at);
      }
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
