import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { format, parse, startOfMonth, subMonths } from "date-fns";
import { Loader2, FileDown, Sparkles, RefreshCw, ChevronDown } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { channelNameOverrides } from "@/lib/channelOverrides";
import { MonthData, NormalizedTicket, useMonthData, sourceLabel } from "./useMonthData";

const BUCKETS = ["Issue", "Configuration", "Bug", "FR", "Question", "Unclassified"] as const;
type Bucket = typeof BUCKETS[number];

const bucketColor: Record<Bucket, string> = {
  Issue: "bg-amber-500/70",
  Configuration: "bg-sky-500/70",
  Bug: "bg-destructive/70",
  FR: "bg-primary/70",
  Question: "bg-muted-foreground/40",
  Unclassified: "bg-muted-foreground/20",
};

function bucketOf(t: NormalizedTicket): Bucket {
  const c = (t.classification || "").trim();
  if (c === "Issue" || c === "Configuration" || c === "Bug" || c === "FR" || c === "Question") return c as Bucket;
  if (t.is_bug) return "Bug";
  if (t.is_feature_request) return "FR";
  return "Unclassified";
}

const fmtH = (h: number | null) => h == null ? "—" : h < 24 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function ttrHours(t: NormalizedTicket): number | null {
  if (!t.resolved_at) return null;
  return (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / (1000 * 60 * 60);
}

interface Insight {
  month: string;
  generated_at: string;
  ticket_count: number;
  buckets: Array<{ name: string; description: string; ticket_count: number; product_areas: Record<string, number> }>;
  overall_summary: string;
}

interface ReportTabProps {
  data: MonthData;
  month: string;
}

export function ReportTab({ data, month }: ReportTabProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [insightNonce, setInsightNonce] = useState(0);

  const prevMonth = useMemo(() => {
    const d = startOfMonth(parse(month + "-01", "yyyy-MM-dd", new Date()));
    return format(subMonths(d, 1), "yyyy-MM");
  }, [month]);
  const prev = useMonthData(prevMonth);

  // Load saved AI insight
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from("monthly_insights")
        .select("month,generated_at,ticket_count,buckets,overall_summary")
        .eq("month", month)
        .eq("source", "all")
        .maybeSingle();
      if (cancelled) return;
      setInsight(row as unknown as Insight | null);
    })();
    return () => { cancelled = true; };
  }, [month, insightNonce]);

  const handleRefreshData = useCallback(() => {
    setRefreshing(true);
    data.refresh();
    prev.refresh();
    setInsightNonce(n => n + 1);
    toast.success("Data refreshed");
    setTimeout(() => setRefreshing(false), 600);
  }, [data, prev]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("analyze-intercom-month", { body: { month } });
      if (error) throw error;
      if ((res as { error?: string })?.error) throw new Error((res as { error: string }).error);
      const count = (res as { ticket_count?: number })?.ticket_count;
      data.refresh();
      prev.refresh();
      setInsightNonce(n => n + 1);
      toast.success("Report refreshed", { description: count != null ? `${count} tickets analyzed.` : undefined });
    } catch (e) {
      toast.error("AI refresh failed", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  }, [month, data, prev]);

  // Resolve Slack channel IDs → names
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await supabase.functions.invoke("list-slack-channels", { body: {} });
        if (cancelled) return;
        const map: Record<string, string> = { ...channelNameOverrides };
        const list = (res as { channels?: { id: string; name: string }[] })?.channels || [];
        for (const ch of list) map[ch.id] = ch.name;
        setChannelMap(map);
      } catch {
        if (!cancelled) setChannelMap({ ...channelNameOverrides });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => computeStats(data.tickets, channelMap), [data.tickets, channelMap]);
  const prevStats = useMemo(() => computeStats(prev.tickets, channelMap), [prev.tickets, channelMap]);

  const monthLabel = format(parse(month + "-01", "yyyy-MM-dd", new Date()), "MMMM yyyy");

  const delta = (cur: number, p: number): { txt: string; up: boolean } | null => {
    if (!p) return null;
    const pct = Math.round(((cur - p) / p) * 100);
    if (pct === 0) return { txt: "0%", up: true };
    return { txt: (pct > 0 ? "↑" : "↓") + Math.abs(pct) + "%", up: pct >= 0 };
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgW = pdfW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "PNG", 0, position, imgW, imgH);
      heightLeft -= pdfH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, position, imgW, imgH);
        heightLeft -= pdfH;
      }
      pdf.save(`monthly-report-${month}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  if (data.loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;
  }

  const dt = delta(stats.total, prevStats.total);
  const dCsat = stats.avgCsat != null && prevStats.avgCsat != null
    ? { txt: (stats.avgCsat - prevStats.avgCsat >= 0 ? "↑" : "↓") + Math.abs(stats.avgCsat - prevStats.avgCsat).toFixed(2), up: stats.avgCsat >= prevStats.avgCsat }
    : null;

  // Highlights / watch-outs
  const highlights: string[] = [];
  if (insight && insight.buckets?.length) {
    const top = [...insight.buckets].sort((a, b) => b.ticket_count - a.ticket_count)[0];
    if (top) highlights.push(`Largest topic: "${top.name}" with ${top.ticket_count} tickets (${Math.round((top.ticket_count / Math.max(1, stats.total)) * 100)}% of volume).`);
  }
  if (stats.topAccount) highlights.push(`Most active account: ${stats.topAccount.label} with ${stats.topAccount.count} tickets.`);
  if (stats.topProductArea) highlights.push(`Top product area: ${stats.topProductArea.name} (${stats.topProductArea.count} tickets).`);
  const bugShare = stats.total ? Math.round((stats.counts.Bug / stats.total) * 100) : 0;
  const prevBugShare = prevStats.total ? Math.round((prevStats.counts.Bug / prevStats.total) * 100) : 0;
  if (prevStats.total) highlights.push(`Bug share: ${bugShare}% (was ${prevBugShare}% last month).`);
  if (stats.peakDow) highlights.push(`Busiest day of week: ${stats.peakDow.label} (${stats.peakDow.count} tickets).`);
  if (stats.worstCsatPa) highlights.push(`Lowest CSAT product area: ${stats.worstCsatPa.name} at ${stats.worstCsatPa.avg.toFixed(1)}★ (${stats.worstCsatPa.n} ratings).`);
  const overloadedOwner = stats.owners.find(o => o.total >= 30 && o.name !== "Unassigned");
  if (overloadedOwner) highlights.push(`Highest owner load: ${overloadedOwner.name} with ${overloadedOwner.total} tickets.`);
  const unassigned = stats.owners.find(o => o.name === "Unassigned");
  if (unassigned && unassigned.total > 0) highlights.push(`${unassigned.total} tickets remain unassigned.`);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={exportPdf} disabled={exporting} size="sm">
          {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Exporting…</> : <><FileDown className="h-4 w-4 mr-2" />Download PDF</>}
        </Button>
      </div>

      <div ref={reportRef} className="space-y-6 bg-background p-6 rounded-lg border">
        {/* Header */}
        <div className="border-b pb-4">
          <h1 className="text-3xl font-bold">Monthly support report</h1>
          <p className="text-lg text-muted-foreground mt-1">{monthLabel}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {stats.total} tickets
            {dt && <> · {dt.txt} vs prev month</>}
            {stats.avgCsat != null && <> · {stats.avgCsat.toFixed(2)}★ CSAT</>}
            {stats.resolvedPct != null && <> · {stats.resolvedPct}% resolved</>}
          </p>
        </div>

        {/* Hero KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total tickets" value={stats.total.toString()} delta={dt} />
          <KpiCard label="Avg CSAT" value={stats.avgCsat != null ? stats.avgCsat.toFixed(2) + "★" : "—"} sub={`${stats.ratedCount} rated`} delta={dCsat} />
          <KpiCard label="Median time to resolve" value={fmtH(stats.medianTtr)} sub={`${stats.resolvedCount} resolved`} />
          <KpiCard label="Resolved this month" value={stats.resolvedPct != null ? stats.resolvedPct + "%" : "—"} />
        </div>

        {/* AI summary */}
        {insight?.overall_summary ? (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">AI summary</h2>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line">{insight.overall_summary}</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-5 text-sm text-muted-foreground">
              No AI summary for this month yet. Use "Generate topics" on the Topics tab to populate.
            </CardContent>
          </Card>
        )}

        {/* Volume + Source mix */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Daily volume</h2>
              <div className="flex items-end gap-1 h-32">
                {stats.daily.map((s, i) => (
                  <div key={i} className="flex-1 bg-primary/60 rounded-t" style={{ height: `${(s / Math.max(1, stats.dailyMax)) * 100}%` }} title={`Day ${i + 1}: ${s}`} />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>1</span><span>{Math.ceil(stats.daily.length / 2)}</span><span>{stats.daily.length}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Source mix</h2>
              <div className="flex h-6 rounded overflow-hidden bg-muted mb-3">
                {stats.sourceMix.map(s => (
                  <div key={s.source} style={{ width: `${s.pct}%`, background: s.color }} className="flex items-center justify-center text-[10px] text-primary-foreground font-medium">
                    {s.pct >= 8 && `${s.pct}%`}
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-xs">
                {stats.sourceMix.map(s => (
                  <div key={s.source} className="flex justify-between">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                      {sourceLabel[s.source]}
                    </span>
                    <span className="font-medium">{s.count} ({s.pct}%)</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ticket types */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Ticket types</h2>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
              {BUCKETS.map(b => (
                <div key={b} className="border rounded p-2">
                  <div className="text-xl font-bold">{stats.counts[b]}</div>
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <span className={`inline-block w-2 h-2 rounded-sm ${bucketColor[b]}`} />
                    {b} · {stats.total ? Math.round((stats.counts[b] / stats.total) * 100) : 0}%
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">TTR {fmtH(stats.ttrByBucket[b])}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top topics */}
        {insight?.buckets && insight.buckets.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Top topics</h2>
              <div className="space-y-3">
                {[...insight.buckets].sort((a, b) => b.ticket_count - a.ticket_count).slice(0, 5).map(b => {
                  const topPas = Object.entries(b.product_areas).sort((a, b) => b[1] - a[1]).slice(0, 2);
                  return (
                    <div key={b.name} className="border-l-2 border-primary/40 pl-3">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-sm">{b.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{b.ticket_count}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{b.description}</p>
                      {topPas.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {topPas.map(([pa, n]) => (
                            <Badge key={pa} variant="outline" className="text-[10px] px-1.5 py-0">{pa} · {n}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top accounts */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Top accounts</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-1.5 font-medium">Account</th>
                  <th className="py-1.5 font-medium">Tickets</th>
                  <th className="py-1.5 font-medium">Bugs</th>
                  <th className="py-1.5 font-medium">FRs</th>
                  <th className="py-1.5 font-medium">CSAT</th>
                </tr>
              </thead>
              <tbody>
                {stats.topAccounts.map(a => (
                  <tr key={a.key} className="border-b last:border-0">
                    <td className="py-1.5 max-w-[300px]">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{a.kind}</Badge>
                        <span className="truncate">{a.label}</span>
                      </div>
                    </td>
                    <td className="py-1.5 font-medium">{a.count}</td>
                    <td className="py-1.5">{a.bugs}</td>
                    <td className="py-1.5">{a.features}</td>
                    <td className="py-1.5">{a.csatN ? (a.csatSum / a.csatN).toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Product areas */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">By product area</h2>
            <div className="space-y-1.5">
              {stats.productAreasTop.map(pa => (
                <div key={pa.name} className="flex items-center gap-3">
                  <div className="w-32 text-xs truncate">{pa.name}</div>
                  <div className="flex-1 bg-muted rounded h-4 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${(pa.count / Math.max(1, stats.productAreasTop[0]?.count || 1)) * 100}%` }} />
                  </div>
                  <div className="w-10 text-right text-xs font-medium">{pa.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Owner load */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Owner load</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-1.5 font-medium">Owner</th>
                  <th className="py-1.5 font-medium">Total</th>
                  <th className="py-1.5 font-medium">Issue</th>
                  <th className="py-1.5 font-medium">Bug</th>
                  <th className="py-1.5 font-medium">FR</th>
                  <th className="py-1.5 font-medium">Config</th>
                  <th className="py-1.5 font-medium">Question</th>
                  <th className="py-1.5 font-medium">CSAT</th>
                </tr>
              </thead>
              <tbody>
                {stats.owners.map(o => (
                  <tr key={o.name} className="border-b last:border-0">
                    <td className="py-1.5">{o.name}</td>
                    <td className="py-1.5 font-medium">{o.total}</td>
                    <td className="py-1.5">{o.Issue}</td>
                    <td className="py-1.5">{o.Bug}</td>
                    <td className="py-1.5">{o.FR}</td>
                    <td className="py-1.5">{o.Configuration}</td>
                    <td className="py-1.5">{o.Question}</td>
                    <td className="py-1.5">{o.csatN ? (o.csatSum / o.csatN).toFixed(1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Highlights */}
        {highlights.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Highlights & watch-outs</h2>
              <ul className="space-y-1.5 text-sm">
                {highlights.map((h, i) => (
                  <li key={i} className="flex gap-2"><span className="text-primary">▸</span><span>{h}</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="text-[10px] text-muted-foreground text-center pt-4 border-t">
          Generated {format(new Date(), "MMM d, yyyy 'at' h:mm a")}
          {insight && <> · AI topics last refreshed {format(new Date(insight.generated_at), "MMM d, yyyy")}</>}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: { txt: string; up: boolean } | null }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
          <span>{label}</span>
          {delta && <span className={delta.up ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{delta.txt}</span>}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

interface AccountAgg {
  key: string;
  label: string;
  kind: string;
  count: number;
  bugs: number;
  features: number;
  csatSum: number;
  csatN: number;
}

function computeStats(tickets: NormalizedTicket[], channelMap: Record<string, string>) {
  const total = tickets.length;
  const counts = Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>;
  for (const t of tickets) counts[bucketOf(t)]++;

  const resolved = tickets.filter(t => t.resolved_at);
  const ttrAll = resolved.map(t => ttrHours(t)!).filter(n => n != null);
  const medianTtr = median(ttrAll);
  const resolvedPct = total ? Math.round((resolved.length / total) * 100) : null;

  const ttrByBucket = Object.fromEntries(BUCKETS.map(b => {
    const rows = resolved.filter(t => bucketOf(t) === b).map(t => ttrHours(t)!).filter(n => n != null);
    if (!rows.length) return [b, null];
    return [b, rows.reduce((a, n) => a + n, 0) / rows.length];
  })) as Record<Bucket, number | null>;

  const rated = tickets.filter(t => t.csat_rating);
  const avgCsat = rated.length ? rated.reduce((a, t) => a + (t.csat_rating || 0), 0) / rated.length : null;

  // Daily volume
  const daysInMonth = 31;
  const daily = new Array(daysInMonth).fill(0);
  for (const t of tickets) {
    const d = new Date(t.created_at).getDate();
    if (d >= 1 && d <= daysInMonth) daily[d - 1]++;
  }
  // Trim trailing zeros to actual month length (rough)
  const lastDay = tickets.length ? Math.max(...tickets.map(t => new Date(t.created_at).getDate())) : 30;
  const dailyTrim = daily.slice(0, Math.max(28, lastDay));
  const dailyMax = Math.max(1, ...dailyTrim);

  // Source mix
  const sourceColors: Record<string, string> = {
    intercom: "hsl(var(--primary))",
    slack: "hsl(var(--destructive))",
    gmail: "hsl(220 70% 55%)",
    other: "hsl(var(--muted-foreground))",
  };
  const sourceMix = (["intercom", "slack", "gmail", "other"] as const).map(s => {
    const count = tickets.filter(t => t.display_source === s).length;
    return { source: s, count, pct: total ? Math.round((count / total) * 100) : 0, color: sourceColors[s] };
  }).filter(s => s.count > 0);

  // Top accounts (resolve slack channel names)
  const accMap = new Map<string, AccountAgg>();
  for (const t of tickets) {
    let key = t.customer_key;
    let label = t.customer_label;
    if (t.customer_kind === "slack" && t.customer_raw_id) {
      const name = channelMap[t.customer_raw_id];
      if (name) { key = "channel:" + name.toLowerCase(); label = "#" + name; }
    }
    let a = accMap.get(key);
    if (!a) {
      a = { key, label, kind: t.customer_kind, count: 0, bugs: 0, features: 0, csatSum: 0, csatN: 0 };
      accMap.set(key, a);
    }
    a.count++;
    if (t.is_bug) a.bugs++;
    if (t.is_feature_request) a.features++;
    if (t.csat_rating) { a.csatSum += t.csat_rating; a.csatN++; }
  }
  const accountsArr = Array.from(accMap.values()).sort((a, b) => b.count - a.count);
  const topAccounts = accountsArr.slice(0, 8);
  const topAccount = accountsArr[0] || null;

  // Product areas
  const paMap = new Map<string, { count: number; csatSum: number; csatN: number }>();
  for (const t of tickets) {
    const pa = t.product_area || "Uncategorized";
    const e = paMap.get(pa) || { count: 0, csatSum: 0, csatN: 0 };
    e.count++;
    if (t.csat_rating) { e.csatSum += t.csat_rating; e.csatN++; }
    paMap.set(pa, e);
  }
  const paArr = Array.from(paMap.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count);
  const productAreasTop = paArr.slice(0, 10);
  const topProductArea = paArr[0] || null;
  const worstCsatPa = paArr
    .filter(p => p.csatN >= 3)
    .map(p => ({ name: p.name, avg: p.csatSum / p.csatN, n: p.csatN }))
    .sort((a, b) => a.avg - b.avg)[0] || null;

  // Owners
  type OwnerAgg = { name: string; total: number; csatSum: number; csatN: number } & Record<Bucket, number>;
  const ownerMap = new Map<string, OwnerAgg>();
  for (const t of tickets) {
    const o = t.owner || "Unassigned";
    let e = ownerMap.get(o);
    if (!e) {
      e = { name: o, total: 0, csatSum: 0, csatN: 0, ...(Object.fromEntries(BUCKETS.map(b => [b, 0])) as Record<Bucket, number>) };
      ownerMap.set(o, e);
    }
    e.total++;
    e[bucketOf(t)]++;
    if (t.csat_rating) { e.csatSum += t.csat_rating; e.csatN++; }
  }
  const owners = Array.from(ownerMap.values()).sort((a, b) => b.total - a.total);

  // Day of week
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const t of tickets) dowCounts[new Date(t.created_at).getDay()]++;
  const dowLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const peakIdx = dowCounts.indexOf(Math.max(...dowCounts));
  const peakDow = total ? { label: dowLabels[peakIdx], count: dowCounts[peakIdx] } : null;

  return {
    total, counts, ttrByBucket, medianTtr, resolvedCount: resolved.length, resolvedPct,
    avgCsat, ratedCount: rated.length, daily: dailyTrim, dailyMax, sourceMix,
    topAccounts, topAccount, productAreasTop, topProductArea, worstCsatPa, owners, peakDow,
  };
}
