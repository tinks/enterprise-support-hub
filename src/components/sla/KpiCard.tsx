import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/slaMetrics";

export type KpiAgg = {
  avg: number | null;
  median: number | null;
  p90: number | null;
  p95?: number | null;
  n: number;
};

export function KpiCard({ title, desc, agg, emphasize }: {
  title: string;
  desc: string;
  agg: KpiAgg;
  emphasize?: boolean;
}) {
  return (
    <Card className={emphasize ? "ring-1 ring-primary/40" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        <Stat label="Median" value={formatDuration(agg.median)} emphasize={emphasize} />
        <Stat label="P90" value={formatDuration(agg.p90)} />
        {agg.p95 !== undefined && <Stat label="P95" value={formatDuration(agg.p95)} />}
        <Stat label="Avg" value={formatDuration(agg.avg)} />
        <div className="text-[10px] text-muted-foreground pt-1">n={agg.n}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${emphasize ? "text-base font-bold" : "text-sm font-semibold"}`}>{value}</span>
    </div>
  );
}
