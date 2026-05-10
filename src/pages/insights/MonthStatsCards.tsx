import { useEffect, useMemo, useState } from "react";
import { differenceInMinutes, parseISO } from "date-fns";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  // Bucket by origin (route_source): a Slack-originated ticket counts as Slack
  // even if it was later escalated/mirrored into Intercom.
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

const MUTED = <span className="text-muted-foreground">—</span>;

function DeltaChip({ valueSec, prevSec }: { valueSec: number | null; prevSec: number | null }) {
  if (valueSec == null || prevSec == null) return null;
  const diff = valueSec - prevSec;
  const absLabel = formatSeconds(Math.abs(diff));
  if (Math.abs(diff) === 0 || absLabel === "—") return null;
  const isWorse = diff > 0;
  return (
    <span
      className={`ml-2 inline-flex items-center gap-0.5 text-xs font-medium ${
        isWorse ? "text-destructive" : "text-emerald-600"
      }`}
    >
      {isWorse ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {absLabel}
    </span>
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

  const ic = intercom?.current ?? null;
  const ip = intercom?.previous ?? null;

  const intercomCell = (key: keyof Stat) => {
    if (intercomLoading) return <span className="text-muted-foreground">…</span>;
    if (intercomError) return MUTED;
    if (!ic) return MUTED;
    const v = ic[key];
    if (key === "count") return <>{v as number}</>;
    return (
      <>
        {formatSeconds(v as number | null)}
        <DeltaChip valueSec={v as number | null} prevSec={ip ? (ip[key] as number | null) : null} />
      </>
    );
  };

  const rows: { label: string; slack: React.ReactNode; gmail: React.ReactNode; intercom: React.ReactNode }[] = [
    {
      label: "Received",
      slack: slack.received,
      gmail: gmail.total,
      intercom: intercomCell("count"),
    },
    {
      label: "Resolved",
      slack: slack.resolved,
      gmail: gmail.resolved,
      intercom: MUTED,
    },
    {
      label: "Open",
      slack: slack.open,
      gmail: gmail.open,
      intercom: MUTED,
    },
    {
      label: "Escalated to human",
      slack: slack.escalated,
      gmail: MUTED,
      intercom: MUTED,
    },
    {
      label: "Success rate",
      slack: `${slack.successPct}%`,
      gmail: gmail.total ? `${Math.round((gmail.resolved / gmail.total) * 100)}%` : MUTED,
      intercom: MUTED,
    },
    {
      label: "Bot success rate",
      slack: `${slack.botSuccessPct}%`,
      gmail: MUTED,
      intercom: MUTED,
    },
    {
      label: "Median first response",
      slack: MUTED,
      gmail: MUTED,
      intercom: intercomCell("medianFirstResponseSec"),
    },
    {
      label: "Median response time",
      slack: MUTED,
      gmail: MUTED,
      intercom: intercomCell("medianResponseSec"),
    },
    {
      label: "Median resolution / time to close",
      slack: formatMinutes(slack.medianResolutionMin),
      gmail: formatMinutes(gmail.medianResolutionMin),
      intercom: intercomCell("medianTimeToCloseSec"),
    },
    {
      label: "Average resolution",
      slack: formatMinutes(slack.avgResolutionMin),
      gmail: formatMinutes(gmail.avgResolutionMin),
      intercom: MUTED,
    },
    {
      label: "Median handling time",
      slack: MUTED,
      gmail: MUTED,
      intercom: intercomCell("medianHandlingTimeSec"),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Source performance</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">Metric</TableHead>
              <TableHead className="text-right">Slack</TableHead>
              <TableHead className="text-right">Gmail</TableHead>
              <TableHead className="text-right">Intercom</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{r.slack}</TableCell>
                <TableCell className="text-right tabular-nums">{r.gmail}</TableCell>
                <TableCell className="text-right tabular-nums">{r.intercom}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {intercomError && (
          <p className="text-xs text-destructive mt-3">Intercom: {intercomError}</p>
        )}
        {intercom && (
          <p className="text-xs text-muted-foreground mt-3">
            Intercom live · {intercom.current.count} conversations this month vs {intercom.previous.count} previous month
          </p>
        )}
      </CardContent>
    </Card>
  );
}
