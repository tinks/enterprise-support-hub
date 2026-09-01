import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, RefreshCw, CalendarIcon, Beaker } from "lucide-react";
import {
  format, startOfMonth, endOfMonth, subMonths, subDays,
  startOfDay, endOfDay, max as maxDate, differenceInDays, eachDayOfInterval,
} from "date-fns";
import {
  CLEAN_DATA_START_DATE,
  CLEAN_DATA_START_LABEL,
} from "@/pages/inbox-v3/constants";
import { effectiveRsa } from "@/pages/inbox-v3/rsa";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend,
} from "recharts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { median, percentile, formatDuration } from "@/lib/durationStats";
import { summarizeCsat, useCsatFilters, useCsatOverrides } from "@/lib/csat";
import { CsatFilterMenu } from "@/components/csat/CsatFilterMenu";


import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { inPlanScope, type PlanScope } from "@/lib/planTier";
import {
  ACTIVE_LABEL, RAW_LABEL, ACTIVE_TOOLTIP, ACTIVE_FOOTNOTE,
  collectActive, collectRaw, activeSeconds, notComputableNote,
} from "@/lib/resolutionDisplay";

type Row = {
  id: string;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  finalized_at: string | null;
  lifecycle_status: string;
  state: string | null;
  csat_rating: number | null;
  csat_rater_is_internal: boolean | null;
  time_to_resolve_s: number | null;
  resolution_active_s: number | null;
  active_clock_engine_version: number | null;
  admin_assignee_id: string | null;
  tags: string[] | null;
  rsa_override: boolean | null;
  customer_key: string | null;
  customer_kind: string | null;
};

type ActiveRow = {
  id: string;
  intercom_created_at: string | null;
  lifecycle_status: string;
  reopen_count: number | null;
  tags: string[] | null;
  rsa_override: boolean | null;
  customer_key: string | null;
};

type AccountOpt = { account_key: string; label: string };

type RangePreset = "7d" | "14d" | "30d" | "this_month" | "last_month" | "custom";

function clampToFloor(d: Date): Date {
  return maxDate([d, CLEAN_DATA_START_DATE]);
}

