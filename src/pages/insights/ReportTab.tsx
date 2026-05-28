import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format, parse, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Loader2, FileDown, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { channelNameOverrides } from "@/lib/channelOverrides";
import { MonthData, NormalizedTicket, useMonthData, sourceLabel } from "./useMonthData";
import { UncategorizedPanel } from "./UncategorizedPanel";
import { MonthStatsCards } from "./MonthStatsCards";
import { sourceBucketOf, reconcileSources } from "./sourceBucket";
import { INTERNAL_MANUAL_KEYS } from "./manualAccounts";

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
  onChanged?: () => void;
}

export function ReportTab({ data, month, onChanged }: ReportTabProps) {

  const reportRef = useRef<HTMLDivElement>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

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
  }, [month]);

  // Resolve Slack channel IDs → names. Pass the actual channel IDs from this
  // month + previous month so the edge function falls back to conversations.info
  // for channels the bot isn't in (otherwise IDs render raw).
  const channelIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const t of [...data.tickets, ...prev.tickets]) {
      if (t.customer_kind === "slack" && t.customer_raw_id) ids.add(t.customer_raw_id);
    }
    return Array.from(ids).sort().join(",");
  }, [data.tickets, prev.tickets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const channelIds = channelIdsKey ? channelIdsKey.split(",") : [];
      try {
        const { data: res } = await supabase.functions.invoke("list-slack-channels", {
          body: channelIds.length ? { channelIds } : {},
        });
        if (cancelled) return;
        const list = (res as { channels?: { id: string; name: string }[] })?.channels || [];
        const map: Record<string, string> = {};
        for (const ch of list) if (ch.name) map[ch.id] = ch.name;
        // overrides win
        Object.assign(map, channelNameOverrides);
        setChannelMap(map);
      } catch {
        if (!cancelled) setChannelMap({ ...channelNameOverrides });
      }
    })();
    return () => { cancelled = true; };
  }, [channelIdsKey]);

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
    reportRef.current.setAttribute("data-pdf-export", "true");
    try {
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 6; // mm
      const contentW = pageW - margin * 2;
      const usableH = pageH - margin * 2;
      let cursorY = margin;
      let isFirst = true;

      const sections = Array.from(reportRef.current.children) as HTMLElement[];

      for (const section of sections) {
        // Rasterize this section only
        const canvas = await html2canvas(section, { scale: 3, backgroundColor: "#ffffff", useCORS: true });
        const imgData = canvas.toDataURL("image/png");
        const imgH = (canvas.height * contentW) / canvas.width;

        if (imgH <= usableH) {
          // Fits as a single block — start a new page if it would overflow
          if (!isFirst && cursorY + imgH > pageH - margin) {
            pdf.addPage();
            cursorY = margin;
          }
          pdf.addImage(imgData, "PNG", margin, cursorY, contentW, imgH);
          cursorY += imgH + 4; // small gap between sections
          isFirst = false;
        } else {
          // Section taller than a full page — slice it across pages
          if (!isFirst) {
            pdf.addPage();
            cursorY = margin;
          }
          let heightLeft = imgH;
          let position = 0; // y offset (negative as we advance)
          pdf.addImage(imgData, "PNG", margin, margin, contentW, imgH);
          heightLeft -= usableH;
          while (heightLeft > 0) {
            position = heightLeft - imgH;
            pdf.addPage();
            pdf.addImage(imgData, "PNG", margin, position + margin, contentW, imgH);
            heightLeft -= usableH;
          }
          cursorY = pageH; // force next section to a new page
          isFirst = false;
        }
      }

      pdf.save(`monthly-report-${month}.pdf`);
    } finally {
      reportRef.current?.removeAttribute("data-pdf-export");
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
  if (overloadedOwner) highlights.push(`Highest owner load: ${overloadedOwner.name === "CSM" ? "CSM/Self-resolved" : overloadedOwner.name} with ${overloadedOwner.total} tickets.`);
  const unassigned = stats.owners.find(o => o.name === "Unassigned");
  if (unassigned && unassigned.total > 0) highlights.push(`${unassigned.total} tickets remain unassigned.`);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={exportPdf} disabled={exporting} size="sm">
          {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Exporting…</> : <><FileDown className="h-4 w-4 mr-2" />Download PDF</>}
        </Button>
      </div>

      <div ref={reportRef} className="space-y-8 bg-background p-6 rounded-lg border">
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

        {/* Source mix */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Source mix</h2>
              {(() => {
                const rec = reconcileSources(data.tickets);
                if (rec.ok && rec.unbucketed.length === 0) {
                  return (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={`Slack ${rec.counts.slack} + Gmail ${rec.counts.gmail} + Intercom ${rec.counts.intercom} + Other ${rec.counts.other} = ${rec.sum}`}>
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Reconciled · {rec.sum} / {rec.total}
                    </span>
                  );
                }
                return (
                  <span className="flex items-center gap-1 text-[11px] text-destructive font-medium" title={`Slack ${rec.counts.slack} + Gmail ${rec.counts.gmail} + Intercom ${rec.counts.intercom} + Other ${rec.counts.other} = ${rec.sum}; total = ${rec.total}; unbucketed (no route_source/display_source) = ${rec.unbucketed.length}`}>
                    <AlertTriangle className="h-3 w-3" />
                    Mismatch · sum {rec.sum} ≠ total {rec.total}
                    {rec.unbucketed.length > 0 && ` · ${rec.unbucketed.length} unbucketed`}
                  </span>
                );
              })()}
            </div>
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

        <MonthStatsCards data={data} month={month} />

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
              <div className="space-y-5">
                {[...insight.buckets].sort((a, b) => b.ticket_count - a.ticket_count).slice(0, 5).map(b => {
                  const topPas = Object.entries(b.product_areas).sort((a, b) => b[1] - a[1]).slice(0, 2);
                  return (
                    <div key={b.name} className="border-l-2 border-primary/40 pl-3 py-1">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="font-semibold text-sm">{b.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{b.ticket_count}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{b.description}</p>
                      {topPas.length > 0 && (
                        <div className="flex gap-1 mt-2">
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

        {/* Top accounts — per source */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-1">Top accounts</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Slack by channel · Gmail + Intercom by sender email domain · Manual contacts grouped by normalised account (e.g. "McKinsey" rolls up name + email + known contractors). Internal lovable.dev traffic and the consumer "Personal email" bucket are excluded. Click a row for bug/FR/CSAT details.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 [[data-pdf-export]_&]:!grid-cols-3 [[data-pdf-export]_&]:gap-4">
              <AccountMiniTable title="Slack" accounts={stats.slackAccounts} />
              <AccountMiniTable title="Gmail + Intercom" accounts={stats.emailAccounts} />
              <AccountMiniTable title="Manual contacts" accounts={stats.manualAccounts} />
            </div>
          </CardContent>
        </Card>

        {/* Product areas */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">By product area</h2>
            <div className="space-y-3">
              {stats.productAreasTop.map(pa => (
                <div key={pa.name} className="flex items-center gap-3 h-7">
                  <div className="w-44 text-xs leading-tight" title={pa.name}>{pa.name}</div>
                  <div className="flex-1 bg-muted rounded h-6 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-primary/70" style={{ width: `${(pa.count / Math.max(1, stats.productAreasTop[0]?.count || 1)) * 100}%` }} />
                  </div>
                  <div className="w-10 text-right text-xs font-medium tabular-nums">{pa.count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <UncategorizedPanel tickets={data.tickets} month={month} onChanged={onChanged} />

        {/* Owner load */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-3">Owner load</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2.5 font-medium">Owner</th>
                  <th className="py-2.5 font-medium">Total</th>
                  <th className="py-2.5 font-medium">Issue</th>
                  <th className="py-2.5 font-medium">Bug</th>
                  <th className="py-2.5 font-medium">FR</th>
                  <th className="py-2.5 font-medium">Config</th>
                  <th className="py-2.5 font-medium">Question</th>
                  <th className="py-2.5 font-medium">CSAT</th>
                </tr>
              </thead>
              <tbody>
                {stats.owners.map(o => {
                  const monthDate = parse(month + "-01", "yyyy-MM-dd", new Date());
                  const from = format(startOfMonth(monthDate), "yyyy-MM-dd");
                  const to = format(endOfMonth(monthDate), "yyyy-MM-dd");
                  const ownerParam = o.name === "Unassigned" ? "unassigned" : o.name;
                  const href = `/conversations?owner=${encodeURIComponent(ownerParam)}&from=${from}&to=${to}&showAll=1`;
                  return (
                    <tr key={o.name} className="border-b last:border-0 hover:bg-accent/40 cursor-pointer">
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.name === "CSM" ? "CSM/Self-resolved" : o.name}</Link></td>
                      <td className="py-2.5 align-middle font-medium"><Link to={href} className="block">{o.total}</Link></td>
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.Issue}</Link></td>
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.Bug}</Link></td>
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.FR}</Link></td>
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.Configuration}</Link></td>
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.Question}</Link></td>
                      <td className="py-2.5 align-middle"><Link to={href} className="block">{o.csatN ? (o.csatSum / o.csatN).toFixed(1) : "—"}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Highlights */}
        {highlights.length > 0 && (
          <Card>
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Highlights & watch-outs</h2>
              <ul className="space-y-2.5 text-sm leading-relaxed">
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

function AccountMiniTable({ title, accounts }: { title: string; accounts: AccountAgg[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</h3>
      {accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tickets</p>
      ) : (
        <ul className="space-y-2">
          {accounts.map(a => {
            const open = expanded === a.key;
            return (
              <li key={a.key} className="text-sm [[data-pdf-export]_&]:text-[13px]">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : a.key)}
                  className="w-full flex items-center justify-between gap-2 py-1.5 px-1 rounded hover:bg-muted/60 text-left leading-snug [[data-pdf-export]_&]:py-1 [[data-pdf-export]_&]:hover:bg-transparent"
                >
                  <span className="truncate flex-1 [[data-pdf-export]_&]:!whitespace-normal [[data-pdf-export]_&]:!overflow-visible [[data-pdf-export]_&]:!text-clip [[data-pdf-export]_&]:break-words" title={a.label}>{a.label}</span>
                  <span className="font-medium tabular-nums">{a.count}</span>
                </button>
                {open && (
                  <div className="pl-1 pb-1 text-[11px] text-muted-foreground flex gap-3">
                    <span>Bugs <span className="text-foreground font-medium">{a.bugs}</span></span>
                    <span>FRs <span className="text-foreground font-medium">{a.features}</span></span>
                    <span>CSAT <span className="text-foreground font-medium">{a.csatN ? (a.csatSum / a.csatN).toFixed(1) : "—"}</span></span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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

  // Source mix — bucket by ORIGIN (route_source). Shared with MonthStatsCards.
  const sourceColors: Record<string, string> = {
    intercom: "hsl(var(--primary))",
    slack: "hsl(var(--destructive))",
    gmail: "hsl(220 70% 55%)",
    other: "hsl(var(--muted-foreground))",
  };
  const sourceMix = (["intercom", "slack", "gmail", "other"] as const).map(s => {
    const count = tickets.filter(t => sourceBucketOf(t) === s).length;
    return { source: s, count, pct: total ? Math.round((count / total) * 100) : 0, color: sourceColors[s] };
  }).filter(s => s.count > 0);

  // Top accounts — bucketed by the *resolved account identifier*, not by
  // display_source, so that Slack-routed Intercom cases land under their
  // Slack channel (where they're recognizable).
  //   • Slack list → any ticket whose account resolves to a Slack channel
  //   • Email list → any ticket whose account resolves to an email domain
  //                  (Gmail + Intercom contacts combined; same domain sums)
  const slackMap = new Map<string, AccountAgg>();
  const emailMap = new Map<string, AccountAgg>();
  const manualMap = new Map<string, AccountAgg>();
  for (const t of tickets) {
    let key = t.customer_key;
    let label = t.customer_label;
    let aKind: string = t.customer_kind;
    if (t.customer_kind === "slack" && t.customer_raw_id) {
      const name = channelMap[t.customer_raw_id];
      if (name) { key = "channel:" + name.toLowerCase(); label = "#" + name; }
      aKind = "Channel";
    } else if (t.customer_kind === "domain") {
      aKind = "Domain";
    } else if (t.customer_kind === "manual") {
      aKind = "Contact";
    }

    let target: Map<string, AccountAgg> | null = null;
    if (t.customer_kind === "slack") {
      target = slackMap; // includes Slack-routed Intercom cases
    } else if (t.customer_kind === "domain" && (t.display_source === "gmail" || t.display_source === "intercom")) {
      // Exclude internal lovable.dev traffic and the consumer "Personal email"
      // aggregate so external company customers surface in Top accounts.
      if (key === "domain:lovable.dev" || label.toLowerCase() === "lovable.dev") continue;
      if (key === "domain:_personal") continue;
      target = emailMap;
    } else if (t.customer_kind === "manual") {
      // Skip generic placeholder buckets and internal lovable.dev contacts.
      if (key.startsWith("manual:")) continue;
      if (INTERNAL_MANUAL_KEYS.has(key)) continue;
      target = manualMap;
    } else if (t.customer_kind === "domain" && t.route_source === "manual") {
      // Manual-route domain row that didn't qualify for emailMap above
      // (e.g. display_source = "other" because no intercom_conversation_id).
      // Don't drop it — surface in Manual contacts instead.
      if (key === "domain:lovable.dev" || label.toLowerCase() === "lovable.dev") continue;
      if (key === "domain:_personal") continue;
      target = manualMap;
    }
    if (!target) continue; // skip anything else with no resolved account

    let a = target.get(key);
    if (!a) {
      a = { key, label, kind: aKind, count: 0, bugs: 0, features: 0, csatSum: 0, csatN: 0 };
      target.set(key, a);
    }
    a.count++;
    if (t.is_bug) a.bugs++;
    if (t.is_feature_request) a.features++;
    if (t.csat_rating) { a.csatSum += t.csat_rating; a.csatN++; }
  }
  const sortTop = (m: Map<string, AccountAgg>) =>
    Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  const slackAccounts = sortTop(slackMap);
  const emailAccounts = sortTop(emailMap);
  const manualAccounts = sortTop(manualMap);
  const topAccount = [...slackAccounts, ...emailAccounts, ...manualAccounts]
    .sort((a, b) => b.count - a.count)[0] || null;

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
    slackAccounts, emailAccounts, manualAccounts,
    topAccount, productAreasTop, topProductArea, worstCsatPa, owners, peakDow,
  };
}
