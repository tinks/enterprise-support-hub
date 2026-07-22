import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Gauge, ArrowUpDown, ExternalLink, PlayCircle } from "lucide-react";
import { format } from "date-fns";
import {
  aggregate,
  computeTicketSla,
  computeSla,
  detectOrigin,
  formatDuration,
  formatBusinessDuration,

  parseSeverity,
  evaluateCompliance,
  SLA_TARGETS,
  type TicketSla,
  type SlaResult,
  type TimelinePart,
  type Actor,
  type Origin,
  type Severity,
  type SlaCompliance,
} from "@/lib/slaMetrics";
import {
  useSlaBatch,
  classifySlaBatchRow as classifyRow,
  type SlaBatchRow as Row,
  type SlaBatchEnriched as CorrectedEnriched,
} from "@/hooks/useSlaBatch";




// ============================================================================
// Tab 2 (legacy stored batch) — types
// ============================================================================
type Enriched = Row & { sla: TicketSla };
type SortKey = "closed" | "firstReply" | "rawResolve" | "responseGap" | "bhHandling" | "parts";
type CorrectedSortKey = "closed" | "humanBH" | "humanCal" | "anyCal" | "ttrBH";


// ============================================================================
// Tab 1 (live analyze) — types
// ============================================================================
type LiveResult =
  | { id: string; ok: true; conversation: any }
  | { id: string; ok: false; status?: number; error?: string };

type LiveResponse = {
  ok?: boolean;
  truncated?: boolean;
  results?: LiveResult[];
  error?: string;
};

function parseIds(input: string): string[] {
  const raw = input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const tok of raw) {
    // Extract last path segment for URLs, strip "conversation_" prefix
    let s = tok;
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop() ?? s;
    s = s.replace(/^conversation_/, "");
    s = s.replace(/[^0-9]/g, "");
    if (s.length >= 5) out.push(s);
  }
  return Array.from(new Set(out));
}

