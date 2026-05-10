import { useEffect, useMemo, useState } from "react";
import { differenceInMinutes, parseISO } from "date-fns";
import {
  MessageSquare, ThumbsUp, AlertCircle, ArrowUpRight, Clock, Bot, Mail,
  Timer, Info, ArrowDown, ArrowUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { MonthData, NormalizedTicket } from "./useMonthData";

function formatMinutes(minutes: number | null): string {
  if (minutes == null || !isFinite(minutes)) return "—";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function formatSeconds(sec: number | null): string {
  if (sec == null) return "—";
  return formatMinutes(sec / 60);
}

function median(nums: number[]): number | null {
  const v = nums.filter((n) => isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

interface Stat {
  count: number;
  medianFirstResponseSec: number | null;
  medianResponseSec: number | null;
  medianTimeToCloseSec: number | null;
  medianHandlingTimeSec: number | null;
}

interface IntercomResponse {
  current: Stat;
  previous: Stat;
}

function computeSlackStats(tickets: NormalizedTicket[]) {
  const slack = tickets.filter((t) => t.route_source === "slack");
  const total = slack.length;
  const resolved = slack.filter((t) => t.status === "resolved").length;
  const escalated = slack.filter(
    (t) =>
      (t.intercom_conversation_id && t.intercom_conversation_id !== "") ||
      t.status === "escalated" ||
      t.status === "escalated_pending",
  ).length;
  const open = total - resolved;
  const successPct = total ? Math.round((resolved / total) * 100) : 0;
  const botResolved = slack.filter(
    (t) => t.status === "resolved" && (!t.intercom_conversation_id || t.intercom_conversation_id === ""),
  ).length;
  const botSuccessPct = total ? Math.round((botResolved / total) * 100) : 0;
  const times = slack
    .filter((t) => t.status === "resolved" && t.resolved_at)
    .map((t) => differenceInMinutes(parseISO(t.resolved_at!), parseISO(t.created_at)))
    .filter((n) => n >= 0);
  return {
    received: total,
    resolved,
    open,
    escalated,
    successPct,
    botSuccessPct,
    medianResolutionMin: median(times),
    avgResolutionMin: avg(times),
  };
}

function computeGmailStats(tickets: NormalizedTicket[]) {
  const gmail = tickets.filter((t) => t.route_source === "gmail");
  const total = gmail.length;
  const resolved = gmail.filter((t) => t.status === "resolved").length;
  const open = total - resolved;
  const times = gmail
    .filter((t) => t.status === "resolved" && t.resolved_at)
    .map((t) => differenceInMinutes(parseISO(t.resolved_at!), parseISO(t.created_at)))
    .filter((n) => n >= 0);
  return {
    total,
    resolved,
    open,
    medianResolutionMin: median(times),
    avgResolutionMin: avg(times),
  };
}

function Kpi({ icon: Icon, value, label, iconColor }: { icon: any; value: React.ReactNode; label: string; iconColor: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-5 flex flex-col items-center justify-center text-center min-h-[140px]">
        <Icon className={`h-6 w-6 mb-2 ${iconColor}`} />
        <p className="text-3xl font-bold leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

function DeltaCard({ label, valueSec, prevSec }: { label: string; valueSec: number | null; prevSec: number | null }) {
  let chip: React.ReactNode = null;
  if (valueSec != null && prevSec != null) {
    const diff = valueSec - prevSec;
    const absLabel = formatSeconds(Math.abs(diff));
    if (Math.abs(diff) > 0 && absLabel !== "—") {
      const isWorse = diff > 0; // for time metrics, more = worse
      chip = (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            isWorse ? "text-destructive" : "text-emerald-600"
          }`}
        >
          {isWorse ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {absLabel}
        </span>
      );
    }
  }
  return (
    <Card className="border-border/60">
      <CardContent className="p-5 min-h-[140px]">
        <div className="flex items-center gap-1.5 text-sm font-medium mb-3">
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold">{formatSeconds(valueSec)}</span>
          {chip}
        </div>
      </CardContent>
    </Card>
  );
}

interface Props {
  data: MonthData;
  month: string;
}

export function MonthStatsCards({ data, month }: Props) {
  const slack = useMemo(() => computeSlackStats(data.tickets), [data.tickets]);
  const gmail = useMemo(() => computeGmailStats(data.tickets), [data.tickets]);

  const [intercom, setIntercom] = useState<IntercomResponse | null>(null);
  const [intercomLoading, setIntercomLoading] = useState(false);
  const [intercomError, setIntercomError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIntercom(null);
    setIntercomError(null);
    setIntercomLoading(true);
    (async () => {
      try {
        const { data: result, error } = await supabase.functions.invoke("intercom-month-stats", {
          body: { month },
        });
        if (cancelled) return;
        if (error) {
          setIntercomError(error.message || "Failed to load Intercom stats");
        } else if (result?.error) {
          setIntercomError(result.error);
        } else {
          setIntercom({ current: result.current, previous: result.previous });
        }
      } catch (e) {
        if (!cancelled) setIntercomError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setIntercomLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  return (
    <div className="space-y-8">
      {/* Slack */}
      <section>
        <h2 className="text-lg font-bold mb-4 pb-2 border-b">Slack</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi icon={MessageSquare} iconColor="text-primary" value={slack.received} label="Received" />
          <Kpi icon={ThumbsUp} iconColor="text-purple-500" value={slack.resolved} label="Resolved" />
          <Kpi icon={AlertCircle} iconColor="text-orange-500" value={slack.open} label="Open" />
          <Kpi icon={ArrowUpRight} iconColor="text-amber-500" value={slack.escalated} label="Escalated to human" />
          <Kpi icon={Clock} iconColor="text-muted-foreground" value={`${slack.successPct}%`} label="Success rate" />
          <Kpi icon={Bot} iconColor="text-primary" value={`${slack.botSuccessPct}%`} label="Bot success rate" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Kpi icon={Timer} iconColor="text-primary" value={formatMinutes(slack.medianResolutionMin)} label="Median resolution time" />
          <Kpi icon={Clock} iconColor="text-muted-foreground" value={formatMinutes(slack.avgResolutionMin)} label="Average resolution time" />
        </div>
      </section>

      {/* Gmail */}
      <section>
        <h2 className="text-lg font-bold mb-4 pb-2 border-b">Gmail</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi icon={Mail} iconColor="text-orange-500" value={gmail.total} label="Email total" />
          <Kpi icon={ThumbsUp} iconColor="text-purple-500" value={gmail.resolved} label="Gmail resolved" />
          <Kpi icon={AlertCircle} iconColor="text-orange-500" value={gmail.open} label="Gmail open" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Kpi icon={Timer} iconColor="text-orange-500" value={formatMinutes(gmail.medianResolutionMin)} label="Gmail median resolution" />
          <Kpi icon={Clock} iconColor="text-muted-foreground" value={formatMinutes(gmail.avgResolutionMin)} label="Gmail avg resolution" />
        </div>
      </section>

      {/* Intercom */}
      <section>
        <h2 className="text-lg font-bold mb-4 pb-2 border-b">Intercom</h2>
        {intercomLoading && (
          <p className="text-sm text-muted-foreground">Loading Intercom stats…</p>
        )}
        {intercomError && (
          <p className="text-sm text-destructive">Failed to load Intercom stats: {intercomError}</p>
        )}
        {intercom && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <DeltaCard label="Median first response time" valueSec={intercom.current.medianFirstResponseSec} prevSec={intercom.previous.medianFirstResponseSec} />
            <DeltaCard label="Median response time" valueSec={intercom.current.medianResponseSec} prevSec={intercom.previous.medianResponseSec} />
            <DeltaCard label="Median time to close" valueSec={intercom.current.medianTimeToCloseSec} prevSec={intercom.previous.medianTimeToCloseSec} />
            <DeltaCard label="Median handling time" valueSec={intercom.current.medianHandlingTimeSec} prevSec={intercom.previous.medianHandlingTimeSec} />
          </div>
        )}
        {intercom && (
          <p className="text-xs text-muted-foreground mt-2">
            Live from Intercom · {intercom.current.count} conversations this month vs {intercom.previous.count} previous month
          </p>
        )}
      </section>
    </div>
  );
}
