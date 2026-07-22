import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  type DateWindow,
  WINDOW_LABELS,
  WINDOW_CAPTIONS,
  windowStartMs,
  rowClosedAtMs,
} from "@/lib/slaWindow";


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

const UNATTRIBUTED = "__unattributed__";
const ALL_CUSTOMERS = "__all__";

export default function SlaDashboard() {
  const [showTestData, setShowTestData] = useState(false);
  const { loading, error, inScope, excluded, noCustomer, manuallyLogged, refresh, isExcused, customerLabels } = useSlaBatch({ showTestData });
  const [dateWindow, setDateWindow] = useState<DateWindow>("month");
  const [customerFilter, setCustomerFilter] = useState<string>(ALL_CUSTOMERS);

  // Filter in-scope rows to selected window by finalized/close date.
  const windowedInScopeDate = useMemo(() => {
    const startMs = windowStartMs(dateWindow, new Date());
    if (startMs == null) return inScope;
    return inScope.filter((r) => {
      const t = rowClosedAtMs(r);
      return t != null && t >= startMs;
    });
  }, [inScope, dateWindow]);

  // Distinct customers present in the date-filtered in-scope set (for the selector).
  const customerOptions = useMemo(() => {
    const keys = new Set<string>();
    let hasUnattributed = false;
    for (const r of windowedInScopeDate) {
      const k = r.customer_key?.trim();
      if (k) keys.add(k); else hasUnattributed = true;
    }
    const opts = Array.from(keys).map((k) => ({
      value: k,
      label: customerLabels.get(k) ?? k,
    }));
    opts.sort((a, b) => a.label.localeCompare(b.label));
    if (hasUnattributed) opts.push({ value: UNATTRIBUTED, label: "Unattributed" });
    return opts;
  }, [windowedInScopeDate, customerLabels]);

  // Compose customer filter on top of the date filter.
  const windowedInScope = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return windowedInScopeDate;
    if (customerFilter === UNATTRIBUTED) {
      return windowedInScopeDate.filter((r) => !r.customer_key || !r.customer_key.trim());
    }
    return windowedInScopeDate.filter((r) => r.customer_key === customerFilter);
  }, [windowedInScopeDate, customerFilter]);

  const selectedCustomerLabel =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customerFilter === UNATTRIBUTED
        ? "Unattributed"
        : customerLabels.get(customerFilter) ?? customerFilter;

  // Bucket by severity, evaluate compliance per row (single computation reused below).
  const { buckets, unclassified, classifiedCount } = useMemo(() => {
    const buckets: Record<Severity, Array<{ row: SlaBatchEnriched; compliance: SlaCompliance }>> = {
      1: [], 2: [], 3: [], 4: [],
    };
    const unclassified: SlaBatchEnriched[] = [];
    let classifiedCount = 0;
    for (const r of windowedInScope) {
      const sev = parseSeverity(r.raw_payload?.custom_attributes?.Severity);
      if (sev == null) { unclassified.push(r); continue; }
      classifiedCount++;
      buckets[sev].push({ row: r, compliance: evaluateCompliance(r.sla, sev) });
    }
    return { buckets, unclassified, classifiedCount };
  }, [windowedInScope]);

  const total = windowedInScope.length;
  const coveragePct = total ? (classifiedCount / total) * 100 : 0;

  // Per-severity summary at customer-initiated basis (the honest default).
  const severityRows = useMemo(() => {
    return ([1, 2, 3, 4] as const).map((sev) => {
      const rows = buckets[sev];
      let frMet = 0, frBreach = 0, frExcused = 0, resMet = 0, resBreach = 0, resExcused = 0;
      for (const { row, compliance } of rows) {
        if (row.sla.initiatedBy === "customer") {
          if (compliance.firstResponse.met === true) frMet++;
          else if (compliance.firstResponse.met === false) {
            if (isExcused(row.intercom_conversation_id, "first_response")) frExcused++;
            else frBreach++;
          }
        }
        if (compliance.resolution.met === true) resMet++;
        else if (compliance.resolution.met === false) {
          if (isExcused(row.intercom_conversation_id, "resolution")) resExcused++;
          else resBreach++;
        }
      }
      const frDenom = frMet + frBreach;
      const resDenom = resMet + resBreach;
      return {
        sev,
        n: rows.length,
        target: SLA_TARGETS[sev],
        frPct: frDenom ? (frMet / frDenom) * 100 : null,
        frBreach,
        frExcused,
        resPct: resDenom ? (resMet / resDenom) * 100 : null,
        resBreach,
        resExcused,
      };
    });
  }, [buckets, isExcused]);




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

        {/* Date window selector + population chips */}
        <div className="flex flex-col gap-2">
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
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-foreground">
              <span className="font-semibold tabular-nums">{total}</span> in-scope
              <span className="text-muted-foreground"> · {WINDOW_CAPTIONS[dateWindow]}</span>
              {selectedCustomerLabel && (
                <span className="text-muted-foreground"> · customer: <span className="text-foreground font-medium">{selectedCustomerLabel}</span></span>
              )}
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
            {total === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No tickets resolved in this window.
              </div>
            ) : (
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
                              <Link to="/sla-workbench" title="View breach detail in the Workbench">
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-80">
                                  {r.frBreach} breach{r.frBreach === 1 ? "" : "es"}
                                </Badge>
                              </Link>
                            )}
                            {r.frExcused > 0 && (
                              <span className="text-[10px] text-muted-foreground">· {r.frExcused} excused</span>
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
                                  <Link to="/sla-workbench" title="View breach detail in the Workbench">
                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 cursor-pointer hover:opacity-80">
                                      {r.resBreach} breach{r.resBreach === 1 ? "" : "es"}
                                    </Badge>
                                  </Link>
                                )}
                                {r.resExcused > 0 && (
                                  <span className="text-[10px] text-muted-foreground">· {r.resExcused} excused</span>
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
            )}
          </CardContent>
        </Card>

      </div>
    </AppLayout>
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
