import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Gauge, Info, RefreshCw } from "lucide-react";
import {
  evaluateCompliance,
  formatBusinessDuration,
  formatDuration,
  parseSeverity,
  SLA_TARGETS,
  type Severity,
  type SlaCompliance,
} from "@/lib/slaMetrics";
import { useSlaBatch, type SlaBatchEnriched } from "@/hooks/useSlaBatch";


// Compliance color tone from a percentage — always paired with the visible number.
function toneFor(pct: number | null): { text: string; bg: string; label: string } {
  if (pct == null) return { text: "text-muted-foreground", bg: "bg-muted/40", label: "n/a" };
  if (pct >= 90) return { text: "text-foreground", bg: "bg-primary/10", label: "healthy" };
  if (pct >= 75) return { text: "text-foreground", bg: "bg-amber-500/15", label: "warning" };
  return { text: "text-destructive", bg: "bg-destructive/10", label: "breach" };
}

function formatTarget(sec: number | null, clock: "business" | "calendar"): string {
  if (sec == null) return "best-effort";
  return `${(clock === "business" ? formatBusinessDuration : formatDuration)(sec)} (${clock === "business" ? "bh" : "cal"})`;
}

export default function SlaDashboard() {
  const { loading, error, inScope, excluded, noCustomer, manuallyLogged, refresh } = useSlaBatch();

  // Bucket by severity, evaluate compliance per row (single computation reused below).
  const { buckets, unclassified, classifiedCount } = useMemo(() => {
    const buckets: Record<Severity, Array<{ row: SlaBatchEnriched; compliance: SlaCompliance }>> = {
      1: [], 2: [], 3: [], 4: [],
    };
    const unclassified: SlaBatchEnriched[] = [];
    let classifiedCount = 0;
    for (const r of inScope) {
      const sev = parseSeverity(r.raw_payload?.custom_attributes?.Severity);
      if (sev == null) { unclassified.push(r); continue; }
      classifiedCount++;
      buckets[sev].push({ row: r, compliance: evaluateCompliance(r.sla, sev) });
    }
    return { buckets, unclassified, classifiedCount };
  }, [inScope]);

  const total = inScope.length;
  const coveragePct = total ? (classifiedCount / total) * 100 : 0;

  // Per-severity summary at customer-initiated basis (the honest default).
  const severityRows = useMemo(() => {
    return ([1, 2, 3, 4] as const).map((sev) => {
      const rows = buckets[sev];
      let frMet = 0, frBreach = 0, resMet = 0, resBreach = 0;
      for (const { row, compliance } of rows) {
        if (row.sla.initiatedBy === "customer") {
          if (compliance.firstResponse.met === true) frMet++;
          else if (compliance.firstResponse.met === false) frBreach++;
        }
        if (compliance.resolution.met === true) resMet++;
        else if (compliance.resolution.met === false) resBreach++;
      }
      const frDenom = frMet + frBreach;
      const resDenom = resMet + resBreach;
      return {
        sev,
        n: rows.length,
        target: SLA_TARGETS[sev],
        frPct: frDenom ? (frMet / frDenom) * 100 : null,
        frBreach,
        resPct: resDenom ? (resMet / resDenom) * 100 : null,
        resBreach,
      };
    });
  }, [buckets]);




  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Gauge className="h-3.5 w-3.5" /> Enterprise support
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">SLA Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Compliance vs proposed SLA targets across the full finalized enterprise population.
              First-response %met is scoped to customer-initiated tickets.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <MeasurementInfoPopover />
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
        )}

        {/* Population chips */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="text-foreground">
            <span className="font-semibold tabular-nums">{total}</span> in-scope
          </span>
          <span className="text-foreground">
            Severity coverage: <span className="font-semibold tabular-nums">{coveragePct.toFixed(0)}%</span>
          </span>
          <span className="text-muted-foreground">
            Excluded: <span className="tabular-nums">{excluded.length}</span>
          </span>
          <span className="text-muted-foreground">
            Internal / no-customer: <span className="tabular-nums">{noCustomer.length}</span>
          </span>
          <span className="text-muted-foreground">
            Manually-logged: <span className="tabular-nums">{manuallyLogged.length}</span>
          </span>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {/* Compliance scorecard */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Compliance scorecard</CardTitle>
            <CardDescription>
              Per-severity, customer-initiated first-response · resolution stop-the-clock. Change the basis in the Workbench.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Severity</th>
                    <th className="text-right px-4 py-2 font-medium">n</th>
                    <th className="text-left px-4 py-2 font-medium">First response</th>
                    <th className="text-left px-4 py-2 font-medium">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {severityRows.map((r) => {
                    const frTone = toneFor(r.frPct);
                    const resTone = r.sev === 4 ? toneFor(null) : toneFor(r.resPct);
                    return (
                      <tr key={r.sev} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">Sev {r.sev}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.n}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center rounded px-2 py-0.5 text-sm font-semibold tabular-nums ${frTone.bg} ${frTone.text}`}>
                              {r.frPct == null ? "—" : `${r.frPct.toFixed(0)}%`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              · target {formatTarget(r.target.firstResponseS, r.target.firstResponseClock)}
                            </span>
                            {r.frBreach > 0 && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                {r.frBreach} breach{r.frBreach === 1 ? "" : "es"}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {r.sev === 4 ? (
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-sm text-muted-foreground italic bg-muted/40">
                                best-effort
                              </span>
                            ) : (
                              <>
                                <span className={`inline-flex items-center rounded px-2 py-0.5 text-sm font-semibold tabular-nums ${resTone.bg} ${resTone.text}`}>
                                  {r.resPct == null ? "—" : `${r.resPct.toFixed(0)}%`}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  · target {formatTarget(r.target.resolutionS, r.target.resolutionClock)}
                                </span>
                                {r.resBreach > 0 && (
                                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                    {r.resBreach} breach{r.resBreach === 1 ? "" : "es"}
                                  </Badge>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {unclassified.length > 0 && (
                    <tr className="border-t border-border bg-muted/20 text-muted-foreground">
                      <td className="px-4 py-3 italic">Unclassified (no severity)</td>
                      <td className="px-4 py-3 text-right tabular-nums">{unclassified.length}</td>
                      <td className="px-4 py-3 text-xs">—</td>
                      <td className="px-4 py-3 text-xs">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Breaches surfaced */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BreachPanel
            title={`First-response breaches (${frBreaches.length})`}
            subtitle="Customer-initiated tickets whose first human reply exceeded the target."
            kind="fr"
            items={frBreaches}
          />
          <BreachPanel
            title={`Resolution breaches (${resBreaches.length})`}
            subtitle="Stop-the-clock resolution (Sev 1–3). Sorted worst-first."
            kind="res"
            items={resBreaches}
          />
        </div>

        {/* Timing tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Human first reply · bus.hrs"
            desc="firstHumanReplyFromInbox (Europe/Berlin business hours)"
            agg={kpis.humanBH}
            emphasize
          />
          <KpiCard
            title="Human first reply · calendar"
            desc="firstHumanReplyFromInbox (wall clock)"
            agg={kpis.humanCal}
          />
          <KpiCard
            title="Time to resolve · bus.hrs"
            desc="ttr (Europe/Berlin business hours)"
            agg={kpis.ttrBH}
          />
          <KpiCard
            title="Pre-inbox time"
            desc="from ticket creation to Enterprise Inbox assignment — process signal, not an SLA"
            agg={kpis.preInbox}
          />
        </div>
      </div>
    </AppLayout>
  );
}

function BreachPanel({
  title,
  subtitle,
  kind,
  items,
}: {
  title: string;
  subtitle: string;
  kind: "fr" | "res";
  items: Array<{ row: SlaBatchEnriched; compliance: SlaCompliance }>;
}) {
  const VISIBLE = 8;
  const shown = items.slice(0, VISIBLE);
  const remaining = Math.max(0, items.length - shown.length);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">No breaches. ✓</div>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map(({ row, compliance }) => {
              const c = kind === "fr" ? compliance.firstResponse : compliance.resolution;
              const fmt = c.clock === "business" ? formatBusinessDuration : formatDuration;
              return (
                <li key={row.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <a
                      href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${row.intercom_conversation_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-foreground hover:underline inline-flex items-center gap-1 truncate max-w-full"
                      title={row.subject ?? ""}
                    >
                      <span className="truncate">{row.subject || `Intercom #${row.intercom_conversation_id}`}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Sev {compliance.severity} · {c.clock === "business" ? "business hours" : "calendar"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-destructive tabular-nums">{fmt(c.value)}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">target {fmt(c.target)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {remaining > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border bg-muted/20">
            +{remaining} more —{" "}
            <Link to="/sla-workbench" className="text-foreground hover:underline">see Workbench</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MeasurementInfoPopover() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info className="h-4 w-4 mr-1.5" /> How these are measured
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] text-sm space-y-2">
        <div>
          <div className="font-semibold text-foreground">Inbox-anchored clock</div>
          <p className="text-xs text-muted-foreground">
            All SLA timers start at Enterprise Inbox assignment (Intercom team 8484447). Pre-Enterprise and
            Sam AI handling time are excluded from SLA and reported separately as <em>pre-inbox time</em>.
          </p>
        </div>
        <div>
          <div className="font-semibold text-foreground">First response</div>
          <p className="text-xs text-muted-foreground">
            First <em>human</em> reply from inbox assignment. On tickets with an AI-to-human handoff the clock
            anchors on the handoff, not initial routing.
          </p>
        </div>
        <div>
          <div className="font-semibold text-foreground">Resolution (stop-the-clock)</div>
          <p className="text-xs text-muted-foreground">
            Time waiting on the customer is excluded from resolution — industry-standard active handling time.
          </p>
        </div>
        <div>
          <div className="font-semibold text-foreground">Business hours</div>
          <p className="text-xs text-muted-foreground">
            Europe/Berlin, Mon–Fri 09:00–24:00, DST-aware. 1 business day = 15h. Company holidays not yet modeled.
          </p>
        </div>
        <div>
          <div className="font-semibold text-foreground">Targets</div>
          <p className="text-xs text-muted-foreground">
            Provisional per-severity SLA targets. Sev 1 uses calendar clock; Sev 2–4 use business hours.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
