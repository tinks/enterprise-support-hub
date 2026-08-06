import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  policyToEngine,
  resolvePolicy,
  type SlaPolicy,
  type SlaPolicyTargetRow,
  type SlaPolicyVersionRow,
} from "@/lib/slaMetrics";

/**
 * READ-ONLY loader for the effective-dated SLA policy config
 * (`sla_policy_versions` + `sla_policy_targets`).
 *
 * Batch 2a: capability only — no surface consumes this yet, and the hook never
 * writes. Behavior of the SLA engine is unchanged; the hardcoded constants
 * remain the default everywhere until batch 2b.
 */
export type UseSlaPolicy = {
  policies: SlaPolicy[];
  loading: boolean;
  error: string | null;
  /** The policy in force at `anchorMs`, or null if it precedes every version. */
  resolveForAnchor: (anchorMs: number) => SlaPolicy | null;
  refresh: () => void;
};

export function useSlaPolicy(): UseSlaPolicy {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [versionsRes, targetsRes] = await Promise.all([
          supabase
            .from("sla_policy_versions" as any)
            .select("id,effective_from,status,business_hours,label")
            .order("effective_from", { ascending: true }),
          supabase
            .from("sla_policy_targets" as any)
            .select("version_id,metric,severity,target_seconds,clock"),
        ]);
        if (versionsRes.error) throw versionsRes.error;
        if (targetsRes.error) throw targetsRes.error;
        const versions = (versionsRes.data ?? []) as unknown as SlaPolicyVersionRow[];
        const targets = (targetsRes.data ?? []) as unknown as SlaPolicyTargetRow[];
        const mapped = versions.map((v) =>
          policyToEngine(v, targets.filter((t) => t.version_id === v.id)),
        );
        if (!cancelled) setPolicies(mapped);
      } catch (e: any) {
        if (!cancelled) {
          setPolicies([]);
          setError(e?.message ?? String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const resolveForAnchor = useCallback(
    (anchorMs: number) => resolvePolicy(anchorMs, policies),
    [policies],
  );

  return useMemo(
    () => ({ policies, loading, error, resolveForAnchor, refresh }),
    [policies, loading, error, resolveForAnchor, refresh],
  );
}
