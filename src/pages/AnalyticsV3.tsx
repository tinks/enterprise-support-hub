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
  startOfDay, endOfDay, max as maxDate,
} from "date-fns";
import {
  CLEAN_DATA_START_DATE,
  CLEAN_DATA_START_LABEL,
} from "@/pages/inbox-v3/constants";

type Row = {
  id: string;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  lifecycle_status: string;
  state: string | null;
  csat_rating: number | null;
  time_to_resolve_s: number | null;
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
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const all: Row[] = [];
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          let q = supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_created_at,intercom_closed_at,lifecycle_status,state,csat_rating,time_to_resolve_s")
            .gte("intercom_created_at", range.from.toISOString())
            .lte("intercom_created_at", range.to.toISOString())
            .order("intercom_created_at", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (!includeOpen) q = q.eq("lifecycle_status", "finalized");
          const { data, error } = await q;
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
  }, [range.from.getTime(), range.to.getTime(), includeOpen, refreshKey]);

  const stats = useMemo(() => {
    const total = rows.length;
    const ratings = rows.map((r) => r.csat_rating).filter((v): v is number => typeof v === "number");
    const avgCsat = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    const closeTimes = rows
      .map((r) => r.time_to_resolve_s)
      .filter((v): v is number => typeof v === "number" && v > 0);
    return {
      total,
      avgCsat,
      ratedN: ratings.length,
      medClose: median(closeTimes),
      closeN: closeTimes.length,
    };
  }, [rows]);

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

            <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden text-xs">
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
          <Kpi title="Total tickets" value={loading ? "…" : stats.total.toLocaleString()} sub={includeOpen ? "Finalized + open" : "Finalized only"} loading={loading} />
          <Kpi title="Average CSAT" value={loading ? "…" : stats.avgCsat != null ? stats.avgCsat.toFixed(2) : "—"} sub={`n = ${stats.ratedN.toLocaleString()} rated`} loading={loading} />
          <Kpi title="Median time to resolve" value={loading ? "…" : formatDuration(stats.medClose)} sub={`n = ${stats.closeN.toLocaleString()} with timing`} loading={loading} />
        </div>

        <p className="text-xs text-muted-foreground">
          Time-to-resolve reads the pre-computed <code>time_to_resolve_s</code> snapshot taken at finalize (Intercom's
          <code> statistics.time_to_last_close</code>). Data from {CLEAN_DATA_START_LABEL} onward.
        </p>
      </div>
    </AppLayout>
  );
}

function Kpi({ title, value, sub, loading }: { title: string; value: string; sub: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{title}</CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
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
