import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw, CalendarIcon, Info, Download } from "lucide-react";
import {
  format, startOfMonth, endOfMonth, subMonths, subDays,
  startOfDay, endOfDay, max as maxDate, eachMonthOfInterval,
} from "date-fns";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend,
} from "recharts";
import { CLEAN_DATA_START_DATE, CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";
import { median, percentile, formatDuration } from "@/lib/durationStats";
import { summarizeCsat, useCsatFilters, useCsatOverrides, csatExclusionNote } from "@/lib/csat";
import { CsatFilterMenu } from "@/components/csat/CsatFilterMenu";
import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { inPlanScope, type PlanScope } from "@/lib/planTier";
import { excludeTestTickets, showTestDataNow } from "@/lib/testTickets";
import { ACTIVE_LABEL, ACTIVE_TOOLTIP } from "@/lib/resolutionDisplay";
import {
  CHANNEL_KEYS, CHANNEL_LABEL, CHANNEL_DESCRIPTION, CHANNEL_COLOR,
  channelKeyOf, type ChannelKey,
} from "@/lib/channelReport";
import { toast } from "sonner";

type Row = {
  id: string;
  intercom_conversation_id: string;
  channel: string;
  subject: string;
  intercom_created_at: string | null;
  finalized_at: string | null;
  lifecycle_status: string;
  state: string | null;
  customer_key: string | null;
  product_area: string;
  ticket_type: string;
  plan_tier: string | null;
  csat_rating: number | null;
  csat_rater_is_internal: boolean | null;
  resolution_active_s: number | null;
  time_to_first_human_reply_s: number | null;
  is_test_ticket: boolean | null;
  tags: string[] | null;
  rsa_override: boolean | null;
};

type RangePreset = "30d" | "90d" | "this_month" | "last_month" | "all" | "custom";

const RANGE_LABEL: Record<RangePreset, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  all: `All v3 data (since ${CLEAN_DATA_START_LABEL})`,
  custom: "Custom range",
};

function clampToFloor(d: Date): Date {
  return maxDate([d, CLEAN_DATA_START_DATE]);
}

function computeRange(preset: RangePreset, from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case "30d": return { from: clampToFloor(startOfDay(subDays(now, 29))), to: endOfDay(now) };
    case "90d": return { from: clampToFloor(startOfDay(subDays(now, 89))), to: endOfDay(now) };
    case "this_month": return { from: clampToFloor(startOfMonth(now)), to: endOfDay(now) };
    case "last_month": {
      const m = subMonths(now, 1);
      return { from: clampToFloor(startOfMonth(m)), to: endOfMonth(m) };
    }
    case "all": return { from: CLEAN_DATA_START_DATE, to: endOfDay(now) };
    case "custom":
      return {
        from: clampToFloor(startOfDay(from ?? subDays(now, 29))),
        to: endOfDay(to ?? now),
      };
  }
}

type ChannelStat = {
  key: ChannelKey;
  count: number;
  pct: number;
  open: number;
  p50: number | null;
  p90: number | null;
  medFirstReply: number | null;
  csatAvg: number | null;
  csatN: number;
  csatNote: string | null;
  topAccounts: [string, number][];
  topAreas: [string, number][];
};

