import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Gauge, ArrowUpDown, ExternalLink, PlayCircle } from "lucide-react";
import { format } from "date-fns";
import { displaySubject } from "@/lib/subjectDisplay";

import {
  aggregate,
  computeTicketSla,
  computeSla,
  detectOrigin,
  formatDuration,
  formatBusinessDuration,

  parseSeverity,
  evaluateCompliance,
  evaluateCadence,
  evaluateTriage,
  businessDaySeconds,
  DEFAULT_BUSINESS_HOURS,
  type SlaPolicy,
  type TicketSla,
  type SlaResult,
  type TimelinePart,
  type Actor,
  type Origin,
  parsePlanTier,
  type PlanTier,
  type Severity,
  type SlaCompliance,
} from "@/lib/slaMetrics";
import {
  useSlaBatch,
  classifySlaBatchRow as classifyRow,
  type SlaBatchRow as Row,
  type SlaBatchEnriched as CorrectedEnriched,
  type SlaOverride,
  type SlaOverrideMetric,
  type SlaOverrideReason,
  BUILTIN_POLICY,
  BUILTIN_SSE_POLICY,
} from "@/hooks/useSlaBatch";
import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { PLAN_LABEL, inPlanScope, type PlanScope } from "@/lib/planTier";

/** Business-day length for the given policy's calendar — drives "Nbd" rendering. */
const bizDay = (p: SlaPolicy) => businessDaySeconds(p.businessHours);
import { PolicyFallbackBanner } from "@/components/sla/PolicyFallbackBanner";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type DateWindow,
  WINDOW_LABELS,
  WINDOW_CAPTIONS,
  windowRange,
  rowClosedAtMs,
} from "@/lib/slaWindow";




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
export default function SlaWorkbench() {
  const [showTestData, setShowTestData] = useState(false);
  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Gauge className="h-3.5 w-3.5" /> Practitioner tool · SLA validation
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">SLA Workbench</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Detailed "data behind it" view. Analyze individual tickets by ID or browse the full stored batch with
              per-ticket metrics, compliance breakdown, and legacy comparison.
              Business hours = Europe/Berlin, Mon–Fri 09:00–24:00.
            </p>
          </div>
          <TestDataToggle showTestData={showTestData} onChange={setShowTestData} />
        </div>

        {showTestData && <TestDataBanner />}

        <Tabs defaultValue="live" className="w-full">
          <TabsList>
            <TabsTrigger value="live">Analyze by ID (live)</TabsTrigger>
            <TabsTrigger value="batch">Population review (snapshot)</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="mt-4">
            <LiveAnalyzeTab />
          </TabsContent>

          <TabsContent value="batch" className="mt-4">
            <BatchStoredTab showTestData={showTestData} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// Shared test-data affordances (also used in SlaDashboard via import).
export function TestDataToggle({ showTestData, onChange }: { showTestData: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 cursor-pointer select-none">
      <Switch checked={showTestData} onCheckedChange={onChange} />
      <span className="text-xs font-medium">Show test data</span>
    </label>
  );
}

export function TestDataBanner() {
  return (
    <div className="rounded-md border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm">
      <div className="font-semibold text-destructive uppercase tracking-wide">
        ⚠ Test data included — these figures are NOT real compliance
      </div>
      <div className="text-destructive/80 mt-0.5 text-xs">
        Sandbox/test customer accounts are being counted in the SLA population. Toggle "Show test data" off to restore the real reporting view.
      </div>
    </div>
  );
}

// Local switch import (kept next to the component that owns it) so SlaDashboard
// can reuse the toggle/banner without a shared file.


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
  shared_inbox: { label: "shared inbox", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },

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
// TAB 2 · Population review (snapshot) — formerly "Batch (stored)"
// ============================================================================
type BatchMode = "corrected" | "legacy";

function BatchStoredTab({ showTestData }: { showTestData: boolean }) {
  const [mode, setMode] = useState<BatchMode>("corrected");
  const { rows, loading, error, refresh, isExcused, getOverride, refreshOverrides, customerLabels, testAccountKeys, activePolicy, policyError, resolveForAnchor, policyConfigLoaded } = useSlaBatch({ showTestData });

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
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && (
        <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
      )}

      {mode === "corrected"
        ? <CorrectedBatch rows={rows} loading={loading} isExcused={isExcused} getOverride={getOverride} refreshOverrides={refreshOverrides} customerLabels={customerLabels} testAccountKeys={testAccountKeys} showTestData={showTestData} activePolicy={activePolicy} policyError={policyError} resolveForAnchor={resolveForAnchor} policyConfigLoaded={policyConfigLoaded} />
        : <LegacyBatch rows={rows} loading={loading} />}
    </div>
  );
}

// ----- Corrected engine view -----


const UNATTRIBUTED = "__unattributed__";
const ALL_CUSTOMERS = "__all__";

