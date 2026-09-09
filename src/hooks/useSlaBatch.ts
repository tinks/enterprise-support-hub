import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeSla,
  detectOrigin,
  DEFAULT_BUSINESS_HOURS,
  SLA_TARGETS,
  CADENCE_TARGETS,
  TRIAGE_TARGET_S,
  parsePlanTier,
  registerAnchorTeamIds,
  type PlanTier,
  type SlaPolicy,
  type SlaResult,
  type Origin,
} from "@/lib/slaMetrics";
import { useSlaPolicy } from "@/hooks/useSlaPolicy";
import { isSlaExcluded } from "@/lib/slaExclusions";
import type { BusinessHoursConfig } from "@/lib/slaMetrics";


const sameBusinessHours = (a: BusinessHoursConfig, b: BusinessHoursConfig) =>
  a === b ||
  (a.tz === b.tz &&
    a.dayStartHour === b.dayStartHour &&
    a.dayEndHour === b.dayEndHour &&
    a.workDays.join(",") === b.workDays.join(",") &&
    a.holidays.join(",") === b.holidays.join(","));

/**
 * Built-in fallback policy: exactly today's hardcoded engine constants.
 * Used ONLY when the policy config fails to load / is empty, or a ticket
 * arrived before every version. Never silent — `policyFallback` goes true and
 * the surfaces render a visible banner (charter: surface anomalies loudly).
 */
export const BUILTIN_POLICY: SlaPolicy = {
  id: "builtin",
  plan: "enterprise",
  label: "Built-in defaults (engine constants)",
  effectiveFromMs: 0,
  status: "provisional",
  businessHours: DEFAULT_BUSINESS_HOURS,
  targets: SLA_TARGETS,
  cadence: CADENCE_TARGETS,
  triageTargetS: TRIAGE_TARGET_S,
};

/**
 * Built-in fallback for self-serve enterprise (SSE): NO first-response,
 * resolution or cadence commitments — triage discipline only (1h). Used the
 * same way as BUILTIN_POLICY: only when config is missing, and never silently.
 */
export const BUILTIN_SSE_POLICY: SlaPolicy = {
  id: "builtin-sse",
  plan: "sse",
  label: "Built-in defaults (self-serve enterprise)",
  effectiveFromMs: 0,
  status: "provisional",
  businessHours: DEFAULT_BUSINESS_HOURS,
  targets: {
    1: { firstResponseS: Number.POSITIVE_INFINITY, firstResponseClock: "business", resolutionS: null, resolutionClock: "business" },
    2: { firstResponseS: Number.POSITIVE_INFINITY, firstResponseClock: "business", resolutionS: null, resolutionClock: "business" },
    3: { firstResponseS: Number.POSITIVE_INFINITY, firstResponseClock: "business", resolutionS: null, resolutionClock: "business" },
    4: { firstResponseS: Number.POSITIVE_INFINITY, firstResponseClock: "business", resolutionS: null, resolutionClock: "business" },
  },
  cadence: { 1: null, 2: null, 3: null, 4: null },
  triageTargetS: 3600,
};

// ---- Shared row/enrichment types (previously local to SlaTest.tsx) ----------
export type SlaBatchRow = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override?: string | null;
  subject_ai?: string | null;
  contact_name: string | null;
  contact_email: string | null;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  time_to_resolve_s: number | null;
  time_to_first_admin_reply_s: number | null;
  raw_payload: any;
  tags: string[] | null;
  rsa_override: boolean | null;
  customer_resolution_method: string | null;
  owner: string | null;
  customer_key: string | null;
  /** 'enterprise' (default) or 'sse' — derived at ingest from the Intercom inbox. */
  plan_tier?: string | null;
};

export type SlaBatchBucket = "inScope" | "excluded" | "noCustomer" | "manuallyLogged";

export type SlaBatchEnriched = SlaBatchRow & {
  sla: SlaResult;
  origin: Origin;
  bucket: SlaBatchBucket;
  /** Plan tier of this ticket, parsed from plan_tier. */
  planTier: PlanTier;
  /** Effective-dated policy resolved by the ticket's inbound anchor. */
  policy: SlaPolicy;
  /** True when this row fell back to the built-in constants (loud, not silent). */
  policyFallback: boolean;
};

