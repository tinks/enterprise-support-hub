import { AlertTriangle } from "lucide-react";

/**
 * LOUD fallback banner (charter: surface anomalies, never silently default).
 * Rendered whenever the effective-dated SLA policy config failed to load, is
 * empty, or a ticket arrived before every configured version — in which case
 * the surfaces are scoring against the built-in engine constants instead.
 */
export function PolicyFallbackBanner({
  show,
  error,
}: {
  show: boolean;
  error?: string | null;
}) {
  if (!show) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div>
        <span className="font-semibold">SLA policy config failed to load — showing built-in defaults.</span>{" "}
        Targets and business hours below come from the hardcoded engine constants, not the
        effective-dated policy tables.
        {error && <span className="block mt-0.5 opacity-80">{error}</span>}
      </div>
    </div>
  );
}
