import { useEffect, useMemo, useState } from "react";
import { differenceInMinutes, parseISO } from "date-fns";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { MonthData, NormalizedTicket } from "./useMonthData";
import { sourceBucketOf } from "./sourceBucket";

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

function computeIntercomStats(tickets: NormalizedTicket[]) {
  // Intercom-origin local rows (manual imports flagged as Intercom source).
  const ic = tickets.filter((t) => sourceBucketOf(t) === "intercom");
  const total = ic.length;
  const resolved = ic.filter((t) => t.status === "resolved").length;
  const open = total - resolved;
  const times = ic
    .filter((t) => t.status === "resolved" && t.resolved_at)
    .map((t) => differenceInMinutes(parseISO(t.resolved_at!), parseISO(t.created_at)))
    .filter((n) => n >= 0);
  return {
    total,
    resolved,
    open,
    medianResolutionMin: median(times),
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
  const intercomLocal = useMemo(() => computeIntercomStats(data.tickets), [data.tickets]);

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

  // Tooltips: explain origin (local DB vs live Intercom API) and which statuses count.
  const T = {
    slack: {
      received: "Local DB · all Slack-originated tickets (route_source = slack), includes any later escalated to Intercom.",
      resolved: "Local DB · Slack-originated tickets where status = 'resolved'.",
      open: "Local DB · Slack-originated tickets where status ≠ 'resolved' (includes new, in_progress, escalated, escalated_pending).",
      escalated: "Local DB · Slack tickets handed off to a human: intercom_conversation_id is set OR status in (escalated, escalated_pending).",
      successRate: "Local DB · resolved / received for Slack-originated tickets.",
      botSuccessRate: "Local DB · Slack tickets resolved without ever reaching Intercom (no intercom_conversation_id) / total Slack received.",
      median: "Local DB · median(resolved_at − created_at) over resolved Slack tickets.",
      avg: "Local DB · mean(resolved_at − created_at) over resolved Slack tickets.",
    },
    gmail: {
      received: "Local DB · Gmail-originated tickets (route_source = gmail), deduped by gmail_thread_id.",
      resolved: "Local DB · Gmail tickets where status = 'resolved' (hourly cron auto-resolves after 24h of inactivity).",
      open: "Local DB · Gmail tickets where status ≠ 'resolved'.",
      successRate: "Local DB · resolved / received for Gmail tickets.",
      median: "Local DB · median(resolved_at − created_at) over resolved Gmail tickets.",
      avg: "Local DB · mean(resolved_at − created_at) over resolved Gmail tickets.",
    },
    intercom: {
      received: "Local DB · Intercom-origin tickets (display_source = intercom and not Slack/Gmail-originated). Excludes Slack-escalated conversations to keep Slack + Gmail + Intercom + Other = Total.",
      resolved: "Local DB · Intercom-origin tickets where status = 'resolved'.",
      open: "Local DB · Intercom-origin tickets where status ≠ 'resolved'.",
      median: "Local DB · median(resolved_at − created_at) over resolved Intercom-origin tickets.",
      firstResponse: "Live Intercom API · median time_to_admin_reply across all conversations in the Intercom enterprise inbox for the month (includes Slack-escalated convos).",
      response: "Live Intercom API · median_time_to_reply across all admin replies in the Intercom enterprise inbox for the month.",
      handling: "Live Intercom API · median time_to_last_close (handling time until conversation closed) across the Intercom enterprise inbox for the month.",
    },
  };

  const rows: { label: string; slack: React.ReactNode; gmail: React.ReactNode; intercom: React.ReactNode; tips: { slack?: string; gmail?: string; intercom?: string } }[] = [
    {
      label: "Received",
      slack: slack.received,
      gmail: gmail.total,
      intercom: intercomLocal.total,
      tips: { slack: T.slack.received, gmail: T.gmail.received, intercom: T.intercom.received },
    },
    {
      label: "Resolved",
      slack: slack.resolved,
      gmail: gmail.resolved,
      intercom: intercomLocal.resolved,
      tips: { slack: T.slack.resolved, gmail: T.gmail.resolved, intercom: T.intercom.resolved },
    },
    {
      label: "Open",
      slack: slack.open,
      gmail: gmail.open,
      intercom: intercomLocal.open,
      tips: { slack: T.slack.open, gmail: T.gmail.open, intercom: T.intercom.open },
    },
    {
      label: "Escalated to human",
      slack: slack.escalated,
      gmail: MUTED,
      intercom: MUTED,
      tips: { slack: T.slack.escalated },
    },
    {
      label: "Success rate",
      slack: `${slack.successPct}%`,
      gmail: gmail.total ? `${Math.round((gmail.resolved / gmail.total) * 100)}%` : MUTED,
      intercom: MUTED,
      tips: { slack: T.slack.successRate, gmail: T.gmail.successRate },
    },
    {
      label: "Bot success rate",
      slack: `${slack.botSuccessPct}%`,
      gmail: MUTED,
      intercom: MUTED,
      tips: { slack: T.slack.botSuccessRate },
    },
    {
      label: "Median first response",
      slack: MUTED,
      gmail: MUTED,
      intercom: intercomCell("medianFirstResponseSec"),
      tips: { intercom: T.intercom.firstResponse },
    },
    {
      label: "Median response time",
      slack: MUTED,
      gmail: MUTED,
      intercom: intercomCell("medianResponseSec"),
      tips: { intercom: T.intercom.response },
    },
    {
      label: "Median resolution / time to close",
      slack: formatMinutes(slack.medianResolutionMin),
      gmail: formatMinutes(gmail.medianResolutionMin),
      intercom: formatMinutes(intercomLocal.medianResolutionMin),
      tips: { slack: T.slack.median, gmail: T.gmail.median, intercom: T.intercom.median },
    },
    {
      label: "Average resolution",
      slack: formatMinutes(slack.avgResolutionMin),
      gmail: formatMinutes(gmail.avgResolutionMin),
      intercom: MUTED,
      tips: { slack: T.slack.avg, gmail: T.gmail.avg },
    },
    {
      label: "Median handling time",
      slack: MUTED,
      gmail: MUTED,
      intercom: intercomCell("medianHandlingTimeSec"),
      tips: { intercom: T.intercom.handling },
    },
  ];

  const Cell = ({ tip, children }: { tip?: string; children: React.ReactNode }) => {
    if (!tip) return <TableCell className="text-right tabular-nums">{children}</TableCell>;
    return (
      <TableCell className="text-right tabular-nums">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help border-b border-dotted border-muted-foreground/40">{children}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">{tip}</TooltipContent>
        </Tooltip>
      </TableCell>
    );
  };

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
                <Cell tip={r.tips.slack}>{r.slack}</Cell>
                <Cell tip={r.tips.gmail}>{r.gmail}</Cell>
                <Cell tip={r.tips.intercom}>{r.intercom}</Cell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {intercomError && (
          <p className="text-xs text-destructive mt-3">Intercom: {intercomError}</p>
        )}
        {intercom && (
          <p className="text-xs text-muted-foreground mt-3">
            Counts from local DB (matches Total). Response &amp; handling times live from Intercom API · {intercom.current.count} conversations this month vs {intercom.previous.count} previous month. Hover any value for its definition.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