export default function ChannelReport() {
  const [preset, setPreset] = useState<RangePreset>("90d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const [planScope, setPlanScope] = useState<PlanScope>("all");
  const [csatFilters, setCsatFilters] = useCsatFilters();
  const { overrides: csatOverrides } = useCsatOverrides();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const range = useMemo(
    () => computeRange(preset, customFrom, customTo),
    [preset, customFrom?.getTime(), customTo?.getTime()],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase.rpc("v3_channel_report", {
          _from: range.from.toISOString(),
          _to: range.to.toISOString(),
        });
        if (error) throw error;
        if (!cancelled) setRows(excludeTestTickets((data ?? []) as Row[], showTestDataNow()));
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from.getTime(), range.to.getTime(), refreshKey]);

  const filtered = useMemo(
    () => (planScope === "all" ? rows : rows.filter((r) => inPlanScope(r.plan_tier, planScope))),
    [rows, planScope],
  );

  const total = filtered.length;

  const stats = useMemo<ChannelStat[]>(() => {
    return CHANNEL_KEYS.map((key) => {
      const rs = filtered.filter((r) => channelKeyOf(r.channel) === key);
      const active = rs.map((r) => r.resolution_active_s).filter((v): v is number => typeof v === "number");
      const firstReply = rs
        .map((r) => r.time_to_first_human_reply_s)
        .filter((v): v is number => typeof v === "number");
      const csat = summarizeCsat(rs, csatOverrides, csatFilters);

      const acc = new Map<string, number>();
      const area = new Map<string, number>();
      for (const r of rs) {
        const a = r.customer_key ?? "unresolved";
        acc.set(a, (acc.get(a) ?? 0) + 1);
        area.set(r.product_area, (area.get(r.product_area) ?? 0) + 1);
      }
      const top = (m: Map<string, number>, n: number) =>
        Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);

      return {
        key,
        count: rs.length,
        pct: total ? (rs.length / total) * 100 : 0,
        open: rs.filter((r) => r.finalized_at == null).length,
        p50: median(active),
        p90: percentile(active, 90),
        medFirstReply: median(firstReply),
        csatAvg: csat.avg,
        csatN: csat.n,
        csatNote: csatExclusionNote(csat),
        topAccounts: top(acc, 5),
        topAreas: top(area, 3),
      };
    }).filter((s) => s.count > 0);
  }, [filtered, total, csatOverrides, csatFilters]);

  const monthly = useMemo(() => {
    if (!filtered.length) return [] as Array<Record<string, string | number>>;
    const months = eachMonthOfInterval({
      start: startOfMonth(clampToFloor(range.from)),
      end: startOfMonth(range.to),
    });
    return months.map((m) => {
      const key = format(m, "yyyy-MM");
      const rs = filtered.filter((r) => (r.intercom_created_at ?? "").slice(0, 7) === key);
      const row: Record<string, string | number> = { month: format(m, "MMM yyyy"), Total: rs.length };
      for (const c of CHANNEL_KEYS) {
        row[CHANNEL_LABEL[c]] = rs.filter((r) => channelKeyOf(r.channel) === c).length;
      }
      return row;
    });
  }, [filtered, range.from.getTime(), range.to.getTime()]);

  /** Channels that actually appear in the window — keeps the chart legend honest. */
  const presentChannels = useMemo(
    () => CHANNEL_KEYS.filter((c) => stats.some((s) => s.key === c)),
    [stats],
  );

  const exportCsv = () => {
    const header = [
      "month", ...presentChannels.map((c) => CHANNEL_LABEL[c]), "total",
    ];
    const lines = [header.join(",")];
    for (const m of monthly) {
      lines.push([
        m.month,
        ...presentChannels.map((c) => m[CHANNEL_LABEL[c]] ?? 0),
        m.Total,
      ].join(","));
    }
    lines.push("");
    lines.push(["channel", "tickets", "share_pct", "still_open", `p50_${ACTIVE_LABEL}`, `p90_${ACTIVE_LABEL}`, "median_first_reply", "csat_avg", "csat_n"].join(","));
    for (const s of stats) {
      lines.push([
        CHANNEL_LABEL[s.key], s.count, s.pct.toFixed(1), s.open,
        formatDuration(s.p50), formatDuration(s.p90), formatDuration(s.medFirstReply),
        s.csatAvg == null ? "" : s.csatAvg.toFixed(2), s.csatN,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `channel-report-${format(range.from, "yyyyMMdd")}-${format(range.to, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Channel report exported");
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Channels report (v3)</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Where enterprise tickets actually come in, and how each access point performs.
              Built only on the v3 dataset from {CLEAN_DATA_START_LABEL}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
              <SelectTrigger className="w-[220px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RANGE_LABEL) as RangePreset[]).map((p) => (
                  <SelectItem key={p} value={p}>{RANGE_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {preset === "custom" && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customFrom ? format(customFrom, "d MMM yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-9 justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customTo ? format(customTo, "d MMM yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </>
            )}

            <PlanScopeSelect value={planScope} onChange={setPlanScope} className="w-[210px] h-9" />
            <CsatFilterMenu filters={csatFilters} onChange={setCsatFilters} />
            <Button variant="outline" size="sm" className="h-9" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} disabled={!stats.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-20 justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading channel data…
          </div>
        ) : total === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No v3 tickets in this range.
          </CardContent></Card>
        ) : (
          <>
            {/* Intake mix */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Intake mix · {total} tickets · {format(range.from, "d MMM yyyy")} – {format(range.to, "d MMM yyyy")}
                </CardTitle>
                <CardDescription>
                  Each ticket is counted once. Access points are resolved in order: in-app form, Slack
                  relay, direct email, Intercom widget, then anything left over.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex h-7 rounded overflow-hidden bg-muted">
                  {stats.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-center justify-center text-[11px] font-medium text-white"
                      style={{ width: `${s.pct}%`, background: CHANNEL_COLOR[s.key] }}
                      title={`${CHANNEL_LABEL[s.key]} · ${s.count} (${s.pct.toFixed(1)}%)`}
                    >
                      {s.pct >= 7 && `${s.pct.toFixed(0)}%`}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                  {stats.map((s) => (
                    <span key={s.key} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHANNEL_COLOR[s.key] }} />
                      {CHANNEL_LABEL[s.key]} · <span className="text-foreground font-medium">{s.count}</span> ({s.pct.toFixed(1)}%)
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Monthly trend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Monthly intake by access point</CardTitle>
                <CardDescription>Volume per month, stacked by where the ticket came in.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <RTooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {presentChannels.map((c) => (
                        <Bar key={c} dataKey={CHANNEL_LABEL[c]} stackId="a" fill={CHANNEL_COLOR[c]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left font-medium py-2 w-[140px]">Month</th>
                        {presentChannels.map((c) => (
                          <th key={c} className="text-left font-medium py-2 w-[160px]">{CHANNEL_LABEL[c]}</th>
                        ))}
                        <th className="text-left font-medium py-2 w-[100px]">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.map((m) => (
                        <tr key={String(m.month)} className="border-b last:border-0">
                          <td className="py-2 font-medium">{m.month}</td>
                          {presentChannels.map((c) => {
                            const n = Number(m[CHANNEL_LABEL[c]] ?? 0);
                            const t = Number(m.Total) || 0;
                            return (
                              <td key={c} className="py-2">
                                {n}
                                {t > 0 && <span className="text-muted-foreground text-xs"> ({Math.round((n / t) * 100)}%)</span>}
                              </td>
                            );
                          })}
                          <td className="py-2 font-medium">{m.Total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Per-channel operational cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {stats.map((s) => (
                <Card key={s.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: CHANNEL_COLOR[s.key] }} />
                          {CHANNEL_LABEL[s.key]}
                        </CardTitle>
                        <CardDescription className="mt-1">{CHANNEL_DESCRIPTION[s.key]}</CardDescription>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-bold leading-none">{s.count}</div>
                        <div className="text-xs text-muted-foreground mt-1">{s.pct.toFixed(1)}% of intake</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          P50 {ACTIVE_LABEL.toLowerCase()}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild><Info className="h-3 w-3" /></TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">{ACTIVE_TOOLTIP}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="font-medium">{formatDuration(s.p50)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">P90 {ACTIVE_LABEL.toLowerCase()}</div>
                        <div className="font-medium">{formatDuration(s.p90)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Median first human reply</div>
                        <div className="font-medium">{formatDuration(s.medFirstReply)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Still open</div>
                        <div className="font-medium">{s.open}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-xs text-muted-foreground">CSAT</div>
                        <div className="font-medium">
                          {s.csatAvg == null ? "No responses" : `${s.csatAvg.toFixed(2)} (n=${s.csatN})`}
                        </div>
                        {s.csatNote && <div className="text-[11px] text-muted-foreground mt-0.5">{s.csatNote}</div>}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5">Top accounts</div>
                      <div className="flex flex-wrap gap-1">
                        {s.topAccounts.map(([k, n]) => (
                          <Badge key={k} variant="outline" className="text-xs font-normal">{k} · {n}</Badge>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground mb-1.5">Top product areas</div>
                      <div className="flex flex-wrap gap-1">
                        {s.topAreas.map(([k, n]) => (
                          <Badge key={k} variant="secondary" className="text-xs font-normal">{k} · {n}</Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Access point is derived per ticket at read time from the v3 record: the sticky in-app-form
              flag, the detected Slack channel, and the Intercom source type. Test-designated tickets are
              excluded unless the shared show-test-data preference is on. Legacy Insights channel
              reporting is a separate surface on legacy tables and is not used here.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
