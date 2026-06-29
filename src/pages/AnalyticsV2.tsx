import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, RefreshCw, CalendarIcon, Beaker } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, subDays, startOfDay, endOfDay } from "date-fns";
import { effectiveEngagement, type Engagement } from "@/pages/inbox-v2/engagement";

type Row = {
  id: string;
  intercom_created_at: string | null;
  status: string | null;
  csat_rating: number | null;
  tags: string[] | null;
  engagement_override: Engagement | null;
  engagement_ai_guess: Engagement | null;
  raw_payload: any;
};

type RangePreset = "7d" | "14d" | "30d" | "this_month" | "last_month" | "custom";

function computeRange(preset: RangePreset, from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  if (preset === "7d") return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  if (preset === "14d") return { from: startOfDay(subDays(now, 13)), to: endOfDay(now) };
  if (preset === "30d") return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
  if (preset === "this_month") return { from: startOfMonth(now), to: endOfMonth(now) };
  if (preset === "last_month") {
    const lm = subMonths(now, 1);
    return { from: startOfMonth(lm), to: endOfMonth(lm) };
  }
  return {
    from: from ? startOfDay(from) : startOfDay(subDays(now, 29)),
    to: to ? endOfDay(to) : endOfDay(now),
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHr = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (totalHr < 24) return `${totalHr}h ${m}m`;
  const d = Math.floor(totalHr / 24);
  const h = totalHr % 24;
  return `${d}d ${h}h`;
}

export default function AnalyticsV2() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [engagedOnly, setEngagedOnly] = useState(true);
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
          const { data, error } = await supabase
            .from("inbox_v2_tickets")
            .select("id,intercom_created_at,status,csat_rating,tags,engagement_override,engagement_ai_guess,raw_payload")
            .gte("intercom_created_at", range.from.toISOString())
            .lte("intercom_created_at", range.to.toISOString())
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
  }, [range.from.getTime(), range.to.getTime(), refreshKey]);

  const filtered = useMemo(() => {
    if (!engagedOnly) return rows;
    return rows.filter((r) => effectiveEngagement(r).value === "engaged");
  }, [rows, engagedOnly]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const ratings = filtered.map((r) => r.csat_rating).filter((v): v is number => typeof v === "number");
    const avgCsat = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

    const closeTimes = filtered
      .filter((r) => (r.status ?? "").toLowerCase() === "closed")
      .map((r) => {
        const s = r.raw_payload?.statistics?.time_to_last_close;
        return typeof s === "number" && s > 0 ? s : null;
      })
      .filter((v): v is number => v != null);
    const medClose = median(closeTimes);

    return {
      total,
      avgCsat,
      ratedN: ratings.length,
      medClose,
      closeN: closeTimes.length,
    };
  }, [filtered]);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Beaker className="h-3.5 w-3.5" /> Sandbox
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">Analytics v2</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Reads from <code className="text-xs">inbox_v2_tickets</code>. Independent of the live Analytics page.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Range</span>
              <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <SelectTrigger className="w-[170px] h-9">
                  <SelectValue />
                </SelectTrigger>
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
                <DateField label="From" date={customFrom} onSelect={setCustomFrom} />
                <DateField label="To" date={customTo} onSelect={setCustomTo} />
              </div>
            )}

            <div className="text-xs text-muted-foreground ml-1">
              {format(range.from, "MMM d, yyyy")} → {format(range.to, "MMM d, yyyy")}
            </div>

            <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden text-xs">
              <button
                onClick={() => setEngagedOnly(true)}
                className={`px-3 py-1.5 ${engagedOnly ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              >
                Engaged only
              </button>
              <button
                onClick={() => setEngagedOnly(false)}
                className={`px-3 py-1.5 border-l border-border ${!engagedOnly ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              >
                All tickets
              </button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card>
            <CardContent className="p-4 text-sm text-destructive">Failed to load: {error}</CardContent>
          </Card>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            title="Total tickets"
            value={loading ? "…" : stats.total.toLocaleString()}
            sub={engagedOnly ? "Engaged only" : "All tickets"}
            loading={loading}
          />
          <KpiCard
            title="Average CSAT"
            value={loading ? "…" : stats.avgCsat != null ? stats.avgCsat.toFixed(2) : "—"}
            sub={`n = ${stats.ratedN.toLocaleString()} rated`}
            loading={loading}
          />
          <KpiCard
            title="Median time to resolve"
            value={loading ? "…" : formatDuration(stats.medClose)}
            sub={`n = ${stats.closeN.toLocaleString()} closed`}
            loading={loading}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Time-to-resolve uses Intercom's <code>statistics.time_to_last_close</code> (same field as the live month
          stats). Only tickets with <code>status = closed</code> contribute. Engagement uses the override → AI guess →
          tag → default chain.
        </p>
      </div>
    </AppLayout>
  );
}

function KpiCard({ title, value, sub, loading }: { title: string; value: string; sub: string; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs">{title}</CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
          {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function DateField({ label, date, onSelect }: { label: string; date?: Date; onSelect: (d?: Date) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 justify-start font-normal">
          <CalendarIcon className="h-3.5 w-3.5 mr-2" />
          {date ? format(date, "MMM d, yyyy") : <span className="text-muted-foreground">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={onSelect} initialFocus className="p-3 pointer-events-auto" />
      </PopoverContent>
    </Popover>
  );
}
