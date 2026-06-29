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
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

type Row = {
  id: string;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  finalized_at: string | null;
  lifecycle_status: string;
  state: string | null;
  csat_rating: number | null;
  time_to_resolve_s: number | null;
  admin_assignee_id: string | null;
  tags: string[] | null;
  rsa_override: boolean | null;
};

type ActiveRow = {
  id: string;
  intercom_created_at: string | null;
  lifecycle_status: string;
  reopen_count: number | null;
  tags: string[] | null;
  rsa_override: boolean | null;
};

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

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function AnalyticsV3() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [includeOpen, setIncludeOpen] = useState(false);
  const [excludeRsaFalse, setExcludeRsaFalse] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [activeRows, setActiveRows] = useState<ActiveRow[]>([]);
  const [ownerMap, setOwnerMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("settings").select("admin_owner_map").limit(1).maybeSingle();
      if (data?.admin_owner_map) {
        try { setOwnerMap(JSON.parse(data.admin_owner_map)); } catch { /* ignore */ }
      }
    })();
  }, []);

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
            .select("id,intercom_created_at,intercom_closed_at,finalized_at,lifecycle_status,state,csat_rating,time_to_resolve_s,admin_assignee_id,tags,rsa_override")
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
            .select("id,intercom_created_at,lifecycle_status,reopen_count,tags,rsa_override")
            .neq("lifecycle_status", "finalized")
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
  const filteredRows = useMemo(
    () => (excludeRsaFalse ? rows.filter((r) => effectiveRsa(r).value === "required") : rows),
    [rows, excludeRsaFalse],
  );
  const filteredActiveRows = useMemo(
    () => (excludeRsaFalse ? activeRows.filter((r) => effectiveRsa(r).value === "required") : activeRows),
    [activeRows, excludeRsaFalse],
  );
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

  // KPI stats: rows created in range, optionally filtered to finalized-only.
  const stats = useMemo(() => {
    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();
    const inRange = filteredRows.filter((r) => {
      if (!r.intercom_created_at) return false;
      const t = new Date(r.intercom_created_at).getTime();
      if (t < fromMs || t > toMs) return false;
      if (!includeOpen && r.lifecycle_status !== "finalized") return false;
      return true;
    });
    const total = inRange.length;
    const ratings = inRange.map((r) => r.csat_rating).filter((v): v is number => typeof v === "number");
    const avgCsat = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    const closeTimes = inRange
      .map((r) => r.time_to_resolve_s)
      .filter((v): v is number => typeof v === "number" && v > 0);
    return {
      total, avgCsat, ratedN: ratings.length,
      medClose: median(closeTimes), closeN: closeTimes.length,
    };
  }, [filteredRows, range.from, range.to, includeOpen]);

  // Active KPIs: snapshot of active backlog right now.
  const activeStats = useMemo(() => {
    const openNow = filteredActiveRows.filter((r) => r.lifecycle_status === "open").length;
    const reopened = filteredActiveRows.filter((r) => r.lifecycle_status === "reopened_after_finalize").length;
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

            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
              <button
                onClick={() => setIncludeOpen(false)}
                className={`px-3 py-1.5 ${!includeOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              >
                Finalized only
              </button>
              <button
                onClick={() => setIncludeOpen(true)}
                className={`px-3 py-1.5 border-l border-border ${includeOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              >
                Include open
              </button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card><CardContent className="p-4 text-sm text-destructive">Failed to load: {error}</CardContent></Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Kpi title="Total tickets" value={loading ? "…" : stats.total.toLocaleString()} sub={includeOpen ? "Finalized + open, created in range" : "Finalized only, created in range"} loading={loading} />
          <Kpi title="Average CSAT" value={loading ? "…" : stats.avgCsat != null ? stats.avgCsat.toFixed(2) : "—"} sub={`n = ${stats.ratedN.toLocaleString()} rated`} loading={loading} />
          <Kpi title="Median time to resolve" value={loading ? "…" : formatDuration(stats.medClose)} sub={`n = ${stats.closeN.toLocaleString()} with timing`} loading={loading} />
        </div>

        <div>
          <h2 className="text-sm font-semibold tracking-tight mb-2 text-muted-foreground uppercase">Active backlog</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi title="Open now" value={loading ? "…" : activeStats.openNow.toLocaleString()} sub="lifecycle = open" loading={loading} small />
            <Kpi title="Reopened" value={loading ? "…" : activeStats.reopened.toLocaleString()} sub="not re-finalized" loading={loading} small />
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
                    <Tooltip
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

        <p className="text-xs text-muted-foreground">
          Time-to-resolve reads the pre-computed <code>time_to_resolve_s</code> snapshot taken at finalize (Intercom's
          <code> statistics.time_to_last_close</code>). Active backlog reflects every non-finalized row regardless of date.
          Data from {CLEAN_DATA_START_LABEL} onward.
        </p>
      </div>
    </AppLayout>
  );
}

function Kpi({ title, value, sub, loading, small }: { title: string; value: string; sub: string; loading: boolean; small?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{title}</CardDescription>
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
