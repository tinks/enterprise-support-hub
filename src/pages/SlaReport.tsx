import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { PolicyFallbackBanner } from "@/components/sla/PolicyFallbackBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TestDataToggle, TestDataBanner } from "@/pages/SlaWorkbench";
import { useSlaBatch, type SlaBatchEnriched, type SlaOverrideMetric } from "@/hooks/useSlaBatch";

import {
  aggregate,
  evaluateCadence,
  evaluateCompliance,
  formatDuration,
  parseSeverity,
  type SlaPolicy,
  type ComplianceVerdict,
  type Severity,
  type SlaCompliance,
} from "@/lib/slaMetrics";

import { rowClosedAtMs } from "@/lib/slaWindow";
import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { PLAN_LABEL, inPlanScope, type PlanScope } from "@/lib/planTier";

// ---------------------------------------------------------------------------
// READ-ONLY Monthly SLA Report. This is a DATA-BACKED PROPOSAL: the targets in
// SLA_TARGETS are PROVISIONAL, so every "% met" is framed as "vs PROPOSED
// target" and the distribution stats (median/p90) are the headline evidence.
// No engine or resolver changes — everything is derived from useSlaBatch.
// ---------------------------------------------------------------------------

type Scored = { row: SlaBatchEnriched; comp: SlaCompliance };
type Metric = SlaOverrideMetric; // "first_response" | "resolution"

type MetricStats = {
  n: number;
  met: number;
  breach: number;
  excused: number;
  notEvaluable: number;
  pct: number | null;
  avg: number | null;
  median: number | null;
  p90: number | null;
};

function verdict(c: SlaCompliance, m: Metric): ComplianceVerdict {
  return m === "first_response" ? c.firstResponse : c.resolution;
}

// Work-Before-Ticket detail now lives on the SLA Workbench.


function computeStats(
  rows: Scored[],
  m: Metric,
  isExcused: (cid: string, metric: Metric) => boolean,
): MetricStats {
  // First response is scoped to customer-initiated tickets only — matching the
  // SLA Dashboard/Workbench "customer" basis. Agent-opened tickets have no
  // customer waiting, so an FR clock is meaningless there. Resolution counts all.
  const scope = m === "first_response"
    ? rows.filter((r) => r.row.sla.initiatedBy === "customer")
    : rows;
  let met = 0, breach = 0, excused = 0, notEvaluable = 0;
  for (const { row, comp } of scope) {
    const v = verdict(comp, m);
    if (v.met === true) met++;
    else if (v.met === false) {
      if (isExcused(row.intercom_conversation_id, m)) excused++;
      else breach++;
    } else notEvaluable++;
  }
  const denom = met + breach;
  const agg = aggregate(scope.map((r) => verdict(r.comp, m).value));
  return {
    n: scope.length, met, breach, excused, notEvaluable,
    pct: denom ? (met / denom) * 100 : null,
    avg: agg.avg, median: agg.median, p90: agg.p90,
  };
}

function sourceBucket(r: SlaBatchEnriched): "Slack" | "Sam-first" | "Direct" {
  if (r.origin === "slack") return "Slack";
  if (r.sla.flags.samParticipated) return "Sam-first";
  return "Direct";
}

function monthOptions(now: Date): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleString("en-US", { month: "long", year: "numeric" }) });
  }
  return out;
}

function monthRange(key: string): { start: number; end: number } {
  const [y, m] = key.split("-").map(Number);
  return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() };
}

function pctText(p: number | null) {
  return p == null ? "—" : `${p.toFixed(1)}%`;
}

