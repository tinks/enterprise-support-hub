import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MonthData, NormalizedTicket } from "./useMonthData";

const BUCKETS = ["Issue", "Configuration", "Bug", "FR", "Question", "Unclassified"] as const;
type Bucket = typeof BUCKETS[number];

// Tailwind color tokens per bucket — using semantic tokens where possible.
const bucketColor: Record<Bucket, string> = {
  Issue: "bg-amber-500/70",
  Configuration: "bg-sky-500/70",
  Bug: "bg-destructive/70",
  FR: "bg-primary/70",
  Question: "bg-muted-foreground/40",
  Unclassified: "bg-muted-foreground/20 border border-border",
};
const bucketText: Record<Bucket, string> = {
  Issue: "text-amber-600 dark:text-amber-400",
  Configuration: "text-sky-600 dark:text-sky-400",
  Bug: "text-destructive",
  FR: "text-primary",
  Question: "text-muted-foreground",
  Unclassified: "text-muted-foreground",
};
const shortLabel: Record<Bucket, string> = {
  Issue: "i",
  Configuration: "c",
  Bug: "b",
  FR: "fr",
  Question: "q",
  Unclassified: "u",
};

function bucketOf(t: NormalizedTicket): Bucket {
  const c = (t.classification || "").trim();
  if (c === "Issue" || c === "Configuration" || c === "Bug" || c === "FR" || c === "Question") return c;
  if (t.is_bug) return "Bug";
  if (t.is_feature_request) return "FR";
  return "Unclassified";
}

export function TicketTypesTab({ data }: { data: MonthData }) {
  const stats = useMemo(() => {
    const total = data.tickets.length;

    // Per-bucket counts
    const counts = Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;
    for (const t of data.tickets) counts[bucketOf(t)]++;

    // Resolution time
    const resolved = data.tickets.filter(t => t.resolved_at);
    const avgHours = (rows: NormalizedTicket[]) => {
      if (!rows.length) return null;
      const sum = rows.reduce((acc, t) => acc + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()), 0);
      return sum / rows.length / (1000 * 60 * 60);
    };
    const ttrAll = avgHours(resolved);
    const ttrByBucket = Object.fromEntries(
      BUCKETS.map(b => [b, avgHours(resolved.filter(t => bucketOf(t) === b))])
    ) as Record<Bucket, number | null>;

    // CSAT
    const rated = data.tickets.filter(t => t.csat_rating);
    const avgCsat = rated.length ? rated.reduce((a, t) => a + (t.csat_rating || 0), 0) / rated.length : null;
    const csatDist = [1, 2, 3, 4, 5].map(r => ({ r, n: rated.filter(t => t.csat_rating === r).length }));

    // Per product area stack
    const paMap = new Map<string, Record<Bucket, number> & { total: number }>();
    for (const t of data.tickets) {
      const pa = t.product_area || "Uncategorized";
      const e = paMap.get(pa) || { ...Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>, total: 0 };
      e[bucketOf(t)]++;
      e.total++;
      paMap.set(pa, e);
    }
    const productAreas = Array.from(paMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);

    // Owner load with bucket breakdown
    const ownerMap = new Map<string, Record<Bucket, number> & { total: number }>();
    for (const t of data.tickets) {
      const o = t.owner || "Unassigned";
      const e = ownerMap.get(o) || { ...Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>, total: 0 };
      e[bucketOf(t)]++;
      e.total++;
      ownerMap.set(o, e);
    }
    const owners = Array.from(ownerMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);

    return { total, counts, ttrAll, ttrByBucket, avgCsat, csatDist, productAreas, owners, ratedCount: rated.length };
  }, [data.tickets]);

  if (data.loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;

  const pct = (n: number) => stats.total ? Math.round((n / stats.total) * 100) : 0;
  const fmtH = (h: number | null) => h == null ? "—" : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
  const csatMax = Math.max(1, ...stats.csatDist.map(d => d.n));

  return (
    <div className="space-y-6">
      {/* KPI cards: Total + per bucket */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-1">Total tickets</div>
          </CardContent>
        </Card>
        {BUCKETS.map(b => (
          <Card key={b}>
            <CardContent className="p-4">
              <div className={`text-2xl font-bold ${bucketText[b]}`}>{stats.counts[b]}</div>
              <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-sm ${bucketColor[b]}`} />
                {b} · {pct(stats.counts[b])}%
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5 space-y-2">
            <h3 className="text-sm font-semibold mb-2">Avg time to resolve</h3>
            <div className="flex justify-between text-sm border-b pb-2 mb-1">
              <span className="font-medium">All resolved</span>
              <span className="font-medium">{fmtH(stats.ttrAll)}</span>
            </div>
            {BUCKETS.map(b => (
              <div key={b} className="flex justify-between text-sm">
                <span className={`flex items-center gap-2 ${bucketText[b]}`}>
                  <span className={`inline-block w-2 h-2 rounded-sm ${bucketColor[b]}`} />
                  {b}
                </span>
                <span className="font-medium">{fmtH(stats.ttrByBucket[b])}</span>
              </div>
            ))}
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
                  {BUCKETS.map(b => (
                    pa[b] > 0 && <div key={b} className={bucketColor[b]} style={{ width: `${(pa[b] / pa.total) * 100}%` }} title={`${b}: ${pa[b]}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-3 pt-3 border-t">
            {BUCKETS.map(b => (
              <span key={b} className="flex items-center gap-1">
                <span className={`w-3 h-3 rounded-sm ${bucketColor[b]}`} />{b}
              </span>
            ))}
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
                <div className="flex-1 bg-muted rounded h-5 relative overflow-hidden flex">
                  {BUCKETS.map(b => (
                    o[b] > 0 && <div key={b} className={bucketColor[b]} style={{ width: `${(o[b] / stats.owners[0].total) * 100}%` }} title={`${b}: ${o[b]}`} />
                  ))}
                </div>
                <div className="w-56 text-right text-xs text-muted-foreground truncate">
                  {o.total}
                  {BUCKETS.filter(b => o[b] > 0).map(b => (
                    <span key={b}> · {o[b]}{shortLabel[b]}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