function computeRange(preset: RangePreset, from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  let raw: { from: Date; to: Date };
  if (preset === "7d") raw = { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  else if (preset === "14d") raw = { from: startOfDay(subDays(now, 13)), to: endOfDay(now) };
  else if (preset === "30d") raw = { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
  else if (preset === "this_month") raw = { from: startOfMonth(now), to: endOfMonth(now) };
  else if (preset === "last_month") {
    const lm = subMonths(now, 1);
    raw = { from: startOfMonth(lm), to: endOfMonth(lm) };
  } else {
    raw = {
      from: from ? startOfDay(from) : startOfDay(subDays(now, 29)),
      to: to ? endOfDay(to) : endOfDay(now),
    };
  }
  return { from: clampToFloor(raw.from), to: raw.to };
}

// median / percentile / formatDuration live in src/lib/durationStats.ts so the
// Trend report reuses the exact same implementations.


export default function AnalyticsV3() {
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [excludeRsaFalse, setExcludeRsaFalse] = useState(false);
  const [csatFilters, setCsatFilters] = useCsatFilters();
  const { overrides: csatOverrides } = useCsatOverrides();
  const [rows, setRows] = useState<Row[]>([]);

  const [activeRows, setActiveRows] = useState<ActiveRow[]>([]);
  const [ownerMap, setOwnerMap] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [customerFilter, setCustomerFilter] = useState<string>("__any__");
  const [planScope, setPlanScope] = useState<PlanScope>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("admin_owner_map").limit(1).maybeSingle();
      if (data?.admin_owner_map) {
        try { setOwnerMap(JSON.parse(data.admin_owner_map)); } catch { /* ignore */ }
      }
      const { data: a } = await supabase.from("v3_customer_accounts").select("account_key,label").order("label");
      setAccounts((a ?? []) as AccountOpt[]);
    })();
  }, []);

  const accountLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.account_key, a.label);
    return (key: string | null) => {
      if (!key) return "—";
      if (key === "unknown") return "Unknown";
      if (key === "domain:_personal") return "Personal email";
      if (key.startsWith("domain:")) return key.slice(7);
      return m.get(key) ?? key;
    };
  }, [accounts]);

  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Range query: rows created OR finalized within range. Covers both
        // KPI "total" (filter client-side) and the Opened-vs-Finalized chart.
        const all: Row[] = [];
        const PAGE = 1000;
        let offset = 0;
        const fromIso = range.from.toISOString();
        const toIso = range.to.toISOString();
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_created_at,intercom_closed_at,finalized_at,lifecycle_status,state,csat_rating,csat_rater_is_internal,time_to_resolve_s,resolution_active_s,active_clock_engine_version,admin_assignee_id,tags,rsa_override,customer_key,customer_kind,plan_tier")
            .or(
              `and(intercom_created_at.gte.${fromIso},intercom_created_at.lte.${toIso}),` +
              `and(finalized_at.gte.${fromIso},finalized_at.lte.${toIso})`,
            )
            .order("intercom_created_at", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as Row[];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }

        // Active query: every non-finalized row (no date filter — "now" view).
        const active: ActiveRow[] = [];
        let aOff = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_created_at,lifecycle_status,reopen_count,tags,rsa_override,customer_key,plan_tier")
            // Explicit allow-list: 'transferred_out' is terminal (left our scope), never "active".
            .in("lifecycle_status", ["open", "reopened_after_finalize"])
            .order("intercom_created_at", { ascending: true })
            .range(aOff, aOff + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as ActiveRow[];
          active.push(...batch);
          if (batch.length < PAGE) break;
          aOff += PAGE;
        }

        if (!cancelled) {
          setRows(all);
          setActiveRows(active);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from.getTime(), range.to.getTime(), refreshKey]);

  // Apply the RSA filter once, upstream of every memo, so KPIs, charts, and the
  // per-engineer breakdown all agree on what counts as "Required Support Action".
  const filteredRows = useMemo(() => {
    let r = excludeRsaFalse ? rows.filter((x) => effectiveRsa(x).value === "required") : rows;
    if (planScope !== "all") r = r.filter((x) => inPlanScope((x as any).plan_tier, planScope));
    if (customerFilter !== "__any__") r = r.filter((x) => x.customer_key === customerFilter);
    return r;
  }, [rows, excludeRsaFalse, customerFilter, planScope]);
  const filteredActiveRows = useMemo(() => {
    let r = excludeRsaFalse ? activeRows.filter((x) => effectiveRsa(x).value === "required") : activeRows;
    if (planScope !== "all") r = r.filter((x) => inPlanScope((x as any).plan_tier, planScope));
    if (customerFilter !== "__any__") r = r.filter((x) => x.customer_key === customerFilter);
    return r;
  }, [activeRows, excludeRsaFalse, customerFilter, planScope]);
  const rsaHiddenInRange = useMemo(() => {
    if (!excludeRsaFalse) return 0;
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    return rows.filter((r) => {
      if (!r.intercom_created_at) return false;
      const t = new Date(r.intercom_created_at).getTime();
      if (t < fromMs || t > toMs) return false;
      return effectiveRsa(r).value === "not_required";
    }).length;
  }, [rows, range.from, range.to, excludeRsaFalse]);

  // KPI stats: tickets FINALIZED in the selected range (anchored on finalized_at,
  // our internal close timestamp). Excludes still-in-flight tickets — the inbound
  // "opened in range" count lives in the Active backlog strip below.
  const stats = useMemo(() => {
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    const inRange = filteredRows.filter((r) => {
      if (r.lifecycle_status !== "finalized") return false;
      if (!r.finalized_at) return false;
      const t = new Date(r.finalized_at).getTime();
      return t >= fromMs && t <= toMs;
    });
    const total = inRange.length;
    // CSAT counts only ratings that survive the shared filters (internal raters,
    // reasoned overrides). Raw counts stay visible via `csat`.
    const csat = summarizeCsat(inRange, csatOverrides, csatFilters);
    const avgCsat = csat.avg;
    const responseRate = total > 0 ? (csat.n / total) * 100 : null;
    // Headline resolution = ACTIVE clock (closed + waiting-on-customer excluded).
    // Raw wall clock is kept alongside for reconciliation only.
    const active = collectActive(inRange);
    const closeTimes = active.values;
    const rawTimes = collectRaw(inRange);
    const avgClose = closeTimes.length ? closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length : null;
    return {
      total, avgCsat, ratedN: csat.n, csat, closedDenominator: total, responseRate,
      medClose: median(closeTimes), closeN: closeTimes.length,
      avgClose,
      p90Close: closeTimes.length >= 10 ? percentile(closeTimes, 90) : null,
      p90Eligible: closeTimes.length >= 10,
      notComputable: active.notComputable,
      zeroActive: active.zeroActive,
      medRaw: median(rawTimes), rawN: rawTimes.length,
      avgRaw: rawTimes.length ? rawTimes.reduce((a, b) => a + b, 0) / rawTimes.length : null,
    };
  }, [filteredRows, range.from, range.to, csatOverrides, csatFilters]);


  // Active KPIs: snapshot of active backlog right now.
  const activeStats = useMemo(() => {
    // "Open now" = every ticket still open in Intercom, no math: open + reopened-and-not-re-closed.
    const reopened = filteredActiveRows.filter((r) => r.lifecycle_status === "reopened_after_finalize").length;
    const openNow = filteredActiveRows.length;
    const now = Date.now();
    let oldestAgeDays: number | null = null;
    for (const r of filteredActiveRows) {
      if (!r.intercom_created_at) continue;
      const ageDays = Math.floor((now - new Date(r.intercom_created_at).getTime()) / 86_400_000);
      if (oldestAgeDays == null || ageDays > oldestAgeDays) oldestAgeDays = ageDays;
    }
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    const openedInRange = filteredRows.filter((r) => {
      if (!r.intercom_created_at) return false;
      const t = new Date(r.intercom_created_at).getTime();
      return t >= fromMs && t <= toMs;
    }).length;
    return { openNow, reopened, oldestAgeDays, openedInRange };
  }, [filteredActiveRows, filteredRows, range.from, range.to]);

  // Opened vs Finalized over time
  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const buckets = new Map<string, { day: string; opened: number; finalized: number }>();
    for (const d of days) {
      const key = format(d, "yyyy-MM-dd");
      buckets.set(key, { day: key, opened: 0, finalized: 0 });
    }
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    for (const r of filteredRows) {
      if (r.intercom_created_at) {
        const t = new Date(r.intercom_created_at).getTime();
        if (t >= fromMs && t <= toMs) {
          const k = format(new Date(r.intercom_created_at), "yyyy-MM-dd");
          const b = buckets.get(k);
          if (b) b.opened += 1;
        }
      }
      if (r.finalized_at) {
        const t = new Date(r.finalized_at).getTime();
        if (t >= fromMs && t <= toMs) {
          const k = format(new Date(r.finalized_at), "yyyy-MM-dd");
          const b = buckets.get(k);
          if (b) b.finalized += 1;
        }
      }
    }
    return Array.from(buckets.values());
  }, [filteredRows, range.from, range.to]);

  const rangeDays = Math.max(1, differenceInDays(range.to, range.from) + 1);

  // Resolved per engineer: rows with finalized_at in range, grouped by admin_assignee_id.
  const perEngineer = useMemo(() => {
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    const counts = new Map<string, number>();
    for (const r of filteredRows) {
      if (!r.finalized_at) continue;
      const t = new Date(r.finalized_at).getTime();
      if (t < fromMs || t > toMs) continue;
      const key = r.admin_assignee_id ?? "__unassigned__";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const max = Math.max(1, ...counts.values());
    const items = Array.from(counts.entries()).map(([id, count]) => {
      const name =
        id === "__unassigned__"
          ? "Unassigned"
          : ownerMap[id] ?? `Admin ${id}`;
      const mapped = id === "__unassigned__" || !!ownerMap[id];
      return { id, name, count, pct: total ? (count / total) * 100 : 0, barPct: (count / max) * 100, mapped };
    });
    items.sort((a, b) => b.count - a.count);
    return { items, total };
  }, [filteredRows, range.from, range.to, ownerMap]);

  // Top customers: aggregated over finalized-in-range rows and current active backlog.
  const topCustomers = useMemo(() => {
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    type Agg = { closed: number; csatSum: number; csatN: number; resolveTimes: number[]; open: number; reopened: number };
    const map = new Map<string, Agg>();
    const get = (k: string): Agg => {
      let v = map.get(k);
      if (!v) { v = { closed: 0, csatSum: 0, csatN: 0, resolveTimes: [], open: 0, reopened: 0 }; map.set(k, v); }
      return v;
    };
    for (const r of filteredRows) {
      if (r.lifecycle_status !== "finalized" || !r.finalized_at) continue;
      const t = new Date(r.finalized_at).getTime();
      if (t < fromMs || t > toMs) continue;
      const a = get(r.customer_key ?? "unknown");
      a.closed++;
      if (typeof r.csat_rating === "number"
          && !(csatFilters.excludeInternal && r.csat_rater_is_internal === true)
          && !(csatFilters.excludeOverridden && csatOverrides.has(r.id))) {
        a.csatSum += r.csat_rating; a.csatN++;
      }
      const act = activeSeconds(r);
      if (act != null) a.resolveTimes.push(act);
    }
    for (const r of filteredActiveRows) {
      const a = get(r.customer_key ?? "unknown");
      if (r.lifecycle_status === "reopened_after_finalize") a.reopened++;
      else a.open++;
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({
        key: k,
        label: accountLabel(k),
        closed: v.closed,
        avgCsat: v.csatN ? v.csatSum / v.csatN : null,
        medResolve: median(v.resolveTimes),
        open: v.open,
        reopened: v.reopened,
      }))
      .sort((a, b) => (b.closed + b.open + b.reopened) - (a.closed + a.open + a.reopened));
  }, [filteredRows, filteredActiveRows, range.from, range.to, accountLabel, csatOverrides, csatFilters]);



  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Beaker className="h-3.5 w-3.5" /> Sandbox · v3
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">Analytics v3</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Reads from <code className="text-xs">intercom_tickets_v3</code>. Closed-ticket reporting only by default
              (finalized rows). Independent of Analytics and Analytics v2.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Range</span>
              <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="14d">Last 14 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="last_month">Last month</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {preset === "custom" && (
              <div className="flex items-center gap-2">
                <DateField label="From" date={customFrom} onSelect={setCustomFrom} minDate={CLEAN_DATA_START_DATE} />
                <DateField label="To" date={customTo} onSelect={setCustomTo} minDate={CLEAN_DATA_START_DATE} />
              </div>
            )}

            <div className="text-xs text-muted-foreground ml-1">
              {format(range.from, "MMM d, yyyy")} → {format(range.to, "MMM d, yyyy")}
            </div>

            <PlanScopeSelect value={planScope} onChange={setPlanScope} className="w-[200px] h-9 text-xs" />
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue placeholder="Customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Customer: any</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>
                ))}
                <SelectItem value="domain:_personal">Personal email</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>

            <label
              className="ml-auto inline-flex items-center gap-2 text-xs cursor-pointer select-none"
              title="Hide tickets tagged enterprise-fyi or enterprise-duplicate (or manually marked RSA=false)"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={excludeRsaFalse}
                onChange={(e) => setExcludeRsaFalse(e.target.checked)}
              />
              <span>Exclude RSA = false</span>
              {excludeRsaFalse && rsaHiddenInRange > 0 && (
                <span className="text-muted-foreground">({rsaHiddenInRange} hidden)</span>
              )}
            </label>

            <CsatFilterMenu filters={csatFilters} onChange={setCsatFilters} summary={stats.csat} />

          </CardContent>
        </Card>

        {error && (
          <Card><CardContent className="p-4 text-sm text-destructive">Failed to load: {error}</CardContent></Card>
        )}

        <TooltipProvider delayDuration={150}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi
              title="Tickets closed in period"
              value={loading ? "…" : stats.total.toLocaleString()}
              sub={
                <span>
                  <span className="text-muted-foreground">{activeStats.openedInRange.toLocaleString()} opened in same window</span>
                </span>
              }
              tooltip="Tickets finalized (closed) during this date range, anchored on our internal finalized_at. Excludes tickets still in flight. Tickets opened in this window may close in a later period."
              loading={loading}
            />
            <Kpi
              title="Average CSAT"
              value={loading ? "…" : stats.avgCsat != null ? stats.avgCsat.toFixed(2) : "—"}
              sub={
                <span className="text-muted-foreground">
                  {stats.responseRate != null
                    ? `${stats.responseRate.toFixed(0)}% response rate (${stats.ratedN.toLocaleString()} rated / ${stats.closedDenominator.toLocaleString()} closed)`
                    : `n = ${stats.ratedN.toLocaleString()} rated`}
                  {stats.csat.internalExcluded + stats.csat.overriddenExcluded > 0 && (
                    <span className="block">
                      excl. {stats.csat.internalExcluded} internal · {stats.csat.overriddenExcluded} overridden
                    </span>
                  )}
                </span>
              }
              tooltip="CSAT averages can skew toward extremes when response rates are low. Treat anything under ~30% response with caution."
              loading={loading}
            />
            <Kpi
              title={`Median ${ACTIVE_LABEL.toLowerCase()}`}
              value={loading ? "…" : formatDuration(stats.medClose)}
              sub={
                <span className="text-muted-foreground">
                  {stats.p90Eligible
                    ? `P90: ${formatDuration(stats.p90Close)} · n = ${stats.closeN.toLocaleString()}`
                    : `P90: insufficient data (n < 10) · n = ${stats.closeN.toLocaleString()}`}
                  <br />
                  {RAW_LABEL} median: {formatDuration(stats.medRaw)}
                  {stats.notComputable > 0 ? ` · ${notComputableNote(stats.notComputable)}` : ""}
                </span>
              }
              tooltip={`${ACTIVE_TOOLTIP} Median = the typical ticket. P90 = 90% of tickets resolve at or under this. Hidden when fewer than 10 finalized tickets in range.`}
              loading={loading}
            />
            <Kpi
              title={`Average ${ACTIVE_LABEL.toLowerCase()}`}
              value={loading ? "…" : formatDuration(stats.avgClose)}
              sub={
                <span className="text-muted-foreground">
                  n = {stats.closeN.toLocaleString()}
                  {stats.zeroActive > 0 ? ` · ${stats.zeroActive} at 0h active` : ""}
                  <br />
                  {RAW_LABEL} avg: {formatDuration(stats.avgRaw)}
                </span>
              }
              tooltip={`${ACTIVE_TOOLTIP} Sensitive to outliers — compare against the median to spot skew.`}
              loading={loading}
            />
          </div>
        </TooltipProvider>


        <div>
          <h2 className="text-sm font-semibold tracking-tight mb-2 text-muted-foreground uppercase">Active backlog</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Kpi title="Open now" value={loading ? "…" : activeStats.openNow.toLocaleString()} sub={loading ? "open in Intercom" : `open in Intercom (incl. ${activeStats.reopened} reopened)`} loading={loading} small />

            <Kpi title="Oldest open age" value={loading ? "…" : activeStats.oldestAgeDays != null ? `${activeStats.oldestAgeDays}d` : "—"} sub="days since created" loading={loading} small />
            <Kpi title="Opened in range" value={loading ? "…" : activeStats.openedInRange.toLocaleString()} sub={`${rangeDays}d window`} loading={loading} small />
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Opened vs Finalized over time</CardTitle>
            <CardDescription className="text-xs">
              Daily counts by <code>intercom_created_at</code> and <code>finalized_at</code>. Backlog grows on days where
              opened &gt; finalized.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(v) => format(new Date(v), "MMM d")}
                      tick={{ fontSize: 11 }}
                      minTickGap={24}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                    <RTooltip
                      labelFormatter={(v) => format(new Date(v as string), "PP")}
                      formatter={(value: number, name: string) => [value, name]}
                    />

                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="opened" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Opened" />
                    <Line type="monotone" dataKey="finalized" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} name="Finalized" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resolved by engineer</CardTitle>
            <CardDescription className="text-xs">
              Tickets with <code>finalized_at</code> in range, grouped by <code>admin_assignee_id</code>. Includes Sam
              (AI agent) alongside human Enterprise Support Engineers. Unmapped IDs shown as <code>Admin &lt;id&gt;</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            ) : perEngineer.items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No resolved tickets in range.</div>
            ) : (
              <div className="space-y-1">
                {perEngineer.items.map((row) => (
                  <div key={row.id} className="grid grid-cols-[140px_1fr_60px_56px] items-center gap-3 py-1.5 text-sm">
                    <div className="truncate font-medium" title={row.name}>
                      {row.name}
                      {!row.mapped && row.id !== "__unassigned__" && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">unmapped</span>
                      )}
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${row.barPct}%` }} />
                    </div>
                    <div className="text-right tabular-nums">{row.count.toLocaleString()}</div>
                    <div className="text-right tabular-nums text-xs text-muted-foreground">{row.pct.toFixed(1)}%</div>
                  </div>
                ))}
                <div className="pt-2 mt-2 border-t border-border text-xs text-muted-foreground flex justify-between">
                  <span>Total resolved in range</span>
                  <span className="tabular-nums">{perEngineer.total.toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top customers</CardTitle>
            <CardDescription className="text-xs">
              Aggregated by <code>customer_key</code>. Closed = finalized in range. Open/Reopened = current backlog snapshot.
              Click a row to drill into Inbox v3 filtered by that customer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 flex items-center justify-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            ) : topCustomers.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No customer activity in range.</div>
            ) : (
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Customer</th>
                      <th className="text-right px-3 py-2">Closed</th>
                      <th className="text-right px-3 py-2">Avg CSAT</th>
                      <th className="text-right px-3 py-2">Median resolve (active)</th>
                      <th className="text-right px-3 py-2">Open</th>
                      <th className="text-right px-3 py-2">Reopened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.slice(0, 30).map((c) => (
                      <tr
                        key={c.key}
                        className="border-t border-border hover:bg-muted/30 cursor-pointer"
                        onClick={() => { window.location.href = `/inbox-v3?customer=${encodeURIComponent(c.key)}`; }}
                      >
                        <td className="px-3 py-1.5 font-medium">{c.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{c.closed}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{c.avgCsat != null ? c.avgCsat.toFixed(2) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-xs">{formatDuration(c.medResolve)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{c.open}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{c.reopened}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>


        <p className="text-xs text-muted-foreground">
          {ACTIVE_FOOTNOTE} Active backlog reflects every non-finalized row regardless of date.
          Data from {CLEAN_DATA_START_LABEL} onward.
        </p>
      </div>
    </AppLayout>
  );
}

function Kpi({ title, value, sub, loading, small, tooltip }: { title: string; value: string; sub: React.ReactNode; loading: boolean; small?: boolean; tooltip?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs flex items-center gap-1.5">
          <span>{title}</span>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors" aria-label={`About ${title}`}>
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </CardDescription>
        <CardTitle className={`${small ? "text-2xl" : "text-3xl"} font-semibold tracking-tight tabular-nums`}>
          {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : value}
        </CardTitle>
      </CardHeader>
      <CardContent><div className="text-xs text-muted-foreground">{sub}</div></CardContent>
    </Card>
  );
}


function DateField({
  label, date, onSelect, minDate,
}: { label: string; date?: Date; onSelect: (d?: Date) => void; minDate?: Date }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 justify-start font-normal">
          <CalendarIcon className="h-3.5 w-3.5 mr-2" />
          {date ? format(date, "MMM d, yyyy") : <span className="text-muted-foreground">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onSelect}
          disabled={minDate ? (d) => d < minDate : undefined}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
