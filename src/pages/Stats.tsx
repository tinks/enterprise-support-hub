import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, MessageSquare, ThumbsUp, ThumbsDown, Clock, ExternalLink } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";

interface Mapping {
  status: string;
  created_at: string;
  is_test: boolean;
}

const COLORS = {
  resolved: "hsl(var(--primary))",
  escalated: "hsl(var(--destructive))",
  active: "hsl(var(--accent-foreground))",
  awaiting_context: "hsl(var(--muted-foreground))",
};

const chartConfig = {
  resolved: { label: "Resolved", color: "hsl(142 76% 36%)" },
  escalated: { label: "Escalated", color: "hsl(var(--destructive))" },
  active: { label: "Active", color: "hsl(var(--primary))" },
  awaiting_context: { label: "Awaiting Context", color: "hsl(var(--muted-foreground))" },
};

const Stats = () => {
  const [data, setData] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"real" | "test">("real");

  useEffect(() => {
    loadStats();
  }, []);

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
    return data.filter((m) => (view === "test" ? m.is_test : !m.is_test));
  }, [data, view]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const resolved = filtered.filter((m) => m.status === "resolved").length;
    const escalated = filtered.filter((m) => m.status === "escalated").length;
    const active = filtered.filter((m) => m.status === "active").length;
    const awaiting = filtered.filter((m) => m.status === "awaiting_context").length;
    const feedbackTotal = resolved + escalated;
    const resolvedPct = feedbackTotal ? Math.round((resolved / feedbackTotal) * 100) : 0;
    return { total, resolved, escalated, active, awaiting, resolvedPct };
  }, [filtered]);

  const dailyData = useMemo(() => {
    const byDay: Record<string, { date: string; resolved: number; escalated: number }> = {};
    filtered.forEach((m) => {
      if (m.status !== "resolved" && m.status !== "escalated") return;
      const day = format(parseISO(m.created_at), "MMM dd");
      if (!byDay[day]) byDay[day] = { date: day, resolved: 0, escalated: 0 };
      byDay[day][m.status as "resolved" | "escalated"]++;
    });
    return Object.values(byDay);
  }, [filtered]);

  const pieData = useMemo(() => {
    return [
      { name: "Resolved", value: stats.resolved, fill: chartConfig.resolved.color },
      { name: "Escalated", value: stats.escalated, fill: chartConfig.escalated.color },
      { name: "Active", value: stats.active, fill: chartConfig.active.color },
      { name: "Awaiting", value: stats.awaiting, fill: chartConfig.awaiting_context.color },
    ].filter((d) => d.value > 0);
  }, [stats]);

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
      <div className="mx-auto max-w-4xl space-y-6 p-6">
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
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Slack App
            </a>
            <a
              href="https://app.intercom.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Intercom
            </a>
          </div>
        </div>
        {/* View Toggle */}
        <Tabs value={view} onValueChange={(v) => setView(v as "real" | "test")} className="w-full">
          <TabsList>
            <TabsTrigger value="real">Production</TabsTrigger>
            <TabsTrigger value="test">Test</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-6">
              <MessageSquare className="mb-2 h-6 w-6 text-primary" />
              <p className="text-3xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Messages</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-6">
              <ThumbsUp className="mb-2 h-6 w-6 text-green-600" />
              <p className="text-3xl font-bold text-foreground">{stats.resolved}</p>
              <p className="text-xs text-muted-foreground">Resolved</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-6">
              <ThumbsDown className="mb-2 h-6 w-6 text-destructive" />
              <p className="text-3xl font-bold text-foreground">{stats.escalated}</p>
              <p className="text-xs text-muted-foreground">Escalated</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center justify-center p-6">
              <Clock className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-3xl font-bold text-foreground">{stats.resolvedPct}%</p>
              <p className="text-xs text-muted-foreground">Success Rate</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Daily Outcomes</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No outcome data yet</p>
              ) : (
                <ChartContainer config={chartConfig} className="h-[250px] w-full">
                  <BarChart data={dailyData}>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status Distribution</CardTitle>
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
      </div>
    </AppLayout>
  );
};

export default Stats;