export type ClassifyOpts = {
  /** Set of customer_key values marked as test/sandbox accounts (v3_customer_accounts.is_test). */
  testAccountKeys?: Set<string>;
  /**
   * When false (default), tickets on test accounts are excluded from the SLA
   * population with reason `test_account`. When true, they are classified
   * normally (typically in-scope) so they surface in the demo view.
   * Real compliance numbers MUST stay unchanged with this off.
   */
  showTestData?: boolean;
};

export function classifySlaBatchRow(row: SlaBatchRow, sla: SlaResult, opts?: ClassifyOpts): SlaBatchBucket {
  // Manually-logged bulk-import threads have no real reply timestamps —
  // unmeasurable for SLA. Check BEFORE the other buckets.
  if (sla.flags.manuallyLogged) return "manuallyLogged";
  // Shared predicate (src/lib/slaExclusions.ts) — also used by the Action Center
  // SLA signals so the card and this table can never disagree on population.
  if (isSlaExcluded(row, { testAccountKeys: opts?.testAccountKeys, showTestData: opts?.showTestData }))
    return "excluded";
  if (sla.flags.noCustomerParticipant) return "noCustomer";
  return "inScope";
}


export type SlaOverrideMetric = "triage" | "first_response" | "resolution" | "cadence";
export type SlaOverrideReason =
  | "holiday"
  | "off_hours"
  | "customer_hold"
  | "non_support_thread"
  | "recorded_at_close"
  | "answered_before_classified"
  | "data_artifact"
  | "genuine_miss"
  | "other";
