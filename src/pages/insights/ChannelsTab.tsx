import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MonthData, SourceKey, sourceLabel } from "./useMonthData";

const orderedSources: SourceKey[] = ["intercom", "slack", "gmail", "other"];

export function ChannelsTab({ data }: { data: MonthData }) {
  const stats = useMemo(() => {
    const total = data.tickets.length;
    return orderedSources.map(s => {
      const rows = data.tickets.filter(t => t.display_source === s);
      const rated = rows.filter(t => t.csat_rating);
      const paMap = new Map<string, number>();
      for (const t of rows) paMap.set(t.product_area, (paMap.get(t.product_area) || 0) + 1);
      const topPa = Array.from(paMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return {
        source: s,
        count: rows.length,
        pct: total ? Math.round((rows.length / total) * 100) : 0,
        bugs: rows.filter(t => t.is_bug).length,
        features: rows.filter(t => t.is_feature_request).length,
        avgCsat: rated.length ? rated.reduce((a, t) => a + (t.csat_rating || 0), 0) / rated.length : null,
        topPa,
      };
    }).filter(s => s.count > 0);
  }, [data.tickets]);

  if (data.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;

  const total = data.tickets.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">Source mix · {total} tickets</h3>
          <div className="flex h-6 rounded overflow-hidden bg-muted">
            {stats.map(s => (
              <div key={s.source} className="flex items-center justify-center text-[10px] text-primary-foreground font-medium" style={{ width: `${s.pct}%`, background: s.source === "intercom" ? "hsl(var(--primary))" : s.source === "gmail" ? "hsl(220 70% 55%)" : s.source === "slack" ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}>
                {s.pct >= 8 && `${s.pct}%`}
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
            {stats.map(s => <span key={s.source}>{sourceLabel[s.source]} · {s.count} ({s.pct}%)</span>)}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats.map(s => (
          <Card key={s.source}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold">{sourceLabel[s.source]}</h3>
                <span className="text-2xl font-bold">{s.count}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><div className="text-muted-foreground">Bugs</div><div className="font-medium text-sm">{s.bugs} ({s.count ? Math.round(s.bugs / s.count * 100) : 0}%)</div></div>
                <div><div className="text-muted-foreground">FRs</div><div className="font-medium text-sm">{s.features} ({s.count ? Math.round(s.features / s.count * 100) : 0}%)</div></div>
                <div><div className="text-muted-foreground">Avg CSAT</div><div className="font-medium text-sm">{s.avgCsat?.toFixed(2) ?? "—"}</div></div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Top product areas</div>
                <div className="flex flex-wrap gap-1">
                  {s.topPa.map(([pa, n]) => <Badge key={pa} variant="outline" className="text-xs">{pa} · {n}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