// ============================================================================
// Page
// ============================================================================
export default function SlaTest() {
  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Gauge className="h-3.5 w-3.5" /> Prototype · SLA validation
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">SLA test</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live SLA validation tool. Paste Intercom conversation IDs to fetch & spot-check our computed metrics
            against Intercom's own statistics, or browse the stored batch of finalized tickets.
            Business hours = Europe/Berlin, Mon–Fri 09:00–24:00.
          </p>
        </div>

        <Tabs defaultValue="live" className="w-full">
          <TabsList>
            <TabsTrigger value="live">Analyze by ID (live)</TabsTrigger>
            <TabsTrigger value="batch">Batch (stored)</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="mt-4">
            <LiveAnalyzeTab />
          </TabsContent>

          <TabsContent value="batch" className="mt-4">
            <BatchStoredTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// ============================================================================
// TAB 1 · Live analyze
// ============================================================================
function LiveAnalyzeTab() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LiveResult[]>([]);
  const [truncated, setTruncated] = useState(false);

  const parsed = useMemo(() => parseIds(input), [input]);
  const canRun = !loading && parsed.length > 0;

  const onAnalyze = async () => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setTruncated(false);
    try {
      const { data, error: err } = await supabase.functions.invoke("sla-ticket-analyze", {
        body: { ids: parsed.slice(0, 10) },
      });
      if (err) throw err;
      const resp = (data ?? {}) as LiveResponse;
      if (resp.error) throw new Error(resp.error);
      setResults(resp.results ?? []);
      setTruncated(!!resp.truncated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fetch & analyze</CardTitle>
          <CardDescription>
            Paste up to 10 Intercom conversation IDs (comma, space, or newline separated). URLs and
            {" "}<code className="text-[11px]">conversation_</code> prefixes are OK.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="215475084592550, 215475084592551 …"
            rows={3}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <Button onClick={onAnalyze} disabled={!canRun} size="sm">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              Analyze
            </Button>
            <span className="text-xs text-muted-foreground">
              {parsed.length} valid id{parsed.length === 1 ? "" : "s"} parsed
              {parsed.length > 10 && <> · will send first 10</>}
            </span>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          {truncated && (
            <div className="text-xs text-muted-foreground">Server truncated the batch — showing first 10.</div>
          )}
        </CardContent>
      </Card>

      {results.map((r) => {
        if (r.ok === true) {
          return <TicketCard key={r.id} id={r.id} conversation={r.conversation} />;
        }
        const failed = r as { id: string; ok: false; status?: number; error?: string };
        return (
          <Card key={failed.id}>
            <CardContent className="p-4 text-sm">
              <div className="font-medium text-destructive">Failed · {failed.id}</div>
              <div className="text-muted-foreground text-xs mt-1">
                status={failed.status ?? "—"} · {failed.error ?? "unknown error"}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TicketCard({ id, conversation }: { id: string; conversation: any }) {
  const sla: SlaResult = useMemo(() => computeSla(conversation), [conversation]);
  const origin: Origin = useMemo(() => detectOrigin(conversation), [conversation]);
  const src = conversation?.source ?? {};
  const subject: string = src.subject || conversation?.title || `Intercom #${id}`;
  const contactName: string | null = src?.author?.name ?? null;
  const contactEmail: string | null = src?.author?.email ?? null;
  const state: string | null = conversation?.state ?? null;
  const stats = conversation?.statistics ?? {};

  const inboxUrl: string =
    conversation?.ticket?.url ||
    `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate" title={subject}>{subject}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap gap-x-3 gap-y-1 items-center">
              <span className="truncate">
                {contactName || contactEmail || "—"}
                {contactName && contactEmail && (
                  <span className="text-muted-foreground/70"> · {contactEmail}</span>
                )}
              </span>
              {state && <span className="text-xs">state: <span className="font-mono">{state}</span></span>}
              <span className="text-xs text-muted-foreground">#{id}</span>
            </CardDescription>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <OriginBadge origin={origin} />
              {sla.flags.isTicket && <Badge variant="secondary">isTicket</Badge>}
              {sla.flags.samParticipated && <Badge variant="secondary">samParticipated</Badge>}
              {sla.flags.noHumanReply && <Badge variant="outline">noHumanReply</Badge>}
              {sla.flags.noCustomerParticipant && <Badge variant="destructive">no customer</Badge>}
              {!sla.flags.hasParts && <Badge variant="outline">no parts</Badge>}
            </div>
          </div>
          <a
            href={inboxUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open in Intercom
          </a>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {sla.flags.noCustomerParticipant && (
          <div className="rounded-md border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm">
            <div className="font-semibold text-amber-700 dark:text-amber-300">
              ⚠ No customer in this thread — internal / CSM-in-the-middle
            </div>
            <div className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">
              First-response times below are NOT customer-facing. This thread will be pooled separately.
            </div>
          </div>
        )}
        <HeadlineCompare sla={sla} stats={stats} slaApplied={conversation?.sla_applied} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TimelineView timeline={sla.timeline} />
          <MetricsCompare sla={sla} stats={stats} />
        </div>
      </CardContent>
    </Card>
  );
}

const ORIGIN_STYLES: Record<Origin, { label: string; className: string }> = {
  slack: { label: "Slack",  className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  email: { label: "Email",  className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  other: { label: "Other",  className: "bg-muted text-muted-foreground border-border" },
};

function OriginBadge({ origin }: { origin: Origin }) {
  const s = ORIGIN_STYLES[origin];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${s.className}`}>
      {s.label}
    </span>
  );
}

// Headline "ours vs Intercom" strip — the demo money-shot. Presents ours and
// theirs side-by-side with a Δ. Deliberately neutral — no "SLA met" claims,
// since we have no target of our own yet. The hero is the human first reply
// shown as BOTH calendar and business-hours (BH is the SLA-anchor number).
function HeadlineCompare({
  sla, stats, slaApplied,
}: { sla: SlaResult; stats: any; slaApplied: any }) {
  const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ourHuman = sla.firstHumanReplyFromOpenS;
  const ourHumanBH = sla.firstHumanReplyFromOpenBusinessHoursS;
  const ourAny = sla.firstResponseAnyAgentS;
  const theirs = num(stats?.time_to_admin_reply);
  const noCustomer = sla.flags.noCustomerParticipant;
  const slaStatus: string | null =
    slaApplied && typeof slaApplied === "object" && typeof slaApplied.sla_status === "string"
      ? slaApplied.sla_status
      : null;

  // Divergence flag: ≥1h apart, or exactly one side is null.
  const oneSideNull = (ourHuman == null) !== (theirs == null);
  const bothPresent = ourHuman != null && theirs != null;
  const diverges = oneSideNull || (bothPresent && Math.abs((ourHuman as number) - (theirs as number)) >= 3600);

  const delta = bothPresent ? (ourHuman as number) - (theirs as number) : null;
  const deltaLabel =
    delta == null
      ? "—"
      : `${delta >= 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}`;

  const slaBadgeClass =
    slaStatus === "missed"
      ? "bg-destructive/15 text-destructive border-destructive/40"
      : slaStatus === "hit"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
      : "bg-muted text-muted-foreground border-border";

  return (
    <div className={`rounded-md border ${diverges ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-muted/20"} p-3`}>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          First response · ours vs Intercom
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wide ${slaBadgeClass}`}>
          Intercom SLA: {slaStatus ?? "no SLA"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeroHumanStat calendar={ourHuman} businessHours={ourHumanBH} noCustomer={noCustomer} />
        <HeadlineStat label="Our first reply" hint="any agent, incl. Sam" value={formatDuration(ourAny)} />
        <HeadlineStat label="Intercom time_to_admin_reply" hint="their single stat" value={formatDuration(theirs)} />
        <HeadlineStat label="Δ (ours − Intercom)" hint="human vs admin_reply, calendar" value={deltaLabel} />
      </div>
    </div>
  );
}

function HeadlineStat({ label, hint, value, emphasize }: { label: string; hint?: string; value: string; emphasize?: boolean }) {
  return (
    <div className={`rounded-md border border-border/60 bg-background px-3 py-2 ${emphasize ? "ring-1 ring-primary/30" : ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground/70">{hint}</div>}
      <div className={`mt-1 tabular-nums ${emphasize ? "text-lg font-bold" : "text-base font-semibold"}`}>{value}</div>
    </div>
  );
}

// Hero stat: Our first HUMAN reply shown as BOTH calendar and business-hours.
// Business-hours is the SLA-anchor number so it's emphasized.
function HeroHumanStat({ calendar, businessHours, noCustomer }: { calendar: number | null; businessHours: number | null; noCustomer?: boolean }) {
  return (
    <div className={`rounded-md border border-border/60 bg-background px-3 py-2 ring-1 ${noCustomer ? "ring-amber-500/40 opacity-60" : "ring-primary/30"}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Our first HUMAN reply {noCustomer && <span className="text-amber-600 dark:text-amber-400">(internal)</span>}
      </div>
      <div className="text-[10px] text-muted-foreground/70">
        {noCustomer ? "n/a — no customer in thread" : "from open"}
      </div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <div className="tabular-nums text-lg font-bold" title="business hours (Europe/Berlin, Mon–Fri 09:00–24:00)">
          {formatDuration(businessHours)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">bus.hrs</div>
        <span className="text-muted-foreground/40">·</span>
        <div className="tabular-nums text-sm font-semibold text-muted-foreground">
          {formatDuration(calendar)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">cal.</div>
      </div>
    </div>
  );
}



// ----- Actor color chip -----
const ACTOR_STYLES: Record<Actor, { label: string; className: string }> = {
  customer:     { label: "customer",     className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  human_admin:  { label: "human admin",  className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  sam_ai:       { label: "Sam · AI",     className: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/40" },
  operator_bot: { label: "operator bot", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  system:       { label: "system",       className: "bg-muted text-muted-foreground border-border" },
};

function ActorChip({ actor }: { actor: Actor }) {
  const s = ACTOR_STYLES[actor];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide ${s.className}`}>
      {s.label}
    </span>
  );
}

function eventTag(p: TimelinePart): string {
  if (p.partType === "source") return "opening msg";
  if (p.isNote) return "note";
  if (p.isPublicReply) return "reply";
  return p.partType || "event";
}


function TimelineView({ timeline }: { timeline: TimelinePart[] }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Timeline</div>
      <div className="border border-border rounded-md divide-y divide-border">
        {timeline.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">No timeline parts.</div>
        )}
        {timeline.map((p, i) => {
          const isNote = p.isNote;
          return (
            <div
              key={i}
              className={`p-2.5 text-xs flex flex-col gap-1 ${isNote ? "bg-muted/30 opacity-80" : ""}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="tabular-nums text-muted-foreground">
                  {format(new Date(p.ts * 1000), "MMM d, HH:mm:ss")}
                </span>
                <ActorChip actor={p.actor} />
                <span className="font-medium truncate max-w-[180px]" title={p.authorName ?? ""}>
                  {p.authorName || "—"}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-0.5">
                  {eventTag(p)}
                </span>
                {p.assignedToType && (
                  <span className="text-[10px] text-muted-foreground">
                    → {p.assignedToType}:{p.assignedToId ?? "?"}
                  </span>
                )}
              </div>
              {p.body && (
                <div className={`text-xs leading-snug line-clamp-2 ${isNote ? "text-muted-foreground italic" : "text-foreground/80"}`}>
                  {p.body}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricRow({ label, value, hint, emphasize }: { label: string; value: string; hint?: string; emphasize?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 border-b border-border/60 last:border-0 ${emphasize ? "bg-primary/5 -mx-2 px-2 rounded" : ""}`}>
      <div className="min-w-0">
        <div className={`text-xs ${emphasize ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}
      </div>
      <div className={`text-sm tabular-nums ${emphasize ? "font-bold" : "font-semibold"}`}>{value}</div>
    </div>
  );
}

function MetricsCompare({ sla, stats }: { sla: SlaResult; stats: any }) {
  const teamFrt: Array<{ team_name?: string; response_time?: number | null }> =
    Array.isArray(stats?.assigned_team_first_response_time) ? stats.assigned_team_first_response_time : [];
  const teamFrtBH: Array<{ team_name?: string; response_time?: number | null }> =
    Array.isArray(stats?.assigned_team_first_response_time_in_office_hours)
      ? stats.assigned_team_first_response_time_in_office_hours
      : [];

  const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Our metrics</div>
        <div className="border border-border rounded-md px-3 py-1">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 py-1 border-b border-border/60">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">Metric</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80 text-right">Calendar</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80 text-right">Business hrs</div>
          </div>
          <DualMetricRow
            label="First response (any agent)"
            calendar={sla.firstResponseAnyAgentS}
            businessHours={sla.firstResponseAnyAgentBusinessHoursS}
          />
          <DualMetricRow
            label="Time to escalation"
            hint={sla.escalationBasis ? `basis: ${sla.escalationBasis}` : undefined}
            calendar={sla.timeToEscalationS}
            businessHours={sla.timeToEscalationBusinessHoursS}
          />
          <DualMetricRow
            label="Human first reply (from escalation)"
            calendar={sla.firstHumanReplyFromEscalationS}
            businessHours={sla.firstHumanReplyFromEscalationBusinessHoursS}
            emphasize
          />
          <DualMetricRow
            label="Human first reply (from open)"
            calendar={sla.firstHumanReplyFromOpenS}
            businessHours={sla.firstHumanReplyFromOpenBusinessHoursS}
          />
          <DualMetricRow
            label="TTR"
            calendar={sla.ttrS}
            businessHours={sla.ttrBusinessHoursS}
          />
          <DualMetricRow
            label="Handling time"
            calendar={sla.handlingTimeS}
            businessHours={sla.handlingTimeBusinessHoursS}
          />
          <MetricRow label="Reopens" value={String(sla.reopenCount)} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Intercom's stats</div>
        <div className="border border-border rounded-md px-3 py-1">
          <MetricRow label="time_to_admin_reply" value={formatDuration(num(stats?.time_to_admin_reply))} />
          <MetricRow label="time_to_first_close" value={formatDuration(num(stats?.time_to_first_close))} />
          <MetricRow label="time_to_last_close" value={formatDuration(num(stats?.time_to_last_close))} />
          <MetricRow label="median_time_to_reply" value={formatDuration(num(stats?.median_time_to_reply))} />
          <MetricRow label="count_reopens" value={String(stats?.count_reopens ?? 0)} />
          {teamFrt.length === 0 ? (
            <MetricRow label="assigned_team_first_response_time" value="—" />
          ) : (
            teamFrt.map((t, i) => (
              <MetricRow
                key={`frt-${i}`}
                label={`team FRT · ${t.team_name ?? "?"}`}
                value={formatDuration(num(t.response_time))}
              />
            ))
          )}
          {teamFrtBH.length === 0 ? (
            <MetricRow label="assigned_team_first_response_time_in_office_hours" value="—" />
          ) : (
            teamFrtBH.map((t, i) => (
              <MetricRow
                key={`frtbh-${i}`}
                label={`team FRT (office hrs) · ${t.team_name ?? "?"}`}
                value={formatDuration(num(t.response_time))}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DualMetricRow({
  label, hint, calendar, businessHours, emphasize,
}: {
  label: string;
  hint?: string;
  calendar: number | null;
  businessHours: number | null;
  emphasize?: boolean;
}) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto] gap-x-4 items-baseline py-1.5 border-b border-border/60 last:border-0 ${emphasize ? "bg-primary/5 -mx-2 px-2 rounded" : ""}`}>
      <div className="min-w-0">
        <div className={`text-xs ${emphasize ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}
      </div>
      <div className={`text-sm tabular-nums text-right ${emphasize ? "font-bold" : "font-semibold"} text-muted-foreground`}>
        {formatDuration(calendar)}
      </div>
      <div className={`text-sm tabular-nums text-right ${emphasize ? "font-bold" : "font-semibold"}`}>
        {formatDuration(businessHours)}
      </div>
    </div>
  );
}

// ============================================================================
// TAB 2 · Batch (stored)
// ============================================================================
type BatchMode = "corrected" | "legacy";

function BatchStoredTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<BatchMode>("corrected");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const PAGE = 500;
        const all: Row[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_conversation_id,subject,contact_name,contact_email,intercom_created_at,intercom_closed_at,time_to_resolve_s,time_to_first_admin_reply_s,raw_payload,tags,rsa_override,customer_resolution_method,owner")
            .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
            .order("intercom_closed_at", { ascending: false })
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
  }, [refreshKey]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/30">
          <button
            className={`px-3 py-1.5 text-xs font-medium rounded ${mode === "corrected" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setMode("corrected")}
          >
            Corrected engine
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium rounded ${mode === "legacy" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setMode("legacy")}
          >
            Legacy (compare)
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && (
        <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
      )}

      {mode === "corrected"
        ? <CorrectedBatch rows={rows} loading={loading} />
        : <LegacyBatch rows={rows} loading={loading} />}
    </div>
  );
}

// ----- Corrected engine view -----
function classifyRow(row: Row, sla: SlaResult): "inScope" | "excluded" | "noCustomer" | "manuallyLogged" {
  // Manually-logged bulk-import threads have no real reply timestamps —
  // unmeasurable for SLA. Check BEFORE the other buckets.
  if (sla.flags.manuallyLogged) return "manuallyLogged";
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const hasTag = (t: string) => tags.includes(t);
  const excluded =
    row.rsa_override === false ||
    (row.rsa_override == null && (hasTag("enterprise-fyi") || hasTag("enterprise-duplicate"))) ||
    hasTag("merged_ticket") ||
    row.customer_resolution_method === "not_enterprise";
  if (excluded) return "excluded";
  if (sla.flags.noCustomerParticipant) return "noCustomer";
  return "inScope";
}

function CorrectedBatch({ rows, loading }: { rows: Row[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<CorrectedSortKey>("closed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const enriched: CorrectedEnriched[] = useMemo(
    () => rows.map((r) => {
      const sla = computeSla(r.raw_payload);
      const origin = detectOrigin(r.raw_payload);
      const bucket = classifyRow(r, sla);
      return { ...r, sla, origin, bucket };
    }),
    [rows],
  );

  const inScope = useMemo(() => enriched.filter((r) => r.bucket === "inScope"), [enriched]);
  const excluded = useMemo(() => enriched.filter((r) => r.bucket === "excluded"), [enriched]);
  const noCustomer = useMemo(() => enriched.filter((r) => r.bucket === "noCustomer"), [enriched]);
  const manuallyLogged = useMemo(() => enriched.filter((r) => r.bucket === "manuallyLogged"), [enriched]);

  const kpis = useMemo(() => ({
    humanBH: aggregate(inScope.map((r) => r.sla.firstHumanReplyFromInboxBusinessHoursS)),
    humanCal: aggregate(inScope.map((r) => r.sla.firstHumanReplyFromInboxS)),
    anyCal: aggregate(inScope.map((r) => r.sla.firstResponseAnyAgentS)),
    ttrBH: aggregate(inScope.map((r) => r.sla.ttrBusinessHoursS)),
    preInbox: aggregate(inScope.map((r) => r.sla.preInboxTimeS)),
  }), [inScope]);

  const reopenRate = useMemo(() => {
    if (!inScope.length) return null;
    const n = inScope.filter((r) => r.sla.reopenCount > 0).length;
    return { n, total: inScope.length, pct: (n / inScope.length) * 100 };
  }, [inScope]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: CorrectedEnriched): number => {
      switch (sortKey) {
        case "closed": return r.intercom_closed_at ? new Date(r.intercom_closed_at).getTime() : 0;
        case "humanBH": return r.sla.firstHumanReplyFromOpenBusinessHoursS ?? -1;
        case "humanCal": return r.sla.firstHumanReplyFromOpenS ?? -1;
        case "anyCal": return r.sla.firstResponseAnyAgentS ?? -1;
        case "ttrBH": return r.sla.ttrBusinessHoursS ?? -1;
      }
    };
    return [...inScope].sort((a, b) => (val(a) - val(b)) * dir);
  }, [inScope, sortKey, sortDir]);

  const toggleSort = (k: CorrectedSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">In-scope: {inScope.length}</span>
        {" · "}
        Excluded (not-enterprise/dup/merged/RSA): <span className="font-medium">{excluded.length}</span>
        {" · "}
        Internal / no-customer: <span className="font-medium">{noCustomer.length}</span>
        {" · "}
        Manually-logged (excluded): <span className="font-medium">{manuallyLogged.length}</span>
        {" · "}
        Total loaded: {enriched.length}
      </div>

      <ComplianceSection inScope={inScope} manuallyLoggedCount={manuallyLogged.length} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        <KpiCard
          title="Human first reply · bus.hrs"
          desc="firstHumanReplyFromInbox (from Enterprise Inbox assignment, Europe/Berlin business hours)"
          agg={kpis.humanBH}
          emphasize
        />
        <KpiCard
          title="Human first reply · calendar"
          desc="firstHumanReplyFromInbox (from Enterprise Inbox assignment, wall clock)"
          agg={kpis.humanCal}
        />
        <KpiCard
          title="First response any-agent · calendar"
          desc="firstResponseAnyAgent (includes Sam AI)"
          agg={kpis.anyCal}
        />
        <KpiCard
          title="Time to resolve · bus.hrs"
          desc="ttr (Europe/Berlin business hours)"
          agg={kpis.ttrBH}
        />
        <KpiCard
          title="Pre-inbox time (pre-Enterprise / work-before-ticket)"
          desc="time from ticket creation to Enterprise Inbox assignment — a process signal, not an SLA"
          agg={kpis.preInbox}
        />
      </div>

      {reopenRate && (
        <div className="text-xs text-muted-foreground">
          Reopen rate (in-scope): <span className="font-semibold text-foreground tabular-nums">{reopenRate.pct.toFixed(1)}%</span>
          {" "}({reopenRate.n}/{reopenRate.total})
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Per-ticket (in-scope)
            {loading && <Loader2 className="h-4 w-4 inline ml-2 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>{inScope.length} in-scope tickets · computed with corrected engine over stored raw_payload</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <CorrectedSortableTh label="Closed" k="closed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-left px-3 py-2 font-medium">Subject</th>
                  <th className="text-left px-3 py-2 font-medium">Origin</th>
                  <CorrectedSortableTh label="Human FRT · BH" k="humanBH" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <CorrectedSortableTh label="Human FRT · cal" k="humanCal" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <CorrectedSortableTh label="TTR · BH" k="ttrBH" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {r.intercom_closed_at ? format(new Date(r.intercom_closed_at), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[320px] truncate">
                      <a
                        href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${r.intercom_conversation_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground hover:underline"
                        title={r.subject ?? ""}
                      >
                        {r.subject || `Intercom #${r.intercom_conversation_id}`}
                      </a>
                    </td>
                    <td className="px-3 py-2"><OriginBadge origin={r.origin} /></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatDuration(r.sla.firstHumanReplyFromOpenBusinessHoursS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(r.sla.firstHumanReplyFromOpenS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.ttrBusinessHoursS)}</td>
                  </tr>
                ))}
                {!loading && !sorted.length && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No in-scope tickets found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {(excluded.length > 0 || noCustomer.length > 0 || manuallyLogged.length > 0) && (
            <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border bg-muted/20">
              {excluded.length} excluded (not-enterprise / duplicate / merged / RSA off), {noCustomer.length} internal / no-customer, {manuallyLogged.length} manually-logged bulk-import — not shown in aggregates above.
            </div>
          )}
        </CardContent>
      </Card>



      <p className="text-xs text-muted-foreground leading-relaxed">
        Corrected engine over stored payloads (finalized tickets). Business hours = Europe/Berlin, Mon–Fri 09:00–24:00.
        Escalation-based metrics omitted (still being tuned). The live "Analyze by ID" tab is authoritative per-ticket;
        stored Slack payload completeness is not yet verified.
      </p>

    </div>
  );
}

function CorrectedSortableTh({
  label, k, sortKey, sortDir, onSort, align,
}: {
  label: string; k: CorrectedSortKey; sortKey: CorrectedSortKey; sortDir: "asc" | "desc";
  onSort: (k: CorrectedSortKey) => void; align?: "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : ""}`}
        onClick={() => onSort(k)}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

// ----- Legacy view (unchanged behavior) -----
function LegacyBatch({ rows, loading }: { rows: Row[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("closed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const enriched: Enriched[] = useMemo(
    () => rows.map((r) => ({ ...r, sla: computeTicketSla(r) })),
    [rows],
  );

  const kpis = useMemo(() => ({
    firstReply: aggregate(enriched.map((r) => r.sla.firstAdminReplyS ?? 0)),
    rawResolve: aggregate(enriched.map((r) => r.sla.rawResolveS ?? 0)),
    responseGap: aggregate(enriched.map((r) => r.sla.responseGapSumS)),
    bhHandling: aggregate(enriched.map((r) => r.sla.businessHoursHandlingS)),
  }), [enriched]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: Enriched): number => {
      switch (sortKey) {
        case "closed": return r.intercom_closed_at ? new Date(r.intercom_closed_at).getTime() : 0;
        case "firstReply": return r.sla.firstAdminReplyS ?? -1;
        case "rawResolve": return r.sla.rawResolveS ?? -1;
        case "responseGap": return r.sla.responseGapSumS;
        case "bhHandling": return r.sla.businessHoursHandlingS;
        case "parts": return r.sla.partsCount;
      }
    };
    return [...enriched].sort((a, b) => (val(a) - val(b)) * dir);
  }, [enriched, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground italic">
        Legacy metric (Intercom time_to_admin_reply — Sam-inclusive, misses mirrored Slack replies, calendar). Shown for comparison.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Time to first admin reply" desc="Intercom time_to_admin_reply" agg={kpis.firstReply} />
        <KpiCard title="Raw time to resolve" desc="Intercom time_to_last_close (wall clock)" agg={kpis.rawResolve} />
        <KpiCard title="Response-gap sum" desc="Σ user→admin reply gaps" agg={kpis.responseGap} />
        <KpiCard title="Business-hours handling" desc="Response-gap sum, clipped to Mon–Fri 09:00–24:00 Europe/Berlin" agg={kpis.bhHandling} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Per-ticket breakdown
            {loading && <Loader2 className="h-4 w-4 inline ml-2 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>{enriched.length} finalized tickets for Matt</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <SortableTh label="Closed" k="closed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-left px-3 py-2 font-medium">Subject</th>
                  <th className="text-left px-3 py-2 font-medium">Contact</th>
                  <SortableTh label="First reply" k="firstReply" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Raw resolve" k="rawResolve" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Response-gap" k="responseGap" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Business-hrs" k="bhHandling" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Parts" k="parts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {r.intercom_closed_at ? format(new Date(r.intercom_closed_at), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-3 py-2 max-w-[320px] truncate">
                      <a
                        href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${r.intercom_conversation_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground hover:underline"
                        title={r.subject ?? ""}
                      >
                        {r.subject || `Intercom #${r.intercom_conversation_id}`}
                      </a>
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground" title={r.contact_email ?? ""}>
                      {r.contact_name || r.contact_email || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.firstAdminReplyS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.rawResolveS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.responseGapSumS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatDuration(r.sla.businessHoursHandlingS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.sla.partsCount}</td>
                  </tr>
                ))}
                {!loading && !sorted.length && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No tickets found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ title, desc, agg, emphasize }: {
  title: string;
  desc: string;
  agg: { avg: number | null; median: number | null; p90: number | null; p95?: number | null; n: number };
  emphasize?: boolean;
}) {
  return (
    <Card className={emphasize ? "ring-1 ring-primary/40" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        <Stat label="Median" value={formatDuration(agg.median)} emphasize={emphasize} />
        <Stat label="P90" value={formatDuration(agg.p90)} />
        {agg.p95 !== undefined && <Stat label="P95" value={formatDuration(agg.p95)} />}
        <Stat label="Avg" value={formatDuration(agg.avg)} />
        <div className="text-[10px] text-muted-foreground pt-1">n={agg.n}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${emphasize ? "text-base font-bold" : "text-sm font-semibold"}`}>{value}</span>
    </div>
  );
}

function SortableTh({
  label, k, sortKey, sortDir, onSort, align,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; align?: "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : ""}`}
        onClick={() => onSort(k)}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

// ============================================================================
// Compliance vs proposed SLA targets — batch, corrected-engine only
// ============================================================================
type SeverityBucket = {
  severity: Severity;
  rows: Array<{ row: CorrectedEnriched; compliance: SlaCompliance }>;
};

function ComplianceSection({ inScope, manuallyLoggedCount }: { inScope: CorrectedEnriched[]; manuallyLoggedCount: number }) {
  const [breachesOpen, setBreachesOpen] = useState(false);
  const [resBreachesOpen, setResBreachesOpen] = useState(false);
  const [bySourceOpen, setBySourceOpen] = useState(false);
  const [frBasis, setFrBasis] = useState<"customer" | "all">("customer");

  const { buckets, unclassified, classifiedCount } = useMemo(() => {
    const buckets: Record<Severity, SeverityBucket> = {
      1: { severity: 1, rows: [] },
      2: { severity: 2, rows: [] },
      3: { severity: 3, rows: [] },
      4: { severity: 4, rows: [] },
    };
    const unclassified: CorrectedEnriched[] = [];
    let classifiedCount = 0;
    for (const r of inScope) {
      const rawSev = r.raw_payload?.custom_attributes?.Severity;
      const sev = parseSeverity(rawSev);
      if (sev == null) {
        unclassified.push(r);
        continue;
      }
      classifiedCount++;
      buckets[sev].rows.push({ row: r, compliance: evaluateCompliance(r.sla, sev) });
    }
    return { buckets, unclassified, classifiedCount };
  }, [inScope]);

  const total = inScope.length;
  const coveragePct = total ? (classifiedCount / total) * 100 : 0;

  // First-response breaches list — respects basis (customer-initiated only when "customer").
  const frBreaches = useMemo(() => {
    const out: Array<{ row: CorrectedEnriched; compliance: SlaCompliance }> = [];
    for (const sev of [1, 2, 3, 4] as const) {
      for (const r of buckets[sev].rows) {
        if (frBasis === "customer" && r.row.sla.initiatedBy !== "customer") continue;
        if (r.compliance.firstResponse.met === false) out.push(r);
      }
    }
    return out;
  }, [buckets, frBasis]);

  // Initiation counts across the in-scope population.
  const initiationCounts = useMemo(() => {
    let c = 0, a = 0;
    for (const r of inScope) {
      if (r.sla.initiatedBy === "agent") a++;
      else c++;
    }
    return { customer: c, agent: a };
  }, [inScope]);

  // Resolution breaches list (across all severities). Sev 4 has resolution.met === null so it's naturally excluded.
  const resBreaches = useMemo(() => {
    const out: Array<{ row: CorrectedEnriched; compliance: SlaCompliance }> = [];
    for (const sev of [1, 2, 3, 4] as const) {
      for (const r of buckets[sev].rows) {
        if (r.compliance.resolution.met === false) out.push(r);
      }
    }
    out.sort((a, b) => (b.compliance.resolution.value ?? 0) - (a.compliance.resolution.value ?? 0));
    return out;
  }, [buckets]);

  const rowSummary = (b: SeverityBucket) => {
    let frMet = 0, frBreach = 0, frNotEval = 0;
    let resMet = 0, resBreach = 0, resNotEval = 0;
    for (const { row, compliance } of b.rows) {
      const includeFr = frBasis === "all" || row.sla.initiatedBy === "customer";
      if (includeFr) {
        if (compliance.firstResponse.met === true) frMet++;
        else if (compliance.firstResponse.met === false) frBreach++;
        else frNotEval++;
      }
      // Resolution always covers ALL in-scope tickets regardless of basis.
      if (compliance.resolution.met === true) resMet++;
      else if (compliance.resolution.met === false) resBreach++;
      else resNotEval++;
    }
    const frDenom = frMet + frBreach;
    const resDenom = resMet + resBreach;
    return {
      n: b.rows.length,
      frMet, frBreach, frNotEval,
      frPct: frDenom ? (frMet / frDenom) * 100 : null,
      resMet, resBreach, resNotEval,
      resPct: resDenom ? (resMet / resDenom) * 100 : null,
    };
  };

  // "By source" breakout — reuses per-row compliance from `buckets` (classified rows only for %met).
  const bySource = useMemo(() => {
    const compliByRowId = new Map<string, SlaCompliance>();
    for (const sev of [1, 2, 3, 4] as const) {
      for (const { row, compliance } of buckets[sev].rows) {
        compliByRowId.set(row.id, compliance);
      }
    }
    type Key = "slack" | "sam" | "direct";
    const groups: Record<Key, CorrectedEnriched[]> = { slack: [], sam: [], direct: [] };
    for (const r of inScope) {
      const key: Key = r.origin === "slack" ? "slack" : r.sla.flags.samParticipated ? "sam" : "direct";
      groups[key].push(r);
    }
    const summarize = (rows: CorrectedEnriched[]) => {
      let frMet = 0, frBreach = 0, resMet = 0, resBreach = 0;
      for (const row of rows) {
        const compliance = compliByRowId.get(row.id);
        if (compliance) {
          const includeFr = frBasis === "all" || row.sla.initiatedBy === "customer";
          if (includeFr) {
            if (compliance.firstResponse.met === true) frMet++;
            else if (compliance.firstResponse.met === false) frBreach++;
          }
          if (compliance.resolution.met === true) resMet++;
          else if (compliance.resolution.met === false) resBreach++;
        }
      }
      const frDenom = frMet + frBreach;
      const resDenom = resMet + resBreach;
      return {
        n: rows.length,
        frPct: frDenom ? (frMet / frDenom) * 100 : null,
        resPct: resDenom ? (resMet / resDenom) * 100 : null,
        preInboxMedian: aggregate(rows.map((r) => r.sla.preInboxTimeS)).median,
      };
    };
    return {
      slack: summarize(groups.slack),
      sam: summarize(groups.sam),
      direct: summarize(groups.direct),
    };
  }, [inScope, buckets, frBasis]);



  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Compliance vs proposed SLA targets</CardTitle>
        <CardDescription>
          Provisional per-severity targets applied to the in-scope corrected population.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Severity coverage:{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {coveragePct.toFixed(1)}%
          </span>{" "}
          classified ({classifiedCount} of {total} tickets)
        </div>

        <div className="text-xs text-muted-foreground">
          Initiation:{" "}
          <span className="font-semibold text-foreground tabular-nums">{initiationCounts.customer}</span> customer-initiated ·{" "}
          <span className="font-semibold text-foreground tabular-nums">{initiationCounts.agent}</span> agent-initiated
          {frBasis === "customer" && (
            <span className="italic"> — agent-initiated excluded from First Response %</span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">First Response basis:</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setFrBasis("customer")}
              className={`px-3 py-1 ${frBasis === "customer" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
            >
              Customer-initiated
            </button>
            <button
              type="button"
              onClick={() => setFrBasis("all")}
              className={`px-3 py-1 border-l border-border ${frBasis === "all" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
            >
              All tickets
            </button>
          </div>
        </div>


        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                <th className="text-right px-3 py-2 font-medium">n</th>
                <th className="text-left px-3 py-2 font-medium">FR target</th>
                <th className="text-right px-3 py-2 font-medium">FR %met</th>
                <th className="text-right px-3 py-2 font-medium">FR breaches</th>
                <th className="text-right px-3 py-2 font-medium">FR n/a</th>
                <th className="text-left px-3 py-2 font-medium">Res target</th>
                <th className="text-right px-3 py-2 font-medium">Res %met</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3, 4] as const).map((sev) => {
                const s = rowSummary(buckets[sev]);
                const t = SLA_TARGETS[sev];
                return (
                  <tr key={sev} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">Sev {sev}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.n}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {(t.firstResponseClock === "business" ? formatBusinessDuration : formatDuration)(t.firstResponseS)} <span className="text-muted-foreground/70">({t.firstResponseClock === "business" ? "bh" : "cal"})</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {s.frPct == null ? "—" : `${s.frPct.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">{s.frBreach || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.frNotEval || "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {t.resolutionS == null
                        ? <span className="italic">best-effort — n/a</span>
                        : <>{(t.resolutionClock === "business" ? formatBusinessDuration : formatDuration)(t.resolutionS)} <span className="text-muted-foreground/70">({t.resolutionClock === "business" ? "bh" : "cal"})</span></>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {sev === 4
                        ? <span className="text-muted-foreground italic">best-effort — n/a</span>
                        : s.resPct == null ? "—" : `${s.resPct.toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-muted/20">
                <td className="px-3 py-2 font-medium text-muted-foreground">Unclassified (no severity)</td>
                <td className="px-3 py-2 text-right tabular-nums">{unclassified.length}</td>
                <td className="px-3 py-2 text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                <td className="px-3 py-2 text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="border-t border-border pt-3">
          <button
            className="text-xs font-medium text-foreground hover:underline"
            onClick={() => setBySourceOpen((v) => !v)}
          >
            {bySourceOpen ? "▾" : "▸"} By source
          </button>
          {bySourceOpen && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Source</th>
                    <th className="text-right px-3 py-2 font-medium">n</th>
                    <th className="text-right px-3 py-2 font-medium">FR %met</th>
                    <th className="text-right px-3 py-2 font-medium">Res %met</th>
                    <th className="text-right px-3 py-2 font-medium">Pre-inbox median</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Slack", bySource.slack],
                    ["Sam-first", bySource.sam],
                    ["Direct (email/msgr, no Sam)", bySource.direct],
                  ] as const).map(([label, s]) => (
                    <tr key={label} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.n}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {s.frPct == null ? "—" : `${s.frPct.toFixed(0)}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {s.resPct == null ? "—" : `${s.resPct.toFixed(0)}%`}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatDuration(s.preInboxMedian)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-border bg-muted/20 text-muted-foreground">
                    <td className="px-3 py-2 italic">Manually-logged (excluded)</td>
                    <td className="px-3 py-2 text-right tabular-nums">{manuallyLoggedCount}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right">—</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2 text-xs text-muted-foreground">
                Slack = Slack-sourced · Sam-first = Sam replied then handed off (email/messenger) · Direct = email/messenger, no Sam. FR %met respects the basis toggle above; resolution covers all tickets in each bucket.
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3">

          <button
            className="text-xs font-medium text-foreground hover:underline"
            onClick={() => setBreachesOpen((v) => !v)}
          >
            {breachesOpen ? "▾" : "▸"} First-Response breaches ({frBreaches.length})
          </button>
          {breachesOpen && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Ticket</th>
                    <th className="text-left px-3 py-2 font-medium">Severity</th>
                    <th className="text-right px-3 py-2 font-medium">Measured FR</th>
                    <th className="text-right px-3 py-2 font-medium">Target</th>
                    <th className="text-left px-3 py-2 font-medium">Clock</th>
                  </tr>
                </thead>
                <tbody>
                  {frBreaches.map(({ row, compliance }) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2 max-w-[320px] truncate">
                        <a
                          href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${row.intercom_conversation_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground hover:underline"
                          title={row.subject ?? ""}
                        >
                          {row.subject || `Intercom #${row.intercom_conversation_id}`}
                        </a>
                      </td>
                      <td className="px-3 py-2">Sev {compliance.severity}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-destructive">
                        {(compliance.firstResponse.clock === "business" ? formatBusinessDuration : formatDuration)(compliance.firstResponse.value)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {(compliance.firstResponse.clock === "business" ? formatBusinessDuration : formatDuration)(compliance.firstResponse.target)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {compliance.firstResponse.clock === "business" ? "business hrs" : "calendar"}
                      </td>
                    </tr>
                  ))}
                  {!frBreaches.length && (
                    <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground text-xs">No first-response breaches.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t border-border pt-3">
          <button
            className="text-xs font-medium text-foreground hover:underline"
            onClick={() => setResBreachesOpen((v) => !v)}
          >
            {resBreachesOpen ? "▾" : "▸"} Resolution breaches ({resBreaches.length})
          </button>
          {resBreachesOpen && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Ticket</th>
                    <th className="text-left px-3 py-2 font-medium">Severity</th>
                    <th className="text-right px-3 py-2 font-medium">Measured</th>
                    <th className="text-right px-3 py-2 font-medium">Target</th>
                    <th className="text-left px-3 py-2 font-medium">Clock</th>
                    <th className="text-right px-3 py-2 font-medium">Reopens</th>
                  </tr>
                </thead>
                <tbody>
                  {resBreaches.map(({ row, compliance }) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2 max-w-[320px] truncate">
                        <a
                          href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${row.intercom_conversation_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground hover:underline"
                          title={row.subject ?? ""}
                        >
                          {row.subject || `Intercom #${row.intercom_conversation_id}`}
                        </a>
                      </td>
                      <td className="px-3 py-2">Sev {compliance.severity}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-destructive">
                        {(compliance.resolution.clock === "business" ? formatBusinessDuration : formatDuration)(compliance.resolution.value)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {(compliance.resolution.clock === "business" ? formatBusinessDuration : formatDuration)(compliance.resolution.target)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {compliance.resolution.clock === "business" ? "business hrs" : "calendar"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {row.sla.reopenCount > 0 ? row.sla.reopenCount : "—"}
                      </td>
                    </tr>
                  ))}
                  {!resBreaches.length && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-xs">No resolution breaches.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>



        <p className="text-[11px] text-muted-foreground leading-relaxed">
          First Response = first human reply, measured from the AI→human handoff for AI-handled tickets (else from open). Resolution = active in-our-court time (stop-the-clock: customer-wait and reopened gaps excluded). Clocks: Sev 1 wall-clock 24/7; Sev 2–4 Europe/Berlin business hours (1 business day = 15h). Business-hours durations are shown in business days ("bd", 1 bd = 15h) so they line up with the targets; calendar durations use 24h days. Company holidays not yet modeled. Targets are provisional. Sev 1 sample is tiny (n≈1). First Response basis: Customer-initiated by default (agent-initiated tickets — outbound/relayed/forwarded, ~half the volume — are shown separately and excluded from the FR %, since no customer was awaiting a first reply); switch to All tickets for the source-independent total. Resolution always covers all tickets.
        </p>
      </CardContent>
    </Card>
  );
}