export type SlaOverride = {
  id: string;
  intercom_conversation_id: string;
  metric: SlaOverrideMetric;
  reason: SlaOverrideReason;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type UseSlaBatch = {
  loading: boolean;
  error: string | null;
  rows: SlaBatchRow[];
  enriched: SlaBatchEnriched[];
  inScope: SlaBatchEnriched[];
  excluded: SlaBatchEnriched[];
  noCustomer: SlaBatchEnriched[];
  manuallyLogged: SlaBatchEnriched[];
  overrides: Map<string, SlaOverride>;
  isExcused: (conversationId: string, metric: SlaOverrideMetric) => boolean;
  getOverride: (conversationId: string, metric: SlaOverrideMetric) => SlaOverride | undefined;
  customerLabels: Map<string, string>;
  /** customer_key set for accounts flagged is_test. */
  testAccountKeys: Set<string>;
  /** Convenience predicate over `testAccountKeys`. */
  isTestAccount: (key: string | null | undefined) => boolean;
  refresh: () => void;
  refreshOverrides: () => void;
  /** Policy version in force right now — use for target LABELS/columns. */
  activePolicy: SlaPolicy;
  /** True when the policy config failed to load / is empty / a row predates it. */
  policyFallback: boolean;
  policyError: string | null;
  /** Resolve the policy in force at an anchor (ms). Null before every version. */
  resolveForAnchor: (anchorMs: number, plan?: PlanTier) => SlaPolicy | null;
  /** True when the policy config loaded cleanly (>=1 version, no error). */
  policyConfigLoaded: boolean;
};

export type UseSlaBatchOptions = {
  /**
   * When true, tickets on `is_test` customer accounts are classified normally
   * (typically in-scope). Default false — test-account tickets are excluded
   * so real compliance figures are unaffected.
   */
  showTestData?: boolean;
};

/**
 * Shared batch loader + per-row enrichment for the SLA pages.
 * Loads all finalized/reopened tickets from intercom_tickets_v3 (paginated),
 * runs computeSla per row, and pre-buckets them via classifySlaBatchRow.
 * Consumers derive their own severity buckets / display / basis on top.
 */
export function useSlaBatch(options?: UseSlaBatchOptions): UseSlaBatch {
  const showTestData = !!options?.showTestData;
  const { policies, loading: policyLoading, error: policyError, resolveForAnchor } = useSlaPolicy();
  const [rows, setRows] = useState<SlaBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [testAccountKeys, setTestAccountKeys] = useState<Set<string>>(new Set());

  /**
   * Support roster for the First-Response clock (commit 2). Loaded from the
   * canonical `teammates` table, role='support' ONLY (Sam is role='ai' → never
   * counts as First Response) and INCLUDING inactive rows — departed teammates
   * still answered those historical tickets. The engine stays pure: the roster
   * is passed into computeSla, never queried inside it.
   *
   * `rosterLoaded` gates enrichment so the first render doesn't silently score
   * the population with the no-roster fallback and then flip.
   */
  const [supportEmails, setSupportEmails] = useState<Set<string>>(new Set());
  const [supportAdminIds, setSupportAdminIds] = useState<Set<string>>(new Set());
  /**
   * Slack display-name aliases for the same roster. Slack-relayed replies post
   * into Intercom under the relay admin (Sam) with a `[From: <name> via Slack]`
   * prefix and no teammate email/admin id, so name is the only attribution.
   * Aliases: full name, first name, and email local part (min 3 chars, to avoid
   * matching a customer who happens to share a short first name).
   */
  const [supportSlackNames, setSupportSlackNames] = useState<Set<string>>(new Set());
  const [rosterLoaded, setRosterLoaded] = useState(false);


  // Register the self-serve enterprise inbox as an SLA clock-start anchor.
  // Without this, an SSE ticket's clock would fall back to created_at.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("sse_intercom_inbox_id")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const sse = (data as any)?.sse_intercom_inbox_id;
      if (sse) registerAnchorTeamIds([sse]);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("teammates")
        .select("intercom_admin_id,email,role,name")
        .eq("role", "support");
      if (cancelled) return;
      if (!error) {
        const emails = new Set<string>();
        const ids = new Set<string>();
        const names = new Set<string>();
        const addName = (v: string | null | undefined) => {
          const s = (v ?? "").trim().toLowerCase();
          if (s.length >= 3) names.add(s);
        };
        for (const r of (data ?? []) as Array<{ intercom_admin_id: string | null; email: string | null; name: string | null }>) {
          if (r.email) emails.add(r.email.trim().toLowerCase());
          if (r.intercom_admin_id) ids.add(String(r.intercom_admin_id).trim());
          if (r.name) {
            addName(r.name);
            addName(r.name.trim().split(/\s+/)[0]);
          }
          if (r.email) addName(r.email.split("@")[0]);
        }
        setSupportEmails(emails);
        setSupportAdminIds(ids);
        setSupportSlackNames(names);
      }

      // On error we leave both sets empty → engine falls back to the
      // pre-commit-2 any-human_admin behavior rather than scoring nothing.
      setRosterLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const PAGE = 500;
        const all: SlaBatchRow[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_conversation_id,subject,subject_override,subject_ai,contact_name,contact_email,intercom_created_at,intercom_closed_at,time_to_resolve_s,time_to_first_admin_reply_s,raw_payload,tags,rsa_override,customer_resolution_method,owner,customer_key,plan_tier,is_test_ticket")
            .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
            .order("intercom_closed_at", { ascending: false })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as SlaBatchRow[];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        if (!cancelled) setRows(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const configLoaded = policies.length > 0 && !policyError;

  const enriched = useMemo<SlaBatchEnriched[]>(
    () => (rosterLoaded && !policyLoading ? rows : []).map((r) => {
      const opts = { supportEmails, supportAdminIds, supportSlackNames };
      // Pass 1 with the built-in calendar to derive the ticket's inbound anchor
      // (Enterprise-Inbox assignment, else created_at) — the anchor itself is a
      // wall-clock timestamp, so it does not depend on business hours.
      const base = computeSla(r.raw_payload, opts);
      const anchorS = base.slaClockStartS ?? base.createdAtS;
      const planTier = parsePlanTier(r.plan_tier);
      const resolved = configLoaded && anchorS != null ? resolveForAnchor(anchorS * 1000, planTier) : null;
      const policy = resolved ?? (planTier === "sse" ? BUILTIN_SSE_POLICY : BUILTIN_POLICY);
      const policyFallback = resolved == null;
      // Pass 2 only when the resolved calendar actually differs from the default.
      const sla =
        sameBusinessHours(policy.businessHours, DEFAULT_BUSINESS_HOURS)
          ? base
          : computeSla(r.raw_payload, opts, policy.businessHours);
      const origin = detectOrigin(r.raw_payload);
      const bucket = classifySlaBatchRow(r, sla, { testAccountKeys, showTestData });
      return { ...r, sla, origin, bucket, planTier, policy, policyFallback };
    }),
    [rows, testAccountKeys, showTestData, rosterLoaded, supportEmails, supportAdminIds, supportSlackNames, configLoaded, policyLoading, resolveForAnchor],
  );

  const activePolicy = useMemo(
    () => (configLoaded ? resolveForAnchor(Date.now()) : null) ?? BUILTIN_POLICY,
    [configLoaded, resolveForAnchor],
  );
  const policyFallback = useMemo(
    () => !configLoaded || enriched.some((r) => r.policyFallback),
    [configLoaded, enriched],
  );


  const inScope = useMemo(() => enriched.filter((r) => r.bucket === "inScope"), [enriched]);
  const excluded = useMemo(() => enriched.filter((r) => r.bucket === "excluded"), [enriched]);
  const noCustomer = useMemo(() => enriched.filter((r) => r.bucket === "noCustomer"), [enriched]);
  const manuallyLogged = useMemo(() => enriched.filter((r) => r.bucket === "manuallyLogged"), [enriched]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Overrides — small table, load in full.
  const [overrides, setOverrides] = useState<Map<string, SlaOverride>>(new Map());
  const [overridesKey, setOverridesKey] = useState(0);
  const refreshOverrides = useCallback(() => setOverridesKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("sla_violation_overrides" as any)
        .select("id,intercom_conversation_id,metric,reason,note,created_by,created_at");
      if (cancelled) return;
      if (error) { setOverrides(new Map()); return; }
      const m = new Map<string, SlaOverride>();
      for (const row of ((data ?? []) as unknown as SlaOverride[])) {
        m.set(`${row.intercom_conversation_id}:${row.metric}`, row);
      }
      setOverrides(m);
    })();
    return () => { cancelled = true; };
  }, [overridesKey]);

  const getOverride = useCallback(
    (cid: string, metric: SlaOverrideMetric) => overrides.get(`${cid}:${metric}`),
    [overrides],
  );
  const isExcused = useCallback(
    (cid: string, metric: SlaOverrideMetric) => overrides.has(`${cid}:${metric}`),
    [overrides],
  );

  // Customer registry labels + test-account keys — small table, load once.
  const [customerLabels, setCustomerLabels] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("v3_customer_accounts")
        .select("account_key,label,is_test");
      if (cancelled) return;
      if (error) { setCustomerLabels(new Map()); setTestAccountKeys(new Set()); return; }
      const m = new Map<string, string>();
      const t = new Set<string>();
      for (const row of (data ?? []) as Array<{ account_key: string; label: string; is_test: boolean | null }>) {
        m.set(row.account_key, row.label);
        if (row.is_test) t.add(row.account_key);
      }
      setCustomerLabels(m);
      setTestAccountKeys(t);
    })();
    return () => { cancelled = true; };
  }, []);

  const isTestAccount = useCallback(
    (key: string | null | undefined) => !!(key && testAccountKeys.has(key)),
    [testAccountKeys],
  );

  return {
    loading: loading || !rosterLoaded || policyLoading, error, rows, enriched, inScope, excluded, noCustomer, manuallyLogged,
    overrides, isExcused, getOverride, customerLabels,
    testAccountKeys, isTestAccount, refresh, refreshOverrides,
    activePolicy, policyFallback, policyError,
    resolveForAnchor, policyConfigLoaded: configLoaded,
  };
}
