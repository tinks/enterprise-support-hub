import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PLAN_LABEL, PLAN_SHORT, planTierOf, type PlanScope } from "@/lib/planTier";

/**
 * Shared plan-scope selector (All / Enterprise / SSE).
 *
 * Every v3 reporting surface uses this same control so the cut means exactly
 * the same thing everywhere. Defaults differ per surface: SLA surfaces default
 * to 'enterprise' (SSE has no first-response commitment, so mixing it in
 * understates compliance); volume/quality surfaces default to 'all'.
 */
export function PlanScopeSelect({
  value,
  onChange,
  className,
}: {
  value: PlanScope;
  onChange: (v: PlanScope) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as PlanScope)}>
      <SelectTrigger className={className ?? "w-[220px] h-9"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{PLAN_LABEL.all}</SelectItem>
        <SelectItem value="enterprise">{PLAN_LABEL.enterprise}</SelectItem>
        <SelectItem value="sse">{PLAN_LABEL.sse}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Row badge rendered identically in Triage, Inbox v3, Deep search and owner dashboards. */
export function PlanBadge({ value }: { value: unknown }) {
  const tier = planTierOf(value);
  if (tier === "sse") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
        {PLAN_SHORT.sse}
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">{PLAN_SHORT.enterprise}</span>;
}