export default function SlaReport() {
  const [showTestData, setShowTestData] = useState(false);
  // SSE carries NO first-response commitment, so mixing it into compliance rates
  // understates them. The SLA surfaces therefore default to Enterprise only.
  const [planScope, setPlanScope] = useState<PlanScope>("enterprise");
  const now = new Date();
  const months = useMemo(() => monthOptions(now), [now.getFullYear(), now.getMonth()]);
  const [month, setMonth] = useState(months[0].value);

  const batch = useSlaBatch({ showTestData });
  const { loading, error, inScope, excluded, noCustomer, manuallyLogged, isExcused, getOverride, customerLabels, activePolicy, policyFallback, policyError } = batch;

  const { start, end } = useMemo(() => monthRange(month), [month]);
  const inMonth = <T extends { intercom_closed_at?: string | null; raw_payload?: any }>(r: T) => {
    const t = rowClosedAtMs(r as any);
    return t != null && t >= start && t < end;
  };

  // SSE has no first-response or resolution commitment, so on that scope the
  // compliance panels are replaced by an explicit note rather than showing 0%.
  const sseScope = planScope === "sse";
  const inPlan = <T extends { plan_tier?: string | null }>(r: T) => inPlanScope(r.plan_tier, planScope);
  const population = useMemo(() => inScope.filter((r) => inMonth(r) && inPlan(r)), [inScope, start, end, planScope]);
  const monthExcluded = useMemo(() => excluded.filter((r) => inMonth(r) && inPlan(r)), [excluded, start, end, planScope]);
  const monthNoCustomer = useMemo(() => noCustomer.filter((r) => inMonth(r) && inPlan(r)), [noCustomer, start, end, planScope]);
  const monthManual = useMemo(() => manuallyLogged.filter((r) => inMonth(r) && inPlan(r)), [manuallyLogged, start, end, planScope]);

  // Severity split — unclassified rows stay in the population but cannot be scored.
  const { bySev, unclassified, scored } = useMemo(() => {
    const bySev: Record<Severity, Scored[]> = { 1: [], 2: [], 3: [], 4: [] };
    const unclassified: SlaBatchEnriched[] = [];
    const scored: Scored[] = [];
    for (const r of population) {
      const sev = parseSeverity(r.raw_payload?.custom_attributes?.["Severity"]);
      if (sev == null) { unclassified.push(r); continue; }
      const s: Scored = { row: r, comp: evaluateCompliance(r.sla, sev, r.policy.targets) };
      bySev[sev].push(s);
      scored.push(s);
    }
    return { bySev, unclassified, scored };
  }, [population]);

  const overallFr = computeStats(scored, "first_response", isExcused);
  const overallRes = computeStats(scored, "resolution", isExcused);

  // Exclusion reasons by reason now live on the Workbench (practitioner detail).

  const bySource = useMemo(() => {
    const keys = ["Slack", "Sam-first", "Direct"] as const;
    return keys.map((k) => {
      const rows = scored.filter((s) => sourceBucket(s.row) === k);
      return {
        key: k,
        n: rows.length,
        fr: computeStats(rows, "first_response", isExcused),
        res: computeStats(rows, "resolution", isExcused),
        preInboxMedian: aggregate(rows.map((r) => r.row.sla.preInboxTimeS)).median,
      };
    });
  }, [scored, isExcused]);

  // --- Triage time (MEASURE-FIRST, no target) -----------------------------
  // Inbox-anchor → first Severity assignment. Severity-agnostic, so it is the
  // one metric that legitimately supports a single global number. Only rows
  // that actually carry a Severity event are evaluable — event_details capture
  // began ~2026-07-15, so earlier-closed tickets are structurally not-evaluable.
  const triage = useMemo(() => {
    const evaluable = population.filter((r) => r.sla.hasSeverityEvent && r.sla.timeToTriageS != null);
    const wall = aggregate(evaluable.map((r) => r.sla.timeToTriageS));
    const bh = aggregate(evaluable.map((r) => r.sla.timeToTriageBusinessHoursS));
    const groups = new Map<string, SlaBatchEnriched[]>();
    for (const r of evaluable) {
      const sev = parseSeverity(r.raw_payload?.custom_attributes?.["Severity"]);
      const key = sev == null ? "unclassified" : String(sev);
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const bySeverity = ["1", "2", "3", "4", "unclassified"].map((key) => {
      const rows = groups.get(key) ?? [];
      const a = aggregate(rows.map((r) => r.sla.timeToTriageBusinessHoursS));
      return { key, n: rows.length, median: a.median, avg: a.avg };
    });
    const reclassified = evaluable.filter((r) => (r.sla.severityEventCount ?? 0) > 1).length;
    const n = evaluable.length;
    const violations = evaluable.filter((r) => r.sla.triageViolation).length;
    const answeredFirst = evaluable.filter((r) => r.sla.answeredBeforeClassified).length;
    const atClose = evaluable.filter((r) => r.sla.severityRecordedAtClose).length;
    return {
      n,
      m: population.length,
      wall,
      bh,
      bySeverity,
      reclassified,
      discipline: { violations, answeredFirst, atClose },
    };


  }, [population]);

  // --- Communication cadence (PROVISIONAL, drumbeat) ------------------------
  // Proactive-update frequency during an active incident. Bound to Sev1/Sev2
  // ONLY (CADENCE_TARGETS) — Sev3/Sev4 carry no cadence commitment and must
  // render as "no target", never 0%. Evaluable = the ticket has a cadence
  // window (at least one Lovable public update before close); rows without one
  // are excluded from the denominator, never defaulted to met or breached.
  const cadence = useMemo(() => {
    return ([1, 2, 3, 4] as Severity[]).map((sev) => {
      const target = activePolicy.cadence?.[sev] ?? null;
      const rows = bySev[sev].map((s) => s.row);
      if (!target) {
        return {
          sev, target, m: rows.length, n: 0, met: 0, breach: 0,
          pct: null as number | null, median: null as number | null,
          p90: null as number | null, longest: null as number | null, overlapped: 0,
        };
      }
      const evaluable = rows.filter((r) => r.sla.hasCadence);
      const values = evaluable.map((r) =>
        target.clock === "business" ? r.sla.cadenceMaxGapBusinessHoursS : r.sla.cadenceMaxGapS,
      );
      const agg = aggregate(values);
      const nums = values.filter((v): v is number => v != null);
      let met = 0, breach = 0, overlapped = 0;
      for (const r of evaluable) {
        const v = evaluateCadence(r.sla, sev, r.policy.cadence?.[sev]?.maxGapS);
        if (v === true) met++;
        else if (v === false) {
          breach++;
          if (r.sla.cadenceMaxGapOverlappedCustomerWait) overlapped++;
        }
      }
      const denom = met + breach;
      return {
        sev, target, m: rows.length, n: denom, met, breach,
        pct: denom ? (met / denom) * 100 : null,
        median: agg.median, p90: agg.p90,
        longest: nums.length ? Math.max(...nums) : null,
        overlapped,
      };
    });
  }, [bySev, activePolicy]);



  const monthLabel = months.find((m) => m.value === month)?.label ?? month;


  return (
    <AppLayout>
      <div className="max-w-[1200px] mx-auto p-6 space-y-6">
        <PolicyFallbackBanner show={policyFallback} error={policyError} />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Monthly SLA Report</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Read-only. Population = all tickets finalized in the selected month (no owner filter). Plan scope:{" "}
              <span className="font-medium text-foreground">{PLAN_LABEL[planScope]}</span>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <PlanScopeSelect value={planScope} onChange={setPlanScope} className="w-[220px] h-10" />
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <TestDataToggle showTestData={showTestData} onChange={setShowTestData} />
          </div>
        </div>

        <div className="rounded-md border-2 border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <div className="font-semibold">Proposed SLA targets — performance baseline for calibration, not committed-SLA compliance.</div>
          <div className="text-muted-foreground text-xs mt-1">
            Every "% met" below is measured <strong>vs a PROPOSED target</strong>. The distribution stats
            (median / p90) are the headline evidence for where targets could reasonably be set.
            Basis: each severity's proposed clock (Sev 1 = calendar 24/7, Sev 2–4 = Berlin business hours Mon–Fri 09:00–24:00).
          </div>
        </div>

        {showTestData && <TestDataBanner />}
        {loading && <div className="text-sm text-muted-foreground">Loading batch…</div>}
        {error && <div className="text-sm text-destructive">{error}</div>}

        {/* §1 Scope & Population */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§1 Scope &amp; Population — {monthLabel}</CardTitle>
            <CardDescription className="text-xs">
              Finalized-in-month (closed date). Created-in-month may be offered later.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="text-lg font-semibold tabular-nums">
              In-scope population: {population.length}
            </div>
            <div>
              <div className="font-medium mb-1">Severity reconciliation</div>
              <ul className="text-xs space-y-0.5 tabular-nums">
                {([1, 2, 3, 4] as Severity[]).map((s) => (
                  <li key={s}>Sev {s}: {bySev[s].length}</li>
                ))}
                <li>Unclassified: {unclassified.length}</li>
                <li className="pt-1 border-t border-border mt-1">
                  Sum: {bySev[1].length + bySev[2].length + bySev[3].length + bySev[4].length + unclassified.length} ={" "}
                  population {population.length}{" "}
                  {bySev[1].length + bySev[2].length + bySev[3].length + bySev[4].length + unclassified.length === population.length ? "✓" : "✗ MISMATCH"}
                </li>
              </ul>
            </div>
            {unclassified.length > 0 && (
              <div className="rounded-md border-2 border-destructive bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                Unclassified severity: {unclassified.length} (missing Severity attribute — cannot be scored)
              </div>
            )}
            <div className="text-xs tabular-nums">
              Excluded from population: {monthExcluded.length} — breakdown on the Workbench.
            </div>

            <div className="text-xs tabular-nums">
              No customer participant: {monthNoCustomer.length} · Manually-logged (bulk import, unmeasurable): {monthManual.length}
            </div>
          </CardContent>
        </Card>

        {sseScope && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-base">No SLA commitment on this plan</CardTitle>
              <CardDescription className="text-xs">
                Self-serve Enterprise carries no first-response or resolution SLA. The compliance sections
                (§2 headline, §3a/§3b by severity, §4 breaches) are hidden rather than reported as 0% —
                a target that does not exist cannot be met or breached. Triage (§2b, 1 hour target),
                cadence (§3c), source mix (§5) and the data-quality footer (§6) still apply and are shown below.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* §2 Headline */}
        {!sseScope && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§2 Headline — vs PROPOSED targets</CardTitle>
            <CardDescription className="text-xs">
              Across scored in-scope tickets. % met = met / (met + unexcused breach). Excused and
              not-evaluable are excluded from the denominator and shown separately.
              First response is scoped to customer-initiated tickets (agent-opened tickets excluded).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 text-sm">
            {[["First Response", overallFr], ["Resolution", overallRes]].map(([label, st]) => {
              const s = st as MetricStats;
              return (
                <div key={label as string} className="rounded-md border border-border p-3 space-y-1">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{label as string}</div>
                  <div className="text-2xl font-bold tabular-nums">{pctText(s.pct)}</div>
                  <div className="text-xs text-muted-foreground">met vs PROPOSED target</div>
                  <div className="text-xs tabular-nums pt-1">
                    met {s.met} · breach {s.breach} · excused {s.excused} · not-evaluable {s.notEvaluable}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        )}

        {/* §2b Triage time — MEASURE-FIRST, no target */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§2b Triage time — measure-first (no target)</CardTitle>
            <CardDescription className="text-xs">
              Enterprise-Inbox anchor → first Severity assignment. Severity-agnostic, so this is the
              one responsiveness figure that supports a single global number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide mb-2">
                Business hours (Mon–Fri 09:00–24:00 Berlin) — headline
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                {[
                  ["Median", triage.bh.median],
                  ["Average", triage.bh.avg],
                  ["p90", triage.bh.p90],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-md border border-border p-3 space-y-1">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">{label as string}</div>
                    <div className="text-2xl font-bold tabular-nums">{formatDuration(v as number | null)}</div>
                  </div>
                ))}
                <div className="rounded-md border border-border p-3 space-y-1">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">n (evaluable)</div>
                  <div className="text-2xl font-bold tabular-nums">{triage.n}</div>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border px-3 py-2 text-xs space-y-1">
              <div className="font-medium">
                Wall-clock (includes off-hours) — median{" "}
                <span className="tabular-nums">{formatDuration(triage.wall.median)}</span> · avg{" "}
                <span className="tabular-nums">{formatDuration(triage.wall.avg)}</span> · p90{" "}
                <span className="tabular-nums">{formatDuration(triage.wall.p90)}</span>
              </div>
              <div className="text-muted-foreground">
                Real and still important, but <strong>expected higher until off-hours coverage exists</strong> —
                a ticket landing overnight is not slow work, it is uncovered time.
              </div>
            </div>

            <div className="rounded-md border border-border px-3 py-2 text-xs space-y-1">
              <div className="font-medium">Triage discipline (provisional 30-min target)</div>
              <div className="grid gap-2 sm:grid-cols-3 tabular-nums">
                {[
                  ["Over target (violations)", triage.discipline.violations],
                  ["Answered before Severity assigned", triage.discipline.answeredFirst],
                  ["Severity recorded at close", triage.discipline.atClose],
                ].map(([label, count]) => (
                  <div key={label as string}>
                    <span className="text-muted-foreground">{label as string}: </span>
                    <span className="font-medium">
                      {count as number}
                      {triage.n ? ` (${(((count as number) / triage.n) * 100).toFixed(0)}%)` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-muted-foreground">
                Over the {triage.n} evaluable tickets. The 30-minute business-hours triage target is
                <strong> provisional</strong> (it should always sit at or below the strictest First-Response target);
                "at close" means the first Severity was set within 30 minutes of the ticket closing.
              </div>
            </div>



            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1">
              <div className="tabular-nums font-medium">
                Triage measurable for {triage.n} of {triage.m} in-scope tickets
                {triage.m ? ` (${((triage.n / triage.m) * 100).toFixed(0)}%)` : ""}.
              </div>
              <div className="text-muted-foreground">
                Severity-change events (<code>event_details</code>) are only captured from ~15 July 2026 onward
                (Intercom API 2.13 + one-off backfill). Tickets closed before that line-in-the-sand carry no
                Severity event and are <strong>not-evaluable</strong>, not fast. The figures above describe the
                evaluable subset only — they are not the whole population.
              </div>
            </div>

            <div>
              <div className="font-medium mb-1">By final severity (secondary, business hours)</div>

              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left border-b border-border">
                    <th className="py-1 pr-3 font-medium">Severity</th>
                    <th className="py-1 pr-3 font-medium">n</th>
                    <th className="py-1 pr-3 font-medium">Median</th>
                    <th className="py-1 pr-3 font-medium">Average</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {triage.bySeverity.map((g) => (
                    <tr key={g.key} className="border-b border-border/50">
                      <td className="py-1 pr-3">{g.key === "unclassified" ? "Unclassified" : `Sev ${g.key}`}</td>
                      <td className="py-1 pr-3">{g.n}</td>
                      <td className="py-1 pr-3">{formatDuration(g.median)}</td>
                      <td className="py-1 pr-3">{formatDuration(g.avg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-1">
                Grouped by the ticket's <em>final</em> Severity attribute. {triage.reclassified} of {triage.n} evaluable
                tickets had more than one Severity event (re-classified after first triage).
              </div>
            </div>

            <div className="rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-2 text-xs">
              <strong>Measure-first:</strong> no triage target is set yet and no compliance verdict is rendered here.
              This distribution is the basis for proposing one — the what-if slider can tune it later.
            </div>
          </CardContent>
        </Card>



        {!sseScope && (
          <SeverityTable activePolicy={activePolicy}
            title="§3a First response time by Severity"
            metric="first_response"
            bySev={bySev}
            isExcused={isExcused}
          />
        )}

        {/* §3b Communication cadence — PROVISIONAL, Sev1/Sev2 only */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§3b Communication cadence — PROVISIONAL (Sev 1 / Sev 2 only)</CardTitle>
            <CardDescription className="text-xs">
              Proactive-update frequency during an active incident. <strong>Drumbeat model</strong>: customer
              silence does <em>not</em> pause the obligation, and the window includes the tail gap
              (last Lovable update → close). Deliberately conservative — targets are{" "}
              <strong>not yet ratified</strong>, this is measure-first evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3">Sev</th>
                  <th className="py-1 pr-3">Target (clock)</th>
                  <th className="py-1 pr-3">% met</th>
                  <th className="py-1 pr-3">n evaluable</th>
                  <th className="py-1 pr-3">Median max-gap</th>
                  <th className="py-1 pr-3">p90 max-gap</th>
                  <th className="py-1 pr-3">Longest max-gap</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {cadence.map((c) => (
                  <tr key={c.sev} className="border-t border-border">
                    <td className="py-1 pr-3">Sev {c.sev}</td>
                    <td className="py-1 pr-3">
                      {c.target ? `${formatDuration(c.target.maxGapS)} (${c.target.clock})` : "no cadence target"}
                    </td>
                    <td className="py-1 pr-3">
                      {c.target ? (
                        <>
                          {pctText(c.pct)}{" "}
                          <span className="text-muted-foreground">({c.met} met / {c.breach} over)</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">not evaluated</span>
                      )}
                    </td>
                    <td className="py-1 pr-3">{c.target ? `${c.n} of ${c.m}` : "—"}</td>
                    <td className="py-1 pr-3">{c.target ? formatDuration(c.median) : "—"}</td>
                    <td className="py-1 pr-3">{c.target ? formatDuration(c.p90) : "—"}</td>
                    <td className="py-1 pr-3">{c.target ? formatDuration(c.longest) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1">
              {cadence.filter((c) => c.target).map((c) => (
                <div key={c.sev} className="tabular-nums">
                  Sev {c.sev}: cadence measurable for <strong>{c.n}</strong> of <strong>{c.m}</strong> in-scope
                  tickets{c.m ? ` (${((c.n / c.m) * 100).toFixed(0)}%)` : ""} ·{" "}
                  <span className="text-muted-foreground">
                    {c.overlapped} of {c.breach} over-target max-gaps overlapped a customer-wait period
                  </span>
                </div>
              ))}
              <div className="text-muted-foreground">
                A ticket is evaluable only if it has a cadence window (at least one Lovable public update
                before close). Tickets without one are <strong>not breaches</strong> — they are excluded from
                the denominator entirely, never defaulted to met or over-target. Sev 3 / Sev 4 have{" "}
                <strong>no cadence target by design</strong> and are not evaluated.
              </div>
            </div>

            <div className="rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-2 text-xs">
              <strong>PROVISIONAL — targets not yet ratified; drumbeat model incl. tail gap.</strong> A low
              %met here is a genuine finding (burst-then-silence during long-running tickets), not a data
              artifact. The "overlapped customer-wait" count above says how many over-target gaps happened
              while we were also waiting on the customer — under drumbeat that still counts, but it is the
              main thing to weigh when ratifying a target.
            </div>
          </CardContent>
        </Card>

        {!sseScope && (
          <SeverityTable activePolicy={activePolicy}
            title="§3c Resolution by Severity"
            metric="resolution"
            bySev={bySev}
            isExcused={isExcused}
          />
        )}





        {/* §4 Breaches */}
        {!sseScope && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§4 Breaches vs PROPOSED targets</CardTitle>
            <CardDescription className="text-xs">
              Override rate — FR: {overallFr.excused} of {overallFr.excused + overallFr.breach} excused
              {overallFr.excused + overallFr.breach ? ` (${((overallFr.excused / (overallFr.excused + overallFr.breach)) * 100).toFixed(0)}%)` : ""}
              {" · "}Res: {overallRes.excused} of {overallRes.excused + overallRes.breach} excused
              {overallRes.excused + overallRes.breach ? ` (${((overallRes.excused / (overallRes.excused + overallRes.breach)) * 100).toFixed(0)}%)` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="tabular-nums">
              First Response breaches: <strong>{overallFr.breach}</strong> · Resolution breaches: <strong>{overallRes.breach}</strong>
              <span className="text-muted-foreground"> (unexcused)</span>
            </div>
            <Link to="/sla-workbench" className="text-xs underline text-primary">
              Per-ticket breach detail + excuse/remove → SLA Workbench
            </Link>
          </CardContent>

        </Card>
        )}

        {/* §5 By Source */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§5 By Source</CardTitle>
            <CardDescription className="text-xs">
              Slack = Slack-origin; Sam-first = Sam replied publicly; Direct = everything else.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3">Source</th>
                  <th className="py-1 pr-3">n</th>
                  <th className="py-1 pr-3">FR %met</th>
                  <th className="py-1 pr-3">Res %met</th>
                  <th className="py-1 pr-3">Pre-inbox median</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {bySource.map((s) => (
                  <tr key={s.key} className="border-t border-border">
                    <td className="py-1 pr-3">{s.key}</td>
                    <td className="py-1 pr-3">{s.n}</td>
                    <td className="py-1 pr-3">{pctText(s.fr.pct)}</td>
                    <td className="py-1 pr-3">{pctText(s.res.pct)}</td>
                    <td className="py-1 pr-3">{formatDuration(s.preInboxMedian)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

          </CardContent>
        </Card>

        {/* Work-Before-Ticket detail lives on the SLA Workbench. */}



        {/* §6 Data quality */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§6 Data-Quality Footer</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1.5">
            <div>
              Coverage: {population.length - unclassified.length} of {population.length} in-scope tickets carry a
              Severity attribute and can be scored ({population.length ? (((population.length - unclassified.length) / population.length) * 100).toFixed(1) : "0.0"}%).
            </div>
            <div>Granular exclusion + not-evaluable breakdowns live on the SLA Workbench.</div>

            <div>Targets are PROVISIONAL/PROPOSED — this report is calibration evidence, not committed-SLA compliance.</div>
            <div>First reporting month has no trend line; comparisons become meaningful once several months exist.</div>
            <div>Sam-anchored tickets: SLA clocks start at Enterprise Inbox assignment, so resolution reflects post-handoff time only. Pre-inbox time is reported separately.</div>
            <div>Sev 4 resolution has no committed target — best-effort; distribution shown for visibility only.</div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function SeverityTable({
  title, metric, bySev, isExcused, activePolicy,
}: {
  title: string;
  metric: Metric;
  bySev: Record<Severity, Scored[]>;
  isExcused: (cid: string, m: Metric) => boolean;
  activePolicy: SlaPolicy;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title} — vs PROPOSED targets</CardTitle>
        <CardDescription className="text-xs">
          % met = met / (met + unexcused breach). Median / p90 are the calibration evidence.
          {metric === "first_response" && " First response is scoped to customer-initiated tickets (agent-opened tickets excluded)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3">Sev</th>
              <th className="py-1 pr-3">n</th>
              <th className="py-1 pr-3">Target (clock)</th>
              <th className="py-1 pr-3">% met (breach / excused)</th>
              <th className="py-1 pr-3">not-evaluable</th>
              <th className="py-1 pr-3">Avg</th>
              <th className="py-1 pr-3">Median</th>
              <th className="py-1 pr-3">p90</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {([1, 2, 3, 4] as Severity[]).map((sev) => {
              const st = computeStats(bySev[sev], metric, isExcused);
              const t = activePolicy.targets[sev];
              const targetS = metric === "first_response" ? t.firstResponseS : t.resolutionS;
              const clock = metric === "first_response" ? t.firstResponseClock : t.resolutionClock;
              const noTarget = targetS == null;
              return (
                <tr key={sev} className="border-t border-border">
                  <td className="py-1 pr-3">Sev {sev}</td>
                  <td className="py-1 pr-3">{st.n}</td>
                  <td className="py-1 pr-3">{noTarget ? "no target (best-effort)" : `${formatDuration(targetS)} (${clock})`}</td>
                  <td className="py-1 pr-3">
                    {noTarget ? "—" : <>{pctText(st.pct)} <span className="text-muted-foreground">({st.breach} / {st.excused})</span></>}
                  </td>
                  <td className="py-1 pr-3">{st.notEvaluable}</td>
                  <td className="py-1 pr-3">{formatDuration(st.avg)}</td>
                  <td className="py-1 pr-3">{formatDuration(st.median)}</td>
                  <td className="py-1 pr-3">{formatDuration(st.p90)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
