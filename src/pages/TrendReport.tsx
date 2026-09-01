import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Copy, Check, Beaker } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { CLEAN_DATA_START_DATE, CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";
import { effectiveRsa } from "@/pages/inbox-v3/rsa";
import { median, percentile, formatDuration } from "@/lib/durationStats";
import { summarizeCsat, isRatingCounted, useCsatFilters, useCsatOverrides } from "@/lib/csat";
import { CsatFilterMenu } from "@/components/csat/CsatFilterMenu";
import { useCanEdit } from "@/hooks/useCanEdit";
import { toast } from "sonner";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend,
} from "recharts";

import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { inPlanScope, type PlanScope } from "@/lib/planTier";

type Row = {
  id: string;
  intercom_created_at: string | null;
  finalized_at: string | null;
  lifecycle_status: string;
  csat_rating: number | null;
  csat_rater_is_internal: boolean | null;
  time_to_resolve_s: number | null;
  last_reopened_at: string | null;
  reopen_count_at_finalize: number | null;

  tags: string[] | null;
  rsa_override: boolean | null;
  customer_key: string | null;
};

type AccountOpt = { account_key: string; label: string };

type MonthBucket = {
  key: string;          // yyyy-MM
  label: string;        // MMM yyyy
  start: Date;
  end: Date;
  total: number;
  closed: number;
  resolvedPct: number | null;
  avgCsat: number | null;
  csatN: number;
  csatExcluded: number;
  avgResolve: number | null;
  medResolve: number | null;
  p90Resolve: number | null;
  backlog: number;
};

const METRIC_KEYS = [
  "total",
  "closed",
  "resolved_pct",
  "csat",
  "avg_resolve",
  "median_resolve",
  "backlog",

] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

const METRIC_LABELS: Record<MetricKey, string> = {
  total: "Total tickets",
  closed: "Closed tickets",
  resolved_pct: "Resolved %",
  csat: "Avg CSAT",
  avg_resolve: "Average time to resolve",
  median_resolve: "Median time to resolve",
  backlog: "Active backlog (open at month end)",

};

/** Months present in the window, oldest → newest, never earlier than the data floor. */
function buildMonths(count: number): { key: string; label: string; start: Date; end: Date }[] {
  const now = new Date();
  const out: { key: string; label: string; start: Date; end: Date }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const anchor = subMonths(now, i);
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    if (end < CLEAN_DATA_START_DATE) continue;
    out.push({ key: format(start, "yyyy-MM"), label: format(start, "MMM yyyy"), start, end });
  }
  return out;
}

function fmtCell(metric: MetricKey, m: MonthBucket): string {
  switch (metric) {
    case "total": return String(m.total);
    case "closed": return String(m.closed);
    case "resolved_pct": return m.resolvedPct == null ? "—" : `${m.resolvedPct.toFixed(0)}%`;
    case "csat": return m.avgCsat == null
      ? "—"
      : `${m.avgCsat.toFixed(2)} (n=${m.csatN}${m.csatExcluded ? `, ${m.csatExcluded} excl.` : ""})`;
    case "avg_resolve": return formatDuration(m.avgResolve);
    case "median_resolve":
      return m.p90Resolve == null
        ? formatDuration(m.medResolve)
        : `${formatDuration(m.medResolve)} · P90 ${formatDuration(m.p90Resolve)}`;
    case "backlog": return String(m.backlog);

  }
}

