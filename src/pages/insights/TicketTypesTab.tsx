import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MonthData } from "./useMonthData";

const typeOf = (t: { is_bug: boolean; is_feature_request: boolean }): "bug" | "feature" | "other" =>
  t.is_bug ? "bug" : t.is_feature_request ? "feature" : "other";

const typeColor: Record<string, string> = {
  bug: "bg-destructive/70",
  feature: "bg-primary/70",
  other: "bg-muted-foreground/40",
};

export function TicketTypesTab({ data }: { data: MonthData }) {
  const stats = useMemo(() => {
    const total = data.tickets.length;
    const bugs = data.tickets.filter(t => t.is_bug).length;
    const features = data.tickets.filter(t => t.is_feature_request && !t.is_bug).length;
    const other = total - bugs - features;

    // Resolution time
    const resolved = data.tickets.filter(t => t.resolved_at);
    const avgHours = (rows: typeof resolved) => {
      if (!rows.length) return null;
      const sum = rows.reduce((acc, t) => acc + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()), 0);
      return sum / rows.length / (1000 * 60 * 60);
    };
    const ttrAll = avgHours(resolved);
    const ttrBugs = avgHours(resolved.filter(t => t.is_bug));
    const ttrFr = avgHours(resolved.filter(t => t.is_feature_request));

    // CSAT
    const rated = data.tickets.filter(t => t.csat_rating);
    const avgCsat = rated.length ? rated.reduce((a, t) => a + (t.csat_rating || 0), 0) / rated.length : null;
    const csatDist = [1, 2, 3, 4, 5].map(r => ({ r, n: rated.filter(t => t.csat_rating === r).length }));

    // Per product area stack
    const paMap = new Map<string, { bug: number; feature: number; other: number; total: number }>();
    for (const t of data.tickets) {
      const pa = t.product_area || "Uncategorized";
      const e = paMap.get(pa) || { bug: 0, feature: 0, other: 0, total: 0 };
      e[typeOf(t)]++;
      e.total++;
      paMap.set(pa, e);
    }
    const productAreas = Array.from(paMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);

    // Owner load
    const ownerMap = new Map<string, { total: number; bugs: number; features: number }>();
    for (const t of data.tickets) {
      const o = t.owner || "Unassigned";
      const e = ownerMap.get(o) || { total: 0, bugs: 0, features: 0 };
      e.total++;
      if (t.is_bug) e.bugs++;
      if (t.is_feature_request) e.features++;
      ownerMap.set(o, e);
    }
    const owners = Array.from(ownerMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);

    return { total, bugs, features, other, ttrAll, ttrBugs, ttrFr, avgCsat, csatDist, productAreas, owners, ratedCount: rated.length };
  }, [data.tickets]);

  if (data.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;

  const pct = (n: number) => stats.total ? Math.round((n / stats.total) * 100) : 0;
  const fmtH = (h: number | null) => h == null ? "—" : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
  const csatMax = Math.max(1, ...stats.csatDist.map(d => d.n));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-5"><div className="text-3xl font-bold">{stats.total}</div><div className="text-xs text-muted-foreground mt-1">Total tickets</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-3xl font-bold text-destructive">{stats.bugs}</div><div className="text-xs text-muted-foreground mt-1">Bugs · {pct(stats.bugs)}%</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-3xl font-bold text-primary">{stats.features}</div><div className="text-xs text-muted-foreground mt-1">Feature requests · {pct(stats.features)}%</div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="text-3xl font-bold">{stats.other}</div><div className="text-xs text-muted-foreground mt-1">Questions / other · {pct(stats.other)}%</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5 space-y-2">
            <h3 className="text-sm font-semibold mb-2">Avg time to resolve</h3>
            <div className="flex justify-between text-sm"><span>All resolved</span><span className="font-medium">{fmtH(stats.ttrAll)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-destructive">Bugs</span><span className="font-medium">{fmtH(stats.ttrBugs)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-primary">Feature requests</span><span className="font-medium">{fmtH(stats.ttrFr)}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-2">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold">CSAT</h3>
              <div className="text-xs text-muted-foreground">{stats.ratedCount} rated · avg {stats.avgCsat?.toFixed(2) ?? "—"}</div>
            </div>
            {stats.csatDist.map(d => (
              <div key={d.r} className="flex items-center gap-2">
                <div className="w-6 text-xs">{d.r}★</div>
                <div className="flex-1 bg-muted rounded h-4 relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${(d.n / csatMax) * 100}%` }} />
                </div>
                <div className="w-8 text-right text-xs">{d.n}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">Type mix by product area</h3>
          <div className="space-y-2">
            {stats.productAreas.map(pa => (
              <div key={pa.name} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{pa.name}</span>
                  <span className="text-muted-foreground">{pa.total}</span>
                </div>
                <div className="flex h-4 rounded overflow-hidden bg-muted">
                  {(["bug", "feature", "other"] as const).map(k => (
                    pa[k] > 0 && <div key={k} className={typeColor[k]} style={{ width: `${(pa[k] / pa.total) * 100}%` }} title={`${k}: ${pa[k]}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground mt-3 pt-3 border-t">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-destructive/70" />Bug</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary/70" />Feature</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-muted-foreground/40" />Other</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3">Owner load</h3>
          <div className="space-y-2">
            {stats.owners.map(o => (
              <div key={o.name} className="flex items-center gap-3 text-sm">
                <div className="w-32 truncate">{o.name}</div>
                <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${(o.total / stats.owners[0].total) * 100}%` }} />
                </div>
                <div className="w-32 text-right text-xs text-muted-foreground">{o.total} · {o.bugs}b · {o.features}fr</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
