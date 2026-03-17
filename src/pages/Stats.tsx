import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, MessageSquare, ThumbsUp, ThumbsDown, Clock, ExternalLink, TrendingUp, TrendingDown, Activity, CalendarIcon } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell,
  LineChart, Line, AreaChart, Area,
} from "recharts";
import { format, parseISO, subDays, subMonths, startOfDay, endOfDay, isAfter, isBefore, differenceInDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Mapping {
  status: string;
  created_at: string;
  is_test: boolean;
}

type TimeRange = "7d" | "30d" | "90d" | "all" | "custom";

const chartConfig = {
  resolved: { label: "Resolved", color: "hsl(142 76% 36%)" },
  escalated: { label: "Escalated", color: "hsl(var(--destructive))" },
  active: { label: "Active", color: "hsl(var(--primary))" },
  awaiting_context: { label: "Awaiting Context", color: "hsl(var(--muted-foreground))" },
  total: { label: "Total", color: "hsl(var(--primary))" },
  cumulative: { label: "Cumulative", color: "hsl(var(--primary))" },
  rate: { label: "Escalation Rate", color: "hsl(var(--destructive))" },
};

const rangeLabel: Record<TimeRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const getCutoffDate = (range: TimeRange): Date | null => {
  const now = new Date();
  switch (range) {
    case "7d": return subDays(now, 7);
    case "30d": return subDays(now, 30);
    case "90d": return subMonths(now, 3);
    default: return null;
  }
};

const formatDateKey = (date: Date, range: TimeRange): string => {
  if (range === "90d" || range === "all") return format(date, "MMM dd");
  return format(date, "MMM dd");
};

const Stats = () => {
  const [data, setData] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"real" | "test">("real");
  const [range, setRange] = useState<TimeRange>("30d");

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    setLoading(true);
    const { data: mappings } = await supabase
      .from("conversation_mappings")
      .select("status, created_at, is_test")
      .order("created_at", { ascending: true });
    setData((mappings as Mapping[]) || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const cutoff = getCutoffDate(range);
    return data.filter((m) => {
      const matchView = view === "test" ? m.is_test : !m.is_test;
      const matchRange = cutoff ? isAfter(parseISO(m.created_at), cutoff) : true;
      return matchView && matchRange;
    });
  }, [data, view, range]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const resolved = filtered.filter((m) => m.status === "resolved").length;
    const escalated = filtered.filter((m) => m.status === "escalated").length;
    const active = filtered.filter((m) => m.status === "active").length;
    const awaiting = filtered.filter((m) => m.status === "awaiting_context").length;
    const feedbackTotal = resolved + escalated;
    const resolvedPct = feedbackTotal ? Math.round((resolved / feedbackTotal) * 100) : 0;

    // Avg per day
    const cutoff = getCutoffDate(range);
    const daySpan = cutoff
      ? differenceInDays(new Date(), cutoff) || 1
      : filtered.length > 0
        ? differenceInDays(new Date(), parseISO(filtered[0].created_at)) || 1
        : 1;
    const avgPerDay = +(total / daySpan).toFixed(1);

    return { total, resolved, escalated, active, awaiting, resolvedPct, avgPerDay };
  }, [filtered, range]);

  // Daily volume line chart
  const volumeData = useMemo(() => {
    const byDay: Record<string, { date: string; total: number; resolved: number; escalated: number }> = {};
    filtered.forEach((m) => {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      if (!byDay[day]) byDay[day] = { date: day, total: 0, resolved: 0, escalated: 0 };
      byDay[day].total++;
      if (m.status === "resolved") byDay[day].resolved++;
      if (m.status === "escalated") byDay[day].escalated++;
    });
    return Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, label: format(parseISO(d.date), "MMM dd") }));
  }, [filtered]);

  // Cumulative conversations over time
  const cumulativeData = useMemo(() => {
    let cum = 0;
    return volumeData.map((d) => {
      cum += d.total;
      return { label: d.label, cumulative: cum };
    });
  }, [volumeData]);

  // Escalation rate over time (rolling 7-day window)
  const escalationRateData = useMemo(() => {
    if (volumeData.length < 2) return [];
    const windowSize = Math.min(7, volumeData.length);
    const result: { label: string; rate: number }[] = [];
    for (let i = windowSize - 1; i < volumeData.length; i++) {
      let resolved = 0, escalated = 0;
      for (let j = i - windowSize + 1; j <= i; j++) {
        resolved += volumeData[j].resolved;
        escalated += volumeData[j].escalated;
      }
      const total = resolved + escalated;
      result.push({
        label: volumeData[i].label,
        rate: total > 0 ? Math.round((escalated / total) * 100) : 0,
      });
    }
    return result;
  }, [volumeData]);

  // Daily outcomes bar chart
  const dailyOutcomes = useMemo(() => {
    return volumeData
      .filter((d) => d.resolved > 0 || d.escalated > 0)
      .map((d) => ({ date: d.label, resolved: d.resolved, escalated: d.escalated }));
  }, [volumeData]);

  const pieData = useMemo(() => {
    return [
      { name: "Resolved", value: stats.resolved, fill: chartConfig.resolved.color },
      { name: "Escalated", value: stats.escalated, fill: chartConfig.escalated.color },
      { name: "Active", value: stats.active, fill: chartConfig.active.color },
      { name: "Awaiting", value: stats.awaiting, fill: chartConfig.awaiting_context.color },
    ].filter((d) => d.value > 0);
  }, [stats]);

  // Peak day
  const peakDay = useMemo(() => {
    if (volumeData.length === 0) return null;
    return volumeData.reduce((max, d) => (d.total > max.total ? d : max), volumeData[0]);
  }, [volumeData]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        {/* Hero Banner */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            <img src="/lovable-logo.png" alt="Lovable logo" className="h-12 w-12 rounded-lg" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Lovable Support Hub</h1>
              <p className="text-sm text-muted-foreground">Real-time analytics for your Slack ↔ Intercom support pipeline</p>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
              <ExternalLink className="h-3.5 w-3.5" /> Slack App
            </a>
            <a href="https://app.intercom.com" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
              <ExternalLink className="h-3.5 w-3.5" /> Intercom
            </a>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <Tabs value={view} onValueChange={(v) => setView(v as "real" | "test")}>
            <TabsList>
              <TabsTrigger value="real">Production</TabsTrigger>
              <TabsTrigger value="test">Test</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={range} onValueChange={(v) => setRange(v as TimeRange)}>
            <TabsList>
              <TabsTrigger value="7d">7 days</TabsTrigger>
              <TabsTrigger value="30d">30 days</TabsTrigger>
              <TabsTrigger value="90d">90 days</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-5">
              <MessageSquare className="mb-2 h-5 w-5 text-primary" />
              <p className="text-3xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-5">
              <ThumbsUp className="mb-2 h-5 w-5 text-green-600" />
              <p className="text-3xl font-bold text-foreground">{stats.resolved}</p>
              <p className="text-xs text-muted-foreground">Resolved</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-5">
              <ThumbsDown className="mb-2 h-5 w-5 text-destructive" />
              <p className="text-3xl font-bold text-foreground">{stats.escalated}</p>
              <p className="text-xs text-muted-foreground">Escalated</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-5">
              <Clock className="mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-3xl font-bold text-foreground">{stats.resolvedPct}%</p>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-5">
              <Activity className="mb-2 h-5 w-5 text-primary" />
              <p className="text-3xl font-bold text-foreground">{stats.avgPerDay}</p>
              <p className="text-xs text-muted-foreground">Avg / Day</p>
            </CardContent>
          </Card>
        </div>

        {/* Conversation Volume Line Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Conversation Volume</CardTitle>
            <CardDescription>Daily conversations over {rangeLabel[range].toLowerCase()}</CardDescription>
          </CardHeader>
          <CardContent>
            {volumeData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
            ) : (
              <ChartContainer config={chartConfig} className="h-[280px] w-full">
                <AreaChart data={volumeData}>
                  <defs>
                    <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fill="url(#gradTotal)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Two-column charts */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Daily Outcomes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Daily Outcomes</CardTitle>
              <CardDescription>Resolved vs escalated per day</CardDescription>
            </CardHeader>
            <CardContent>
              {dailyOutcomes.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No outcome data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <BarChart data={dailyOutcomes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="resolved" fill={chartConfig.resolved.color} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="escalated" fill={chartConfig.escalated.color} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status Distribution</CardTitle>
              <CardDescription>Current breakdown of all conversations</CardDescription>
            </CardHeader>
            <CardContent>
              {pieData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Second row: Cumulative + Escalation Rate */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Cumulative */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cumulative Conversations</CardTitle>
              <CardDescription>Growth over time</CardDescription>
            </CardHeader>
            <CardContent>
              {cumulativeData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <LineChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Escalation Rate Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                Escalation Rate Trend
                {escalationRateData.length >= 2 && (
                  escalationRateData[escalationRateData.length - 1].rate < escalationRateData[0].rate
                    ? <TrendingDown className="h-4 w-4 text-green-600" />
                    : <TrendingUp className="h-4 w-4 text-destructive" />
                )}
              </CardTitle>
              <CardDescription>7-day rolling escalation % of completed conversations</CardDescription>
            </CardHeader>
            <CardContent>
              {escalationRateData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Not enough data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <LineChart data={escalationRateData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" className="text-xs" />
                    <YAxis unit="%" allowDecimals={false} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="rate" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Insights Footer */}
        {peakDay && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-6 p-5">
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Peak day:</span>
                <span className="font-semibold text-foreground">{peakDay.label}</span>
                <span className="text-muted-foreground">({peakDay.total} conversations)</span>
              </div>
              {stats.active > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">Currently active:</span>
                  <span className="font-semibold text-foreground">{stats.active}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default Stats;