export default function TrendReport() {
  const { canEdit } = useCanEdit();
  const [monthCount, setMonthCount] = useState(6);
  const [excludeRsaFalse, setExcludeRsaFalse] = useState(false);
  const [csatFilters, setCsatFilters] = useCsatFilters();
  const { overrides: csatOverrides } = useCsatOverrides();
  const [customerFilter, setCustomerFilter] = useState<string>("__any__");
  const [planScope, setPlanScope] = useState<PlanScope>("all");
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const months = useMemo(() => buildMonths(monthCount), [monthCount]);
  const windowStart = months.length ? months[0].start : CLEAN_DATA_START_DATE;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("v3_customer_accounts").select("account_key,label").order("label");
      setAccounts((data ?? []) as AccountOpt[]);
      const { data: n } = await supabase.from("esh_trend_notes").select("metric_key,note_text");
      const map: Record<string, string> = {};
      for (const r of n ?? []) map[(r as any).metric_key] = (r as any).note_text ?? "";
      setNotes(map);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // One fetch for the whole window. Backlog-at-month-end needs rows that
        // were opened BEFORE the window and are still open (or closed inside it),
        // hence the `finalized_at.is.null` leg.
        const startIso = windowStart.toISOString();
        const all: Row[] = [];
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_created_at,finalized_at,lifecycle_status,csat_rating,csat_rater_is_internal,time_to_resolve_s,last_reopened_at,reopen_count_at_finalize,tags,rsa_override,customer_key,plan_tier")
            .or(
              `intercom_created_at.gte.${startIso},` +
              `finalized_at.gte.${startIso},` +
              `last_reopened_at.gte.${startIso},` +
              `finalized_at.is.null,` +
              `lifecycle_status.eq.reopened_after_finalize`,
            )

            .order("intercom_created_at", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as Row[];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        if (!cancelled) setRows(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [windowStart.getTime(), refreshKey]);

  const filtered = useMemo(() => {
    let r = excludeRsaFalse ? rows.filter((x) => effectiveRsa(x).value === "required") : rows;
    if (planScope !== "all") r = r.filter((x) => inPlanScope((x as any).plan_tier, planScope));
    if (customerFilter !== "__any__") r = r.filter((x) => x.customer_key === customerFilter);
    return r;
  }, [rows, excludeRsaFalse, customerFilter, planScope]);

  const buckets = useMemo<MonthBucket[]>(() => {
    return months.map((m) => {
      const startMs = m.start.getTime();
      const endMs = m.end.getTime();

      let total = 0;
      let backlog = 0;
      const closedRows: Row[] = [];

      for (const r of filtered) {
        const createdMs = r.intercom_created_at ? new Date(r.intercom_created_at).getTime() : null;
        const finalMs = r.finalized_at ? new Date(r.finalized_at).getTime() : null;
        const reopenMs = r.last_reopened_at ? new Date(r.last_reopened_at).getTime() : null;
        const transferred = r.lifecycle_status === "transferred_out";

        if (createdMs != null && createdMs >= startMs && createdMs <= endMs) total++;

        // Closed in this month = it reached a close inside the month. A later
        // reopen does not erase that close, so we key off finalized_at rather
        // than the row's current lifecycle_status.
        if (!transferred && finalMs != null && finalMs >= startMs && finalMs <= endMs) closedRows.push(r);

        // Open at month end: existed by then, and either never closed, closed
        // after month end, or is currently sitting reopened after its last
        // close (lifecycle says so) with that reopen landing on or before the
        // month end. `finalized_at` is stale on those rows, so it alone cannot
        // decide openness.
        const openNowAfterReopen =
          r.lifecycle_status === "reopened_after_finalize" && reopenMs != null && reopenMs <= endMs;
        const closedByEnd = finalMs != null && finalMs <= endMs && !openNowAfterReopen;
        if (!transferred && createdMs != null && createdMs <= endMs && !closedByEnd) backlog++;

      }




      const closed = closedRows.length;
      const csatSummary = summarizeCsat(closedRows, csatOverrides, csatFilters);
      const ratings = closedRows
        .filter((r) => isRatingCounted(r, csatOverrides, csatFilters))
        .map((r) => r.csat_rating as number);
      const times = closedRows
        .map((r) => r.time_to_resolve_s)
        .filter((v): v is number => typeof v === "number" && v > 0);

      return {
        key: m.key,
        label: m.label,
        start: m.start,
        end: m.end,
        total,
        closed,
        resolvedPct: total > 0 ? (closed / total) * 100 : null,
        avgCsat: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        csatN: ratings.length,
        csatExcluded: csatSummary.internalExcluded + csatSummary.overriddenExcluded,
        avgResolve: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
        medResolve: median(times),
        p90Resolve: times.length >= 10 ? percentile(times, 90) : null,
        backlog,
      };
    });
  }, [filtered, months, csatOverrides, csatFilters]);

  const volumeChart = useMemo(
    () => buckets.map((b) => ({ month: b.label, Total: b.total, Closed: b.closed, Backlog: b.backlog })),
    [buckets],
  );
  const resolveChart = useMemo(
    () => buckets.map((b) => ({
      month: b.label,
      Average: b.avgResolve == null ? null : +(b.avgResolve / 86400).toFixed(2),
      Median: b.medResolve == null ? null : +(b.medResolve / 86400).toFixed(2),
    })),
    [buckets],
  );

  const saveNote = async (metric: MetricKey, text: string) => {
    setNotes((n) => ({ ...n, [metric]: text }));
    const { data: sess } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("esh_trend_notes")
      .upsert(
        { metric_key: metric, note_text: text, updated_by: sess.user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "metric_key" },
      );
    if (error) toast.error(`Note not saved: ${error.message}`);
  };

  const copyMarkdown = async () => {
    const header = ["Metric", ...buckets.map((b) => b.label), "Notes"];
    const lines = [
      `| ${header.join(" | ")} |`,
      `|${header.map(() => "---").join("|")}|`,
      ...METRIC_KEYS.map((k) =>
        `| ${[METRIC_LABELS[k], ...buckets.map((b) => fmtCell(k, b)), (notes[k] ?? "").replace(/\n/g, " ")].join(" | ")} |`,
      ),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    toast.success("Table copied — paste into Notion");
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Beaker className="h-3.5 w-3.5" /> Sandbox · v3
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">Trend report (v3)</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Month-over-month comparison built from <code className="text-xs">intercom_tickets_v3</code>, in the same
              shape as the monthly Notion write-up. Data floor: {CLEAN_DATA_START_LABEL}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyMarkdown} disabled={loading || !buckets.length}>
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />} Copy as Notion table
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Months</span>
              <Select value={String(monthCount)} onValueChange={(v) => setMonthCount(Number(v))}>
                <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 6, 9, 12].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} months</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <PlanScopeSelect value={planScope} onChange={setPlanScope} className="w-[200px] h-9" />
              <span className="text-xs text-muted-foreground">Customer</span>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger className="w-[220px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any customer</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="rsa" checked={excludeRsaFalse} onCheckedChange={setExcludeRsaFalse} />
              <Label htmlFor="rsa" className="text-xs text-muted-foreground">Exclude RSA = false</Label>
            </div>
            <CsatFilterMenu filters={csatFilters} onChange={setCsatFilters} />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardContent>
        </Card>

        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Volume by month</CardTitle>
              <CardDescription>Opened, closed, and backlog at month end.</CardDescription>
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={volumeChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Total" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Closed" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Backlog" stroke="hsl(var(--chart-4))" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Time to resolve (days)</CardTitle>
              <CardDescription>Average vs median, closed-in-month tickets.</CardDescription>
            </CardHeader>
            <CardContent className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={resolveChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="d" />
                  <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Average" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="Median" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Comparison table</CardTitle>
            <CardDescription>
              Notes are per metric and persist month to month.{" "}
              {!canEdit && <span className="text-muted-foreground">Read-only — notes are not editable for your role.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left font-medium px-4 py-2 w-[220px]">Metric</th>
                    {buckets.map((b) => (
                      <th key={b.key} className="text-left font-medium px-4 py-2 w-[140px] whitespace-nowrap">{b.label}</th>
                    ))}
                    <th className="text-left font-medium px-4 py-2 min-w-[280px]">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_KEYS.map((k) => (
                    <tr key={k} className="border-b last:border-0">
                      <td className="px-4 py-2 text-left font-medium">{METRIC_LABELS[k]}</td>
                      {buckets.map((b) => (
                        <td key={b.key} className="px-4 py-2 text-left tabular-nums whitespace-nowrap">
                          {fmtCell(k, b)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-left">
                        <Input
                          className="h-8 text-xs"
                          placeholder={canEdit ? "Add a note…" : "—"}
                          disabled={!canEdit}
                          defaultValue={notes[k] ?? ""}
                          onBlur={(e) => {
                            const v = e.target.value;
                            if (v !== (notes[k] ?? "")) void saveNote(k, v);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Backlog is a <strong>state check at the last instant of the month</strong>: created by then and not closed at
          that moment. A ticket reopened on the 15th and closed again on the 16th is closed at month end, so it does not
          count — a reopen only affects backlog when the ticket is still sitting open. Closed counts every close that
          landed in the month, even if the ticket reopened afterwards. Transferred-out tickets are excluded everywhere.
        </p>




      </div>
    </AppLayout>
  );
}