function CorrectedBatch({ rows, loading, isExcused, getOverride, refreshOverrides, customerLabels, testAccountKeys, showTestData, activePolicy, policyError, resolveForAnchor, policyConfigLoaded }: { rows: Row[]; loading: boolean; isExcused: (cid: string, metric: SlaOverrideMetric) => boolean; getOverride: (cid: string, metric: SlaOverrideMetric) => SlaOverride | undefined; refreshOverrides: () => void; customerLabels: Map<string, string>; testAccountKeys: Set<string>; showTestData: boolean; activePolicy: SlaPolicy; policyError: string | null; resolveForAnchor: (anchorMs: number, plan?: PlanTier) => SlaPolicy | null; policyConfigLoaded: boolean }) {
  const [sortKey, setSortKey] = useState<CorrectedSortKey>("closed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [dateWindow, setDateWindow] = useState<DateWindow>("month");
  const [customerFilter, setCustomerFilter] = useState<string>(ALL_CUSTOMERS);
  // SSE has no FR/resolution commitment, so the default population is Enterprise
  // only — otherwise unscoreable rows would drag compliance down silently.
  const [planScope, setPlanScope] = useState<PlanScope>("enterprise");

  const enriched: CorrectedEnriched[] = useMemo(
    () => rows.map((r) => {
      // Two-pass policy resolution, mirroring useSlaBatch: pass 1 derives the
      // wall-clock inbound anchor, pass 2 re-scores with that policy's calendar.
      const base = computeSla(r.raw_payload);
      const anchorS = base.slaClockStartS ?? base.createdAtS;
      const planTier = parsePlanTier((r as any).plan_tier);
      const resolved = policyConfigLoaded && anchorS != null ? resolveForAnchor(anchorS * 1000, planTier) : null;
      const policy = resolved ?? (planTier === "sse" ? BUILTIN_SSE_POLICY : BUILTIN_POLICY);
      const policyFallback = resolved == null;
      const sla = policy.businessHours === DEFAULT_BUSINESS_HOURS
        ? base
        : computeSla(r.raw_payload, undefined, policy.businessHours);
      const origin = detectOrigin(r.raw_payload);
      const bucket = classifyRow(r, sla, { testAccountKeys, showTestData });
      return { ...r, sla, origin, bucket, planTier, policy, policyFallback };
    }),
    [rows, testAccountKeys, showTestData, policyConfigLoaded, resolveForAnchor],
  );

  const inScope = useMemo(() => enriched.filter((r) => r.bucket === "inScope"), [enriched]);
  const excluded = useMemo(() => enriched.filter((r) => r.bucket === "excluded"), [enriched]);
  const noCustomer = useMemo(() => enriched.filter((r) => r.bucket === "noCustomer"), [enriched]);
  const manuallyLogged = useMemo(() => enriched.filter((r) => r.bucket === "manuallyLogged"), [enriched]);

  // Date-window filter over in-scope rows.
  const inScopeDate = useMemo(() => {
    const { startMs, endMs } = windowRange(dateWindow, new Date());
    if (startMs == null && endMs == null) return inScope;
    return inScope.filter((r) => {
      const t = rowClosedAtMs(r);
      if (t == null) return false;
      return (startMs == null || t >= startMs) && (endMs == null || t < endMs);
    });
  }, [inScope, dateWindow]);

  // Customer options derived from date-filtered in-scope.
  const customerOptions = useMemo(() => {
    const keys = new Set<string>();
    let hasUnattributed = false;
    for (const r of inScopeDate) {
      const k = r.customer_key?.trim();
      if (k) keys.add(k); else hasUnattributed = true;
    }
    const opts = Array.from(keys).map((k) => ({ value: k, label: customerLabels.get(k) ?? k }));
    opts.sort((a, b) => a.label.localeCompare(b.label));
    if (hasUnattributed) opts.push({ value: UNATTRIBUTED, label: "Unattributed" });
    return opts;
  }, [inScopeDate, customerLabels]);

  // Compose plan scope + customer filter on top of date filter.
  const inScopePlan = useMemo(
    () => inScopeDate.filter((r) => inPlanScope(r.plan_tier, planScope)),
    [inScopeDate, planScope],
  );
  const filteredInScope = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return inScopePlan;
    if (customerFilter === UNATTRIBUTED) {
      return inScopePlan.filter((r) => !r.customer_key || !r.customer_key.trim());
    }
    return inScopePlan.filter((r) => r.customer_key === customerFilter);
  }, [inScopePlan, customerFilter]);

  const selectedCustomerLabel =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customerFilter === UNATTRIBUTED
        ? "Unattributed"
        : customerLabels.get(customerFilter) ?? customerFilter;

  const kpis = useMemo(() => ({
    humanBH: aggregate(filteredInScope.map((r) => r.sla.firstHumanReplyFromInboxBusinessHoursS)),
    humanCal: aggregate(filteredInScope.map((r) => r.sla.firstHumanReplyFromInboxS)),
    anyCal: aggregate(filteredInScope.map((r) => r.sla.firstResponseAnyAgentS)),
    ttrBH: aggregate(filteredInScope.map((r) => r.sla.ttrBusinessHoursS)),
    preInbox: aggregate(filteredInScope.map((r) => r.sla.preInboxTimeS)),
  }), [filteredInScope]);

  // Work-Before-Ticket (process signal): Support replied BEFORE the ticket
  // reached the Enterprise Inbox. Distinct from "Pre-inbox time" (the
  // customer's total wait before the ticket existed as an Enterprise ticket).
  const wbt = useMemo(() => {
    const calc = (rs: CorrectedEnriched[]) => {
      const answered = rs.filter((r) => r.sla.workBeforeTicketS != null);
      const withWork = answered.filter((r) => (r.sla.workBeforeTicketS ?? 0) > 0);
      return {
        answered: answered.length,
        withWork: withWork.length,
        pct: answered.length ? (withWork.length / answered.length) * 100 : null,
        median: aggregate(withWork.map((r) => r.sla.workBeforeTicketBusinessHoursS)).median,
      };
    };
    const bySource = (["slack", "sam", "direct"] as const).map((k) => ({
      key: k,
      ...calc(filteredInScope.filter((r) => (
        k === "slack" ? r.origin === "slack" : k === "sam" ? r.sla.flags.samParticipated : r.origin !== "slack" && !r.sla.flags.samParticipated
      ))),
    }));
    return { overall: calc(filteredInScope), bySource };
  }, [filteredInScope]);

  // Exclusion reasons — mirrors classifyRow's predicates (display only).
  const exclusionBreakdown = useMemo(() => {
    const c = {
      not_enterprise: 0, fyi_or_duplicate: 0, merged: 0, rsa_false: 0,
      test_account: 0, prospect_personal: 0, enterprise_prospect: 0, other: 0,
    };
    for (const r of excluded) {
      const tags = Array.isArray(r.tags) ? r.tags : [];
      const isTest = !!(r.customer_key && testAccountKeys.has(r.customer_key));
      if (isTest && !showTestData) c.test_account++;
      else if (r.rsa_override === false) c.rsa_false++;
      else if (r.rsa_override == null && (tags.includes("enterprise-fyi") || tags.includes("enterprise-duplicate"))) c.fyi_or_duplicate++;
      else if (tags.includes("merged_ticket")) c.merged++;
      else if (r.customer_resolution_method === "not_enterprise") c.not_enterprise++;
      else if (r.customer_resolution_method === "prospect_personal") c.prospect_personal++;
      else if (r.customer_resolution_method === "enterprise_prospect") c.enterprise_prospect++;
      else c.other++;
    }
    return c;
  }, [excluded, testAccountKeys, showTestData]);

  const reopenRate = useMemo(() => {
    if (!filteredInScope.length) return null;
    const n = filteredInScope.filter((r) => r.sla.reopenCount > 0).length;
    return { n, total: filteredInScope.length, pct: (n / filteredInScope.length) * 100 };
  }, [filteredInScope]);


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
    return [...filteredInScope].sort((a, b) => (val(a) - val(b)) * dir);
  }, [filteredInScope, sortKey, sortDir]);

  const toggleSort = (k: CorrectedSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <div className="space-y-4">
      <PolicyFallbackBanner
        show={!policyConfigLoaded || enriched.some((r) => r.policyFallback)}
        error={policyError}
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Window</span>
        <Select value={dateWindow} onValueChange={(v) => setDateWindow(v as DateWindow)}>
          <SelectTrigger className="h-8 w-[180px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WINDOW_LABELS) as DateWindow[]).map((w) => (
              <SelectItem key={w} value={w}>{WINDOW_LABELS[w]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground italic">{WINDOW_CAPTIONS[dateWindow]}</span>
        <span className="text-xs uppercase tracking-wide text-muted-foreground ml-2">Plan</span>
        <PlanScopeSelect value={planScope} onChange={setPlanScope} className="h-8 w-[200px] text-sm" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground ml-2">Customer</span>
        <Select value={customerFilter} onValueChange={setCustomerFilter}>
          <SelectTrigger className="h-8 w-[220px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CUSTOMERS}>All customers</SelectItem>
            {customerOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">In-scope: {filteredInScope.length}</span>
        <span className="text-muted-foreground"> · {WINDOW_CAPTIONS[dateWindow]}</span>
        <span className="text-muted-foreground"> · plan: <span className="text-foreground font-medium">{PLAN_LABEL[planScope]}</span></span>
        {selectedCustomerLabel && (
          <span className="text-muted-foreground"> · customer: <span className="text-foreground font-medium">{selectedCustomerLabel}</span></span>
        )}
        {" · "}
        Excluded (not-enterprise/dup/merged/RSA): <span className="font-medium">{excluded.length}</span>
        {" · "}
        Internal / no-customer: <span className="font-medium">{noCustomer.length}</span>
        {" · "}
        Manually-logged (excluded): <span className="font-medium">{manuallyLogged.length}</span>
        {" · "}
        Total loaded: {enriched.length}
      </div>

      <ComplianceSection inScope={filteredInScope} manuallyLoggedCount={manuallyLogged.length} isExcused={isExcused} activePolicy={activePolicy} />

      <ViolationsSection
        inScope={filteredInScope}
        activePolicy={activePolicy}
        customerLabels={customerLabels}
        isExcused={isExcused}
        getOverride={getOverride}
        refreshOverrides={refreshOverrides}
      />




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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Work Before Ticket</CardTitle>
            <CardDescription className="text-xs">
              Support replied BEFORE the ticket reached the Enterprise Inbox (mirror of the clamped FRT).
              Distinct from the "Pre-inbox time" tile, which is the customer's total wait before Enterprise Inbox assignment.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1 tabular-nums">
            <div>
              Tickets with work before ticket: <strong>{wbt.overall.withWork}</strong> of {wbt.overall.answered} support-answered
              {wbt.overall.pct != null && <> ({wbt.overall.pct.toFixed(1)}%)</>}
            </div>
            <div>Median work before ticket (bus.hrs): <strong>{formatDuration(wbt.overall.median)}</strong></div>
            <div className="pt-1 text-xs text-muted-foreground space-y-0.5">
              {wbt.bySource.map((s) => (
                <div key={s.key}>
                  {s.key}: {s.withWork}/{s.answered}
                  {s.pct != null && <> ({s.pct.toFixed(0)}%)</>} · median {formatDuration(s.median)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Excluded from population — by reason</CardTitle>
            <CardDescription className="text-xs">{excluded.length} excluded rows (all loaded tickets, not window-filtered)</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-xs space-y-0.5 tabular-nums">
              <li>not_enterprise: {exclusionBreakdown.not_enterprise}</li>
              <li>enterprise-fyi + enterprise-duplicate: {exclusionBreakdown.fyi_or_duplicate}</li>
              <li>merged_ticket: {exclusionBreakdown.merged}</li>
              <li>rsa_override = false: {exclusionBreakdown.rsa_false}</li>
              <li>test_account: {exclusionBreakdown.test_account}</li>
              <li>prospect_personal: {exclusionBreakdown.prospect_personal}</li>
              <li>enterprise_prospect: {exclusionBreakdown.enterprise_prospect}</li>
              {exclusionBreakdown.other > 0 && <li>other: {exclusionBreakdown.other}</li>}
            </ul>
          </CardContent>
        </Card>
      </div>



      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Per-ticket (in-scope)
            {loading && <Loader2 className="h-4 w-4 inline ml-2 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>{filteredInScope.length} in-scope tickets · computed with corrected engine over stored raw_payload</CardDescription>
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
                        title={displaySubject(r, "")}
                      >
                        {displaySubject(r, `Intercom #${r.intercom_conversation_id}`)}
                      </a>
                    </td>
                    <td className="px-3 py-2"><OriginBadge origin={r.origin} /></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatDuration(r.sla.firstHumanReplyFromOpenBusinessHoursS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatDuration(r.sla.firstHumanReplyFromOpenS)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.ttrBusinessHoursS)}</td>
                  </tr>
                ))}
                {!loading && !sorted.length && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No in-scope tickets found.</td></tr>
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
                        title={displaySubject(r, "")}
                      >
                        {displaySubject(r, `Intercom #${r.intercom_conversation_id}`)}
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

function ComplianceSection({
  inScope,
  manuallyLoggedCount,
  isExcused,
  activePolicy,
}: {
  inScope: CorrectedEnriched[];
  manuallyLoggedCount: number;
  isExcused: (cid: string, metric: SlaOverrideMetric) => boolean;
  activePolicy: SlaPolicy;
}) {
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
      buckets[sev].rows.push({ row: r, compliance: evaluateCompliance(r.sla, sev, r.policy.targets) });
    }
    return { buckets, unclassified, classifiedCount };
  }, [inScope]);

  const total = inScope.length;
  const coveragePct = total ? (classifiedCount / total) * 100 : 0;

  // Initiation counts across the in-scope population.
  const initiationCounts = useMemo(() => {
    let c = 0, a = 0;
    for (const r of inScope) {
      if (r.sla.initiatedBy === "agent") a++;
      else c++;
    }
    return { customer: c, agent: a };
  }, [inScope]);


  const rowSummary = (b: SeverityBucket) => {
    let frMet = 0, frBreach = 0, frExcused = 0, frNotEval = 0;
    let resMet = 0, resBreach = 0, resExcused = 0, resNotEval = 0;
    // Cadence mirrors FR/Res exactly: met / breach / excused / not-evaluable.
    // Sev 3–4 carry no cadence commitment, so evaluateCadence returns null and
    // every one of their rows lands in cadNotEval — never scored as a miss.
    let cadMet = 0, cadBreach = 0, cadExcused = 0, cadNotEval = 0;
    for (const { row, compliance } of b.rows) {
      const includeFr = frBasis === "all" || row.sla.initiatedBy === "customer";
      if (includeFr) {
        if (compliance.firstResponse.met === true) frMet++;
        else if (compliance.firstResponse.met === false) {
          if (isExcused(row.intercom_conversation_id, "first_response")) frExcused++;
          else frBreach++;
        }
        else frNotEval++;
      }
      // Resolution always covers ALL in-scope tickets regardless of basis.
      if (compliance.resolution.met === true) resMet++;
      else if (compliance.resolution.met === false) {
        if (isExcused(row.intercom_conversation_id, "resolution")) resExcused++;
        else resBreach++;
      }
      else resNotEval++;

      const cadMetVal = evaluateCadence(row.sla, b.severity, row.policy.cadence?.[b.severity]?.maxGapS);
      if (cadMetVal === true) cadMet++;
      else if (cadMetVal === false) {
        if (isExcused(row.intercom_conversation_id, "cadence")) cadExcused++;
        else cadBreach++;
      }
      else cadNotEval++;
    }
    const frDenom = frMet + frBreach;
    const resDenom = resMet + resBreach;
    const cadDenom = cadMet + cadBreach;
    return {
      n: b.rows.length,
      frMet, frBreach, frExcused, frNotEval,
      frPct: frDenom ? (frMet / frDenom) * 100 : null,
      resMet, resBreach, resExcused, resNotEval,
      resPct: resDenom ? (resMet / resDenom) * 100 : null,
      cadMet, cadBreach, cadExcused, cadNotEval,
      cadPct: cadDenom ? (cadMet / cadDenom) * 100 : null,
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

        {(() => {
          const totals = ([1,2,3,4] as const).reduce((acc, sev) => {
            const s = rowSummary(buckets[sev]);
            acc.excused += s.frExcused + s.resExcused;
            acc.breach += s.frBreach + s.resBreach;
            return acc;
          }, { excused: 0, breach: 0 });
          const denom = totals.excused + totals.breach;
          const pct = denom ? Math.round((totals.excused / denom) * 100) : 0;
          return (
            <div className="text-xs text-muted-foreground">
              Overrides: {totals.excused} of {denom} breaches excused ({pct}%)
            </div>
          );
        })()}


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
                <th className="text-right px-3 py-2 font-medium">Res breaches</th>
                <th className="text-left px-3 py-2 font-medium">Cadence target</th>
                <th className="text-right px-3 py-2 font-medium">Cadence %met</th>
                <th className="text-right px-3 py-2 font-medium">Cadence breaches</th>
              </tr>
            </thead>
            <tbody>
              {([1, 2, 3, 4] as const).map((sev) => {
                const s = rowSummary(buckets[sev]);
                const t = activePolicy.targets[sev];
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
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">
                      {s.frBreach || "—"}
                      {s.frExcused > 0 && <span className="ml-1 text-muted-foreground text-[11px]">· {s.frExcused} excused</span>}
                    </td>
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
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">
                      {s.resBreach || "—"}
                      {s.resExcused > 0 && <span className="ml-1 text-muted-foreground text-[11px]">· {s.resExcused} excused</span>}
                    </td>
                    {(() => {
                      const c = activePolicy.cadence?.[sev] ?? null;
                      return (
                        <>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {c == null
                              ? <span className="italic">no commitment — n/a</span>
                              : <>{(c.clock === "business" ? formatBusinessDuration : formatDuration)(c.maxGapS)} <span className="text-muted-foreground/70">({c.clock === "business" ? "bh" : "cal"})</span></>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {c == null
                              ? <span className="text-muted-foreground italic">n/a</span>
                              : s.cadPct == null ? "—" : `${s.cadPct.toFixed(0)}%`}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-destructive">
                            {c == null ? <span className="text-muted-foreground">—</span> : (s.cadBreach || "—")}
                            {s.cadExcused > 0 && <span className="ml-1 text-muted-foreground text-[11px]">· {s.cadExcused} excused</span>}
                          </td>
                        </>
                      );
                    })()}
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
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                <td className="px-3 py-2 text-muted-foreground">—</td>
                <td className="px-3 py-2 text-right text-muted-foreground">—</td>
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

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          First Response = first human reply, measured from the AI→human handoff for AI-handled tickets (else from open). Resolution = active in-our-court time (stop-the-clock: customer-wait and reopened gaps excluded). Communication cadence (PROVISIONAL, drumbeat model incl. tail gap) = the worst gap between proactive updates; Sev 1 target 1h wall-clock, Sev 2 target 4h business hours, and Sev 3/4 carry no cadence commitment so their column reads n/a and never scores a miss — tickets with no comms or no close are non-evaluable and are excluded from the cadence denominator rather than counted as misses. Clocks: Sev 1 wall-clock 24/7; Sev 2–4 Europe/Berlin business hours (1 business day = 15h). Business-hours durations are shown in business days ("bd", 1 bd = 15h) so they line up with the targets; calendar durations use 24h days. Company holidays not yet modeled. Sev 1 sample is tiny (n≈1). First Response basis: Customer-initiated by default (agent-initiated tickets — outbound/relayed/forwarded, ~half the volume — are shown separately and excluded from the FR %, since no customer was awaiting a first reply); switch to All tickets for the source-independent total. Resolution always covers all tickets. Individual breaches and their excuses live in the Violations table below.
        </p>
      </CardContent>

    </Card>
  );
}

// --- Excuse action cell ---
function ExcuseCell({
  excused, override, isAdmin, onExcuse, onRemove,
}: {
  excused: boolean;
  override: SlaOverride | undefined;
  isAdmin: boolean;
  onExcuse: () => void;
  onRemove: () => void;
}) {
  if (excused && override) {
    return (
      <div className="inline-flex flex-col items-end gap-0.5 text-right no-underline">
        <div className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Excused · {override.reason.replace("_", " ")}
          </span>
          <button
            onClick={onRemove}
            disabled={!isAdmin}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            title={isAdmin ? "Remove override" : "Admin only"}
          >
            Remove
          </button>
        </div>
        {override.note && (
          <div
            className="text-[11px] text-muted-foreground italic max-w-[280px] truncate"
            title={override.note}
          >
            “{override.note}”
          </div>
        )}
      </div>
    );
  }
  // INSERT/UPDATE on sla_violation_overrides are admin-only via RLS, so the
  // excuse control is disabled for non-admins (they still see the violation).
  if (!isAdmin) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onExcuse}
      title="Excuse this violation"
      className="h-7 text-xs"
    >
      Excuse
    </Button>
  );
}

// --- Excuse dialog ---
function ExcuseDialog({
  target, onClose, onSaved,
}: {
  target: { cid: string; metric: SlaOverrideMetric; subject: string | null; suggestedReason?: SlaOverrideReason } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState<SlaOverrideReason | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email ?? null));
  }, []);

  useEffect(() => {
    if (target) { setReason(target.suggestedReason ?? ""); setNote(""); }
  }, [target?.cid, target?.metric]);

  const open = !!target;
  const options = target ? REASONS_BY_METRIC[target.metric] : [];

  const save = async () => {
    if (!target) return;
    if (!reason) { toast({ title: "Pick a reason first" }); return; }
    setSaving(true);
    const { error } = await supabase
      .from("sla_violation_overrides" as any)
      .upsert(
        {
          intercom_conversation_id: target.cid,
          metric: target.metric,
          reason,
          note: note.trim() || null,
          created_by: email,
        },
        { onConflict: "intercom_conversation_id,metric" },
      );
    setSaving(false);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Violation excused" }); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Excuse violation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 min-w-0">
          <div className="w-full min-w-0 truncate text-xs text-muted-foreground">
            {target ? METRIC_LABELS[target.metric] : ""} · {target?.subject ?? target?.cid}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Reason</label>
            <Select value={reason || undefined} onValueChange={(v) => setReason(v as SlaOverrideReason)}>
              <SelectTrigger><SelectValue placeholder="Reason…" /></SelectTrigger>
              <SelectContent>
                {options.map((r) => (
                  <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Note (optional)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// ============================================================================
// Unified violations — triage (30-min business-hours target), first response,
// resolution. One row per ticket; overrides live in `sla_violation_overrides`.
// ============================================================================
type ViolMetric = SlaOverrideMetric;

const REASON_LABELS: Record<SlaOverrideReason, string> = {
  holiday: "Holiday",
  off_hours: "Off hours",
  customer_hold: "Customer-side hold",
  non_support_thread: "Non-support thread",
  recorded_at_close: "Recorded at close",
  answered_before_classified: "Answered before classified",
  data_artifact: "Data artifact",
  genuine_miss: "Genuine miss",
  other: "Other",
};

const REASONS_BY_METRIC: Record<ViolMetric, SlaOverrideReason[]> = {
  triage: ["off_hours", "non_support_thread", "recorded_at_close", "answered_before_classified", "genuine_miss", "other"],
  first_response: ["holiday", "customer_hold", "data_artifact", "genuine_miss", "other"],
  resolution: ["holiday", "customer_hold", "data_artifact", "genuine_miss", "other"],
  cadence: ["customer_hold", "off_hours", "non_support_thread", "data_artifact", "genuine_miss", "other"],
};

const METRIC_LABELS: Record<ViolMetric, string> = {
  triage: "Triage",
  first_response: "First response",
  resolution: "Resolution",
  cadence: "Communication cadence",
};

type ViolationRow = {
  row: CorrectedEnriched;
  severity: Severity | null;
  compliance: SlaCompliance | null;
  triageMiss: boolean;
  frMiss: boolean;
  resMiss: boolean;
  cadenceMiss: boolean;
};

// Sort options for the Violations table. "worst" is the historical default
// (most misses first, then biggest resolution overshoot) and stays the default
// so the table's meaning does not change silently for existing users.
type ViolSortKey =
  | "worst"
  | "severity"
  | "severity_desc"
  | "resolution"
  | "first_response"
  | "oldest"
  | "newest";

const VIOL_SORT_LABELS: Record<ViolSortKey, string> = {
  worst: "Worst first (most misses)",
  severity: "Severity (Sev 1 first)",
  severity_desc: "Severity (Sev 4 first)",
  resolution: "Longest resolution",
  first_response: "Longest first response",
  oldest: "Oldest ticket",
  newest: "Newest ticket",
};


function ViolationsSection({
  inScope,
  activePolicy,
  customerLabels,
  isExcused,
  getOverride,
  refreshOverrides,
}: {
  inScope: CorrectedEnriched[];
  activePolicy: SlaPolicy;
  customerLabels: Map<string, string>;
  isExcused: (cid: string, metric: SlaOverrideMetric) => boolean;
  getOverride: (cid: string, metric: SlaOverrideMetric) => SlaOverride | undefined;
  refreshOverrides: () => void;
}) {
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [hideExcused, setHideExcused] = useState(false);
  const [sortKey, setSortKey] = useState<ViolSortKey>("worst");
  const [excuseTarget, setExcuseTarget] = useState<{ cid: string; metric: ViolMetric; subject: string | null; suggestedReason?: SlaOverrideReason } | null>(null);
  // Severity is the input to every SLA target, so a misclassified ticket can look
  // like a violation. This opens the AI severity check for one ticket, read-only
  // until a human accepts inside the card itself.
  const [sevTarget, setSevTarget] = useState<{ cid: string; subject: string | null } | null>(null);

  const rows = useMemo<ViolationRow[]>(() => {
    const out: ViolationRow[] = [];
    for (const r of inScope) {
      const severity = parseSeverity(r.raw_payload?.custom_attributes?.Severity);
      const compliance = severity == null ? null : evaluateCompliance(r.sla, severity, r.policy.targets);
      const triageMiss = evaluateTriage(r.sla, r.policy.triageTargetS) === false;
      const frMiss = compliance?.firstResponse.met === false && r.sla.initiatedBy === "customer";
      const resMiss = compliance?.resolution.met === false;
      // Cadence: Sev1/Sev2 only, evaluable tickets only — never default to a miss.
      const cadenceMiss = severity == null ? false : evaluateCadence(r.sla, severity, r.policy.cadence?.[severity]?.maxGapS) === false;
      if (!triageMiss && !frMiss && !resMiss && !cadenceMiss) continue;
      out.push({ row: r, severity, compliance, triageMiss, frMiss: !!frMiss, resMiss: !!resMiss, cadenceMiss });
    }
    // Worst first: most misses, then biggest resolution overshoot.
    out.sort((a, b) => {
      const na = Number(a.triageMiss) + Number(a.frMiss) + Number(a.resMiss) + Number(a.cadenceMiss);
      const nb = Number(b.triageMiss) + Number(b.frMiss) + Number(b.resMiss) + Number(b.cadenceMiss);
      if (na !== nb) return nb - na;
      return (b.compliance?.resolution.value ?? 0) - (a.compliance?.resolution.value ?? 0);
    });
    return out;
  }, [inScope]);

  const summary = useMemo(() => {
    let misses = 0, excused = 0;
    const byReason = new Map<SlaOverrideReason, number>();
    for (const v of rows) {
      const cid = v.row.intercom_conversation_id;
      const check = (metric: ViolMetric, miss: boolean) => {
        if (!miss) return;
        misses++;
        const ov = getOverride(cid, metric);
        if (ov) {
          excused++;
          byReason.set(ov.reason, (byReason.get(ov.reason) ?? 0) + 1);
        }
      };
      check("triage", v.triageMiss);
      check("first_response", v.frMiss);
      check("resolution", v.resMiss);
      check("cadence", v.cadenceMiss);
    }
    return {
      tickets: rows.length,
      misses,
      excused,
      unexcused: misses - excused,
      pct: misses ? (excused / misses) * 100 : null,
      byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows, getOverride]);

  const filtered = useMemo(() => {
    if (!hideExcused) return rows;
    return rows.filter((v) => {
      const cid = v.row.intercom_conversation_id;
      const open = (metric: ViolMetric, miss: boolean) => miss && !isExcused(cid, metric);
      return open("triage", v.triageMiss) || open("first_response", v.frMiss) || open("resolution", v.resMiss) || open("cadence", v.cadenceMiss);
    });
  }, [rows, hideExcused, isExcused]);

  // Sorting. "worst" is the pre-existing default (most misses, then biggest
  // resolution overshoot) and is preserved exactly; the other keys re-sort a
  // COPY so `rows` (and therefore the summary counts) are never mutated.
  // Unclassified severity always sinks to the bottom of severity sorts — an
  // absent severity is not "Sev 5", it is unknown.
  const missCount = (v: ViolationRow) =>
    Number(v.triageMiss) + Number(v.frMiss) + Number(v.resMiss) + Number(v.cadenceMiss);

  const visible = useMemo(() => {
    if (sortKey === "worst") return filtered;
    const out = [...filtered];
    const created = (v: ViolationRow) => {
      const t = v.row.intercom_created_at ? Date.parse(v.row.intercom_created_at) : NaN;
      return Number.isNaN(t) ? 0 : t;
    };
    out.sort((a, b) => {
      switch (sortKey) {
        case "severity": {
          const sa = a.severity ?? 99, sb = b.severity ?? 99;
          if (sa !== sb) return sa - sb;
          return missCount(b) - missCount(a);
        }
        case "severity_desc": {
          const sa = a.severity ?? -1, sb = b.severity ?? -1;
          if (sa !== sb) return sb - sa;
          return missCount(b) - missCount(a);
        }
        case "resolution":
          return (b.compliance?.resolution.value ?? 0) - (a.compliance?.resolution.value ?? 0);
        case "first_response":
          return (b.compliance?.firstResponse.value ?? 0) - (a.compliance?.firstResponse.value ?? 0);
        case "oldest":
          return created(a) - created(b);
        case "newest":
          return created(b) - created(a);
        default:
          return 0;
      }
    });
    return out;
  }, [filtered, sortKey]);


  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Violations</CardTitle>
        <CardDescription>
          Every in-scope ticket that missed a target — triage (first Severity assignment, 30 min business hours),
          first response, resolution, or communication cadence (Sev 1/2 only, provisional) — in one row. Overrides record why a miss is not a real miss.
          First-response misses are counted on customer-initiated tickets only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Tickets with a miss: <span className="font-medium text-foreground">{summary.tickets}</span>
          {" · "}Total misses: <span className="font-medium text-foreground">{summary.misses}</span>
          {" · "}Excused: <span className="font-medium text-foreground">{summary.excused}</span>
          {" · "}Unexcused: <span className="font-medium text-foreground">{summary.unexcused}</span>
          {" · "}Override rate: <span className="font-medium text-foreground">{summary.pct == null ? "—" : `${summary.pct.toFixed(0)}%`}</span>
        </div>

        {summary.byReason.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {summary.byReason.map(([reason, n]) => (
              <Badge key={reason} variant="secondary" className="text-[11px] font-normal">
                {REASON_LABELS[reason]} · {n}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="text-xs font-medium text-foreground hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"} Violation detail ({rows.length} tickets)
          </button>
          {open && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={hideExcused} onCheckedChange={setHideExcused} />
                Hide fully-excused tickets
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as ViolSortKey)}>
                  <SelectTrigger className="h-7 w-[220px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VIOL_SORT_LABELS) as ViolSortKey[]).map((k) => (
                      <SelectItem key={k} value={k} className="text-xs">{VIOL_SORT_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </>
          )}
        </div>

        {open && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Ticket</th>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Sev</th>
                  <th className="text-left px-3 py-2 font-medium">Triage</th>
                  <th className="text-left px-3 py-2 font-medium">First response</th>
                  <th className="text-left px-3 py-2 font-medium">Resolution</th>
                  <th className="text-left px-3 py-2 font-medium">Cadence</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const row = v.row;
                  const cid = row.intercom_conversation_id;
                  const key = row.customer_key?.trim() || "";
                  const customer = key ? (customerLabels.get(key) ?? key) : "—";
                  const openExcuse = (metric: ViolMetric, suggestedReason?: SlaOverrideReason) =>
                    setExcuseTarget({ cid, metric, subject: row.subject, suggestedReason });
                  const cadTarget = v.severity == null ? null : (row.policy.cadence?.[v.severity] ?? null);
                  const cadBusiness = cadTarget?.clock === "business";
                  const cadFmt = cadBusiness ? formatBusinessDuration : formatDuration;
                  const cadValue = cadBusiness ? row.sla.cadenceMaxGapBusinessHoursS : row.sla.cadenceMaxGapS;
                  const cadOverlap = row.sla.cadenceMaxGapOverlappedCustomerWait;
                  const removeOverride = async (metric: ViolMetric) => {
                    if (!isAdmin) { toast({ title: "Admin only", description: "You need the admin role to remove overrides." }); return; }
                    const { error } = await supabase
                      .from("sla_violation_overrides" as any)
                      .delete()
                      .eq("intercom_conversation_id", cid)
                      .eq("metric", metric);
                    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
                    else { refreshOverrides(); toast({ title: "Override removed" }); }
                  };
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 max-w-[300px]">
                        <a
                          href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${cid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground hover:underline block truncate"
                          title={displaySubject(row, "")}
                        >
                          {displaySubject(row, `Intercom #${cid}`)}
                        </a>
                        <span className="text-[11px] text-muted-foreground tabular-nums">#{cid}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {row.sla.answeredBeforeClassified && (
                            <Badge variant="outline" className="text-[10px] font-normal">answered before Sev</Badge>
                          )}
                          {row.sla.severityRecordedAtClose && (
                            <Badge variant="outline" className="text-[10px] font-normal">Sev at close</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 max-w-[160px] truncate" title={customer}>{customer}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        <div>{v.severity == null ? "—" : `Sev ${v.severity}`}</div>
                        <button
                          className="mt-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                          onClick={() => setSevTarget({ cid, subject: row.subject })}
                        >
                          Check severity
                        </button>
                      </td>

                      <MetricCell
                        miss={v.triageMiss}
                        measured={formatBusinessDuration(row.sla.timeToTriageBusinessHoursS)}
                        secondary={`${formatDuration(row.sla.timeToTriageS)} cal`}
                        target={formatBusinessDuration(row.policy.triageTargetS, bizDay(row.policy))}
                        clock="business hrs"
                        notEvaluable={row.sla.timeToTriageBusinessHoursS == null}
                        excused={isExcused(cid, "triage")}
                        override={getOverride(cid, "triage")}
                        isAdmin={isAdmin}
                        onExcuse={() => openExcuse("triage")}
                        onRemove={() => removeOverride("triage")}
                      />

                      <MetricCell
                        miss={v.frMiss}
                        measured={(v.compliance?.firstResponse.clock === "business" ? formatBusinessDuration : formatDuration)(v.compliance?.firstResponse.value ?? null)}
                        target={(v.compliance?.firstResponse.clock === "business" ? formatBusinessDuration : formatDuration)(v.compliance?.firstResponse.target ?? null)}
                        clock={v.compliance?.firstResponse.clock === "business" ? "business hrs" : "calendar"}
                        notEvaluable={v.compliance?.firstResponse.met == null}
                        excused={isExcused(cid, "first_response")}
                        override={getOverride(cid, "first_response")}
                        isAdmin={isAdmin}
                        onExcuse={() => openExcuse("first_response")}
                        onRemove={() => removeOverride("first_response")}
                      />

                      <MetricCell
                        miss={v.resMiss}
                        measured={(v.compliance?.resolution.clock === "business" ? formatBusinessDuration : formatDuration)(v.compliance?.resolution.value ?? null)}
                        target={(v.compliance?.resolution.clock === "business" ? formatBusinessDuration : formatDuration)(v.compliance?.resolution.target ?? null)}
                        clock={v.compliance?.resolution.clock === "business" ? "business hrs" : "calendar"}
                        notEvaluable={v.compliance?.resolution.met == null}
                        excused={isExcused(cid, "resolution")}
                        override={getOverride(cid, "resolution")}
                        isAdmin={isAdmin}
                        onExcuse={() => openExcuse("resolution")}
                        onRemove={() => removeOverride("resolution")}
                      />

                      {cadTarget == null ? (
                        <td className="px-3 py-2 text-xs text-muted-foreground">no target</td>
                      ) : (
                        <MetricCell
                          miss={v.cadenceMiss}
                          measured={cadFmt(cadValue)}
                          secondary={`${row.sla.cadenceUpdateCount} update${row.sla.cadenceUpdateCount === 1 ? "" : "s"}${cadOverlap ? " · overlapped customer-wait" : ""}`}
                          target={cadFmt(cadTarget.maxGapS)}
                          clock={cadBusiness ? "business hrs" : "calendar"}
                          notEvaluable={evaluateCadence(row.sla, v.severity!, cadTarget.maxGapS) == null}
                          excused={isExcused(cid, "cadence")}
                          override={getOverride(cid, "cadence")}
                          isAdmin={isAdmin}
                          onExcuse={() => openExcuse("cadence", cadOverlap ? "customer_hold" : undefined)}
                          onRemove={() => removeOverride("cadence")}
                        />
                      )}
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-xs">No violations in this population.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Triage = time from SLA clock start to the first Severity assignment, business hours, 30-minute target.
          First response and resolution use their per-severity targets and clocks (Sev 1 wall-clock 24/7; Sev 2–4 Europe/Berlin business hours).
          Communication cadence (PROVISIONAL, drumbeat model incl. tail gap) = the worst gap between proactive updates; Sev 1 target 1h wall-clock, Sev 2 target 4h business hours. Sev 3/4 carry no cadence commitment and never show a cadence violation; non-evaluable tickets are never scored as a miss.
          Cells that met their target show the measured value in grey; red values are misses. "Not evaluable" means the metric could not be measured for that ticket.
        </p>
      </CardContent>
      <ExcuseDialog
        target={excuseTarget}
        onClose={() => setExcuseTarget(null)}
        onSaved={() => { refreshOverrides(); setExcuseTarget(null); }}
      />
    </Card>
  );
}

// --- One metric cell inside a violation row ---
function MetricCell({
  miss, measured, secondary, target, clock, notEvaluable, excused, override, isAdmin, onExcuse, onRemove,
}: {
  miss: boolean;
  measured: string;
  secondary?: string;
  target: string;
  clock: string;
  notEvaluable: boolean;
  excused: boolean;
  override: SlaOverride | undefined;
  isAdmin: boolean;
  onExcuse: () => void;
  onRemove: () => void;
}) {
  if (!miss) {
    if (notEvaluable) {
      return <td className="px-3 py-2 text-xs text-muted-foreground">not evaluable</td>;
    }
    return (
      <td className="px-3 py-2">
        <div className="tabular-nums font-medium text-muted-foreground">{measured}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">vs {target} · {clock}</div>
        {secondary && <div className="text-[11px] text-muted-foreground tabular-nums">{secondary}</div>}
      </td>
    );
  }

  return (
    <td className={`px-3 py-2 ${excused ? "opacity-60" : ""}`}>
      <div className={`tabular-nums font-medium ${excused ? "text-muted-foreground line-through" : "text-destructive"}`}>
        {measured}
      </div>
      <div className="text-[11px] text-muted-foreground tabular-nums">
        vs {target} · {clock}
      </div>
      {secondary && <div className="text-[11px] text-muted-foreground tabular-nums">{secondary}</div>}
      <div className="mt-1">
        <ExcuseCell
          excused={excused}
          override={override}
          isAdmin={isAdmin}
          onExcuse={onExcuse}
          onRemove={onRemove}
        />
      </div>
    </td>
  );
}

