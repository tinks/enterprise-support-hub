import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TestDataToggle, TestDataBanner } from "@/pages/SlaWorkbench";
import { useSlaBatch, type SlaBatchEnriched, type SlaOverrideMetric } from "@/hooks/useSlaBatch";
import {
  aggregate,
  evaluateCompliance,
  formatDuration,
  parseSeverity,
  SLA_TARGETS,
  type ComplianceVerdict,
  type Severity,
  type SlaCompliance,
} from "@/lib/slaMetrics";
import { rowClosedAtMs } from "@/lib/slaWindow";

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

// Work-Before-Ticket (Tenet #1 signal) — a PROCESS metric, not an SLA breach.
// Support-answered = a support reply exists (workBeforeTicketS non-null).
function wbtStats(rows: Scored[]) {
  const answered = rows.filter((r) => r.row.sla.workBeforeTicketS != null);
  const withWork = answered.filter((r) => (r.row.sla.workBeforeTicketS ?? 0) > 0);
  return {
    answered: answered.length,
    withWork: withWork.length,
    pct: answered.length ? (withWork.length / answered.length) * 100 : null,
    median: aggregate(withWork.map((r) => r.row.sla.workBeforeTicketBusinessHoursS)).median,
  };
}

function computeStats(
  rows: Scored[],
  m: Metric,
  isExcused: (cid: string, metric: Metric) => boolean,
): MetricStats {
  let met = 0, breach = 0, excused = 0, notEvaluable = 0;
  for (const { row, comp } of rows) {
    const v = verdict(comp, m);
    if (v.met === true) met++;
    else if (v.met === false) {
      if (isExcused(row.intercom_conversation_id, m)) excused++;
      else breach++;
    } else notEvaluable++;
  }
  const denom = met + breach;
  const agg = aggregate(rows.map((r) => verdict(r.comp, m).value));
  return {
    n: rows.length, met, breach, excused, notEvaluable,
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
  const now = new Date();
  const months = useMemo(() => monthOptions(now), [now.getFullYear(), now.getMonth()]);
  const [month, setMonth] = useState(months[0].value);

  const batch = useSlaBatch({ showTestData });
  const { loading, error, inScope, excluded, noCustomer, manuallyLogged, isExcused, getOverride, customerLabels } = batch;

  const { start, end } = useMemo(() => monthRange(month), [month]);
  const inMonth = <T extends { intercom_closed_at?: string | null; raw_payload?: any }>(r: T) => {
    const t = rowClosedAtMs(r as any);
    return t != null && t >= start && t < end;
  };

  const population = useMemo(() => inScope.filter(inMonth), [inScope, start, end]);
  const monthExcluded = useMemo(() => excluded.filter(inMonth), [excluded, start, end]);
  const monthNoCustomer = useMemo(() => noCustomer.filter(inMonth), [noCustomer, start, end]);
  const monthManual = useMemo(() => manuallyLogged.filter(inMonth), [manuallyLogged, start, end]);

  // Severity split — unclassified rows stay in the population but cannot be scored.
  const { bySev, unclassified, scored } = useMemo(() => {
    const bySev: Record<Severity, Scored[]> = { 1: [], 2: [], 3: [], 4: [] };
    const unclassified: SlaBatchEnriched[] = [];
    const scored: Scored[] = [];
    for (const r of population) {
      const sev = parseSeverity(r.raw_payload?.custom_attributes?.["Severity"]);
      if (sev == null) { unclassified.push(r); continue; }
      const s: Scored = { row: r, comp: evaluateCompliance(r.sla, sev) };
      bySev[sev].push(s);
      scored.push(s);
    }
    return { bySev, unclassified, scored };
  }, [population]);

  const overallFr = computeStats(scored, "first_response", isExcused);
  const overallRes = computeStats(scored, "resolution", isExcused);
  const overallWbt = useMemo(() => wbtStats(scored), [scored]);

  // Exclusion reasons — mirrors classifySlaBatchRow's predicates (display only).
  const exclusionBreakdown = useMemo(() => {
    const c = {
      not_enterprise: 0, fyi_or_duplicate: 0, merged: 0, rsa_false: 0,
      test_account: 0, prospect_personal: 0, enterprise_prospect: 0, other: 0,
    };
    for (const r of monthExcluded) {
      const tags = Array.isArray(r.tags) ? r.tags : [];
      const isTest = !!(r.customer_key && batch.testAccountKeys.has(r.customer_key));
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
  }, [monthExcluded, batch.testAccountKeys, showTestData]);

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
        wbt: wbtStats(rows),
      };
    });
  }, [scored, isExcused]);

  const monthLabel = months.find((m) => m.value === month)?.label ?? month;

  return (
    <AppLayout>
      <div className="max-w-[1200px] mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Monthly SLA Report</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Read-only. Population = all Enterprise tickets finalized in the selected month (no owner filter).
            </p>
          </div>
          <div className="flex items-center gap-3">
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
            <div>
              <div className="font-medium mb-1">Excluded from population ({monthExcluded.length})</div>
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
            </div>
            <div className="text-xs tabular-nums">
              No customer participant: {monthNoCustomer.length} · Manually-logged (bulk import, unmeasurable): {monthManual.length}
            </div>
          </CardContent>
        </Card>

        {/* §2 Headline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§2 Headline — vs PROPOSED targets</CardTitle>
            <CardDescription className="text-xs">
              Across scored in-scope tickets. % met = met / (met + unexcused breach). Excused and
              not-evaluable are excluded from the denominator and shown separately.
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
                  <div className="text-xs tabular-nums">
                    Median {formatDuration(s.median)} · p90 {formatDuration(s.p90)} · Avg {formatDuration(s.avg)}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <SeverityTable
          title="§3a First Response by Severity"
          metric="first_response"
          bySev={bySev}
          isExcused={isExcused}
        />
        <SeverityTable
          title="§3b Resolution by Severity"
          metric="resolution"
          bySev={bySev}
          isExcused={isExcused}
        />

        {/* §4 Breaches */}
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
          <CardContent className="space-y-5">
            {(["first_response", "resolution"] as Metric[]).map((m) => {
              const rows = scored.filter((s) => verdict(s.comp, m).met === false);
              return (
                <div key={m}>
                  <div className="font-medium text-sm mb-1">
                    {m === "first_response" ? "First Response" : "Resolution"} breaches ({rows.length})
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-xs text-muted-foreground">None.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr className="text-left">
                            <th className="py-1 pr-3">Ticket</th>
                            <th className="py-1 pr-3">Customer</th>
                            <th className="py-1 pr-3">Sev</th>
                            <th className="py-1 pr-3">Actual</th>
                            <th className="py-1 pr-3">Target</th>
                            <th className="py-1 pr-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ row, comp }) => {
                            const v = verdict(comp, m);
                            const ov = getOverride(row.intercom_conversation_id, m);
                            return (
                              <tr key={row.id} className="border-t border-border align-top">
                                <td className="py-1 pr-3">
                                  <a
                                    className="underline"
                                    target="_blank"
                                    rel="noreferrer"
                                    href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${row.intercom_conversation_id}`}
                                  >
                                    {row.subject || row.intercom_conversation_id}
                                  </a>
                                </td>
                                <td className="py-1 pr-3">
                                  {(row.customer_key && customerLabels.get(row.customer_key)) || row.customer_key || "—"}
                                </td>
                                <td className="py-1 pr-3 tabular-nums">{comp.severity}</td>
                                <td className="py-1 pr-3 tabular-nums">{formatDuration(v.value)}</td>
                                <td className="py-1 pr-3 tabular-nums">{formatDuration(v.target)} ({v.clock})</td>
                                <td className="py-1 pr-3">
                                  {ov ? <Badge variant="secondary">excused · {ov.reason}</Badge> : <Badge variant="destructive">breach</Badge>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

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
                  <th className="py-1 pr-3">FR Avg</th>
                  <th className="py-1 pr-3">FR Median</th>
                  <th className="py-1 pr-3">Res Avg</th>
                  <th className="py-1 pr-3">Res Median</th>
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
                    <td className="py-1 pr-3">{formatDuration(s.fr.avg)}</td>
                    <td className="py-1 pr-3">{formatDuration(s.fr.median)}</td>
                    <td className="py-1 pr-3">{formatDuration(s.res.avg)}</td>
                    <td className="py-1 pr-3">{formatDuration(s.res.median)}</td>
                    <td className="py-1 pr-3">{formatDuration(s.preInboxMedian)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* §5b Work Before Ticket */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">§5b Work Before Ticket — Tenet #1 signal</CardTitle>
            <CardDescription className="text-xs">
              Time Support was already working the issue <strong>before</strong> it existed as a
              ticket in the Enterprise Inbox (mirror of the clamped first-response clock). This is a
              process metric for "no work without a ticket" — <strong>not</strong> an SLA breach.
              Distinct from pre-inbox time, which is the customer's total wait.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="tabular-nums">
              {overallWbt.withWork} of {overallWbt.answered} Support-answered tickets
              {overallWbt.pct == null ? "" : ` (${overallWbt.pct.toFixed(1)}%)`} had Support working
              before a ticket existed · median {formatDuration(overallWbt.median)} (business hours)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-3">Source</th>
                    <th className="py-1 pr-3">Support-answered</th>
                    <th className="py-1 pr-3">WBT &gt; 0</th>
                    <th className="py-1 pr-3">%</th>
                    <th className="py-1 pr-3">Median WBT (business)</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {bySource.map((s) => (
                    <tr key={s.key} className="border-t border-border">
                      <td className="py-1 pr-3">{s.key}</td>
                      <td className="py-1 pr-3">{s.wbt.answered}</td>
                      <td className="py-1 pr-3">{s.wbt.withWork}</td>
                      <td className="py-1 pr-3">{pctText(s.wbt.pct)}</td>
                      <td className="py-1 pr-3">{formatDuration(s.wbt.median)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>


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
  title, metric, bySev, isExcused,
}: {
  title: string;
  metric: Metric;
  bySev: Record<Severity, Scored[]>;
  isExcused: (cid: string, m: Metric) => boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title} — vs PROPOSED targets</CardTitle>
        <CardDescription className="text-xs">
          % met = met / (met + unexcused breach). Median / p90 are the calibration evidence.
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
              const t = SLA_TARGETS[sev];
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
