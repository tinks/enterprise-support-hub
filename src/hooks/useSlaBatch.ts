import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  computeSla,
  detectOrigin,
  type SlaResult,
  type Origin,
} from "@/lib/slaMetrics";

// ---- Shared row/enrichment types (previously local to SlaTest.tsx) ----------
export type SlaBatchRow = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
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
};

export type SlaBatchBucket = "inScope" | "excluded" | "noCustomer" | "manuallyLogged";

export type SlaBatchEnriched = SlaBatchRow & {
  sla: SlaResult;
  origin: Origin;
  bucket: SlaBatchBucket;
};

export function classifySlaBatchRow(row: SlaBatchRow, sla: SlaResult): SlaBatchBucket {
  // Manually-logged bulk-import threads have no real reply timestamps —
  // unmeasurable for SLA. Check BEFORE the other buckets.
  if (sla.flags.manuallyLogged) return "manuallyLogged";
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const hasTag = (t: string) => tags.includes(t);
  const excluded =
    row.rsa_override === false ||
    (row.rsa_override == null && (hasTag("enterprise-fyi") || hasTag("enterprise-duplicate"))) ||
    hasTag("merged_ticket") ||
    row.customer_resolution_method === "not_enterprise";
  if (excluded) return "excluded";
  if (sla.flags.noCustomerParticipant) return "noCustomer";
  return "inScope";
}

export type SlaOverrideMetric = "first_response" | "resolution";
export type SlaOverrideReason = "holiday" | "customer_hold" | "data_artifact" | "other";
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
  refresh: () => void;
  refreshOverrides: () => void;
};

/**
 * Shared batch loader + per-row enrichment for the SLA pages.
 * Loads all finalized/reopened tickets from intercom_tickets_v3 (paginated),
 * runs computeSla per row, and pre-buckets them via classifySlaBatchRow.
 * Consumers derive their own severity buckets / display / basis on top.
 */
export function useSlaBatch(): UseSlaBatch {
  const [rows, setRows] = useState<SlaBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
            .select("id,intercom_conversation_id,subject,contact_name,contact_email,intercom_created_at,intercom_closed_at,time_to_resolve_s,time_to_first_admin_reply_s,raw_payload,tags,rsa_override,customer_resolution_method,owner,customer_key")
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

  const enriched = useMemo<SlaBatchEnriched[]>(
    () => rows.map((r) => {
      const sla = computeSla(r.raw_payload);
      const origin = detectOrigin(r.raw_payload);
      const bucket = classifySlaBatchRow(r, sla);
      return { ...r, sla, origin, bucket };
    }),
    [rows],
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
        .from("sla_breach_overrides" as any)
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

  // Customer registry labels — small table, load once.
  const [customerLabels, setCustomerLabels] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("v3_customer_accounts")
        .select("account_key,label");
      if (cancelled) return;
      if (error) { setCustomerLabels(new Map()); return; }
      const m = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ account_key: string; label: string }>) {
        m.set(row.account_key, row.label);
      }
      setCustomerLabels(m);
    })();
    return () => { cancelled = true; };
  }, []);

  return {
    loading, error, rows, enriched, inScope, excluded, noCustomer, manuallyLogged,
    overrides, isExcused, getOverride, customerLabels, refresh, refreshOverrides,
  };
}
