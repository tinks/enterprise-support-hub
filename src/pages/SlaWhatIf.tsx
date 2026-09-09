import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSlaBatch, type SlaBatchEnriched } from "@/hooks/useSlaBatch";
import {
  aggregate,
  evaluateCompliance,
  evaluateTriage,
  evaluateCadence,
  formatDuration,
  parseSeverity,
  SLA_TARGETS,
  TRIAGE_TARGET_S,
  CADENCE_TARGETS,
  BUSINESS_DAY_SECONDS,
  type Severity,
  type SlaTargets,
} from "@/lib/slaMetrics";
import { rowClosedAtMs } from "@/lib/slaWindow";

// ---------------------------------------------------------------------------
// VISUALIZATION-ONLY what-if SLA slider.
//
// This page holds a LOCAL, in-memory copy of the targets. It NEVER writes
// SLA_TARGETS, never persists anything, and never feeds the real Dashboard /
// Report / breach cards. It cannot create or hide a single real breach.
//
// Compliance is computed with the REAL engine (evaluateCompliance /
// evaluateTriage with injected targets) so there is no second copy of the
// rules to drift.
// ---------------------------------------------------------------------------

type Metric = "first_response" | "resolution";

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

// Human readout for a target in seconds. Business-clock targets that are whole
// multiples of a business day read as "N business days".
function targetLabel(seconds: number, clock: "calendar" | "business"): string {
  if (clock === "business" && seconds >= BUSINESS_DAY_SECONDS && seconds % BUSINESS_DAY_SECONDS === 0) {
    const d = seconds / BUSINESS_DAY_SECONDS;
    return `${d} business day${d === 1 ? "" : "s"}`;
  }
  return formatDuration(seconds);
}

type Knob = { min: number; max: number; step: number };

function knobFor(metric: Metric | "triage" | "cadence", sev: Severity | null): Knob {
  if (metric === "triage") return { min: 5 * 60, max: 4 * 3600, step: 5 * 60 };
  if (metric === "cadence") {
    // Sev1 is wall-clock (15min–8h); Sev2 is business hours (1h–2 business days).
    return sev === 1
      ? { min: 15 * 60, max: 8 * 3600, step: 15 * 60 }
      : { min: 3600, max: 2 * BUSINESS_DAY_SECONDS, step: 3600 };
  }
  if (metric === "first_response") {
    if (sev === 1) return { min: 5 * 60, max: 4 * 3600, step: 5 * 60 };
    if (sev === 2) return { min: 15 * 60, max: 2 * BUSINESS_DAY_SECONDS, step: 15 * 60 };
    return { min: 3600, max: 5 * BUSINESS_DAY_SECONDS, step: 3600 };
  }
  if (sev === 1) return { min: 3600, max: 5 * 24 * 3600, step: 3600 };
  return { min: BUSINESS_DAY_SECONDS / 2, max: 10 * BUSINESS_DAY_SECONDS, step: BUSINESS_DAY_SECONDS / 2 };
}

type Comparison = {
  evaluable: number;
  currentMet: number;
  proposedMet: number;
  currentPct: number | null;
  proposedPct: number | null;
  flipped: number;
  median: number | null;
  p90: number | null;
  max: number | null;
};

// Largest non-null actual — shows where the slider would have to sit to catch
// the worst case.
function maxOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

const EMPTY: Comparison = {
  evaluable: 0, currentMet: 0, proposedMet: 0,
  currentPct: null, proposedPct: null, flipped: 0, median: null, p90: null, max: null,
};

function compare(
  rows: SlaBatchEnriched[],
  sev: Severity,
  metric: Metric,
  whatIf: SlaTargets,
): Comparison {
  // First response is scoped to CUSTOMER-INITIATED rows only — same basis as
  // the monthly report. Resolution counts all in-scope rows.
  const scope = metric === "first_response"
    ? rows.filter((r) => r.sla.initiatedBy === "customer")
    : rows;

  let evaluable = 0, currentMet = 0, proposedMet = 0, flipped = 0;
  const values: Array<number | null> = [];

  for (const r of scope) {
    const cur = evaluateCompliance(r.sla, sev);
    const pro = evaluateCompliance(r.sla, sev, whatIf);
    const curV = metric === "first_response" ? cur.firstResponse : cur.resolution;
    const proV = metric === "first_response" ? pro.firstResponse : pro.resolution;
    values.push(curV.value);
    // RAW met/breach — breach-excuse overrides are deliberately NOT applied
    // here: this is target calibration, not the compliance report.
    if (curV.met == null && proV.met == null) continue;
    evaluable++;
    if (curV.met) currentMet++;
    if (proV.met) proposedMet++;
    if (curV.met !== proV.met) flipped++;
  }

  const agg = aggregate(values);
  return {
    evaluable,
    currentMet,
    proposedMet,
    currentPct: evaluable ? (currentMet / evaluable) * 100 : null,
    proposedPct: evaluable ? (proposedMet / evaluable) * 100 : null,
    flipped,
    median: agg.median,
    p90: agg.p90,
    max: maxOf(values),
  };
}

function DeltaRow({ c }: { c: Comparison }) {
  const delta = c.currentPct != null && c.proposedPct != null ? c.proposedPct - c.currentPct : null;
  const tone = delta == null || Math.abs(delta) < 0.05
    ? "text-muted-foreground"
    : delta > 0 ? "text-emerald-600" : "text-destructive";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="tabular-nums">{pctText(c.currentPct)}</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-semibold tabular-nums">{pctText(c.proposedPct)}</span>
      <span className={`tabular-nums ${tone}`}>
        {delta == null ? "" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts`}
      </span>
      <span className="text-muted-foreground">
        · {c.flipped} ticket{c.flipped === 1 ? "" : "s"} flipped · n={c.evaluable}
      </span>
    </div>
  );
}

function DistRef({ median, p90, max, clock }: { median: number | null; p90: number | null; max: number | null; clock: string }) {
  return (
    <div className="text-xs text-muted-foreground">
      Actuals ({clock}): median <span className="tabular-nums">{formatDuration(median)}</span> · p90{" "}
      <span className="tabular-nums">{formatDuration(p90)}</span> · longest{" "}
      <span className="tabular-nums">{formatDuration(max)}</span>
    </div>
  );
}

function KnobCard({
  title, clock, value, currentValue, knob, onChange, comparison, disabledNote,
}: {
  title: string;
  clock: "calendar" | "business";
  value: number | null;
  currentValue: number | null;
  knob: Knob;
  onChange?: (v: number) => void;
  comparison?: Comparison;
  disabledNote?: string;
}) {
  const noTarget = value == null;
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-normal">
            {clock === "business" ? "business hours" : "calendar 24/7"}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            current: {currentValue == null ? "no target" : targetLabel(currentValue, clock)}
          </Badge>
        </div>
      </div>

      {disabledNote ? (
        <div className="text-sm text-muted-foreground italic">{disabledNote}</div>
      ) : noTarget ? (
        <div className="text-sm text-muted-foreground italic">
          Best-effort — no committed target. Not evaluable, left off the slider.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Slider
              className="flex-1"
              min={knob.min}
              max={knob.max}
              step={knob.step}
              value={[value]}
              onValueChange={(v) => onChange?.(v[0])}
            />
            <div className="w-36 text-right text-sm font-semibold tabular-nums">
              {targetLabel(value, clock)}
            </div>
          </div>
          {comparison && <DeltaRow c={comparison} />}
          {comparison && <DistRef median={comparison.median} p90={comparison.p90} max={comparison.max} clock={clock === "business" ? "business hours" : "wall-clock"} />}
        </>
      )}
    </div>
  );
}

export default function SlaWhatIf() {
  const now = new Date();
  const months = useMemo(() => monthOptions(now), [now.getFullYear(), now.getMonth()]);
  // Default to the previous COMPLETE calendar month — that's the review target.
  const [month, setMonth] = useState(months[1]?.value ?? months[0].value);

  // LOCAL, in-memory targets only. Never written back to SLA_TARGETS.
  const [whatIf, setWhatIf] = useState<SlaTargets>(() => structuredClone(SLA_TARGETS));
  const [whatIfTriage, setWhatIfTriage] = useState<number>(TRIAGE_TARGET_S);
  // Cadence targets are Sev1/Sev2 only — Sev3/Sev4 carry no cadence commitment.
  const [whatIfCadence, setWhatIfCadence] = useState<Record<1 | 2, number>>(() => ({
    1: CADENCE_TARGETS[1]!.maxGapS,
    2: CADENCE_TARGETS[2]!.maxGapS,
  }));

  const batch = useSlaBatch();
  const { loading, error, inScope } = batch;

  const { start, end } = useMemo(() => monthRange(month), [month]);
  // Seam for a future custom date range: everything downstream reads {start,end}.
  const population = useMemo(
    () =>
      inScope.filter((r) => {
        const t = rowClosedAtMs(r as any);
        return t != null && t >= start && t < end;
      }),
    [inScope, start, end],
  );

  const { bySev, unclassified } = useMemo(() => {
    const bySev: Record<Severity, SlaBatchEnriched[]> = { 1: [], 2: [], 3: [], 4: [] };
    let unclassified = 0;
    for (const r of population) {
      const sev = parseSeverity(r.raw_payload?.custom_attributes?.["Severity"]);
      if (sev == null) { unclassified++; continue; }
      bySev[sev].push(r);
    }
    return { bySev, unclassified };
  }, [population]);

  const frCompare = useMemo(
    () => ({
      1: compare(bySev[1], 1, "first_response", whatIf),
      2: compare(bySev[2], 2, "first_response", whatIf),
      3: compare(bySev[3], 3, "first_response", whatIf),
      4: compare(bySev[4], 4, "first_response", whatIf),
    }) as Record<Severity, Comparison>,
    [bySev, whatIf],
  );

  const resCompare = useMemo(
    () => ({
      1: compare(bySev[1], 1, "resolution", whatIf),
      2: compare(bySev[2], 2, "resolution", whatIf),
      3: compare(bySev[3], 3, "resolution", whatIf),
      4: EMPTY,
    }) as Record<Severity, Comparison>,
    [bySev, whatIf],
  );

  const triageCompare = useMemo<Comparison>(() => {
    let evaluable = 0, currentMet = 0, proposedMet = 0, flipped = 0;
    const values: Array<number | null> = [];
    for (const r of population) {
      values.push(r.sla.timeToTriageBusinessHoursS);
      const cur = evaluateTriage(r.sla, TRIAGE_TARGET_S);
      const pro = evaluateTriage(r.sla, whatIfTriage);
      if (cur == null && pro == null) continue;
      evaluable++;
      if (cur) currentMet++;
      if (pro) proposedMet++;
      if (cur !== pro) flipped++;
    }
    const agg = aggregate(values);
    return {
      evaluable, currentMet, proposedMet,
      currentPct: evaluable ? (currentMet / evaluable) * 100 : null,
      proposedPct: evaluable ? (proposedMet / evaluable) * 100 : null,
      flipped, median: agg.median, p90: agg.p90, max: maxOf(values),
    };
  }, [population, whatIfTriage]);

  // Cadence: %met over rows of that severity, nulls (no comms / no close)
  // dropped as NOT-EVALUABLE. Sev1 reads the wall-clock max gap, Sev2 the
  // business-hours one — matching each severity's clock in CADENCE_TARGETS.
  const cadenceCompare = useMemo<Record<1 | 2, Comparison>>(() => {
    const run = (sev: 1 | 2): Comparison => {
      let evaluable = 0, currentMet = 0, proposedMet = 0, flipped = 0;
      const values: Array<number | null> = [];
      for (const r of bySev[sev]) {
        values.push(sev === 1 ? r.sla.cadenceMaxGapS : r.sla.cadenceMaxGapBusinessHoursS);
        const cur = evaluateCadence(r.sla, sev);
        const pro = evaluateCadence(r.sla, sev, whatIfCadence[sev]);
        if (cur == null && pro == null) continue;
        evaluable++;
        if (cur) currentMet++;
        if (pro) proposedMet++;
        if (cur !== pro) flipped++;
      }
      const agg = aggregate(values);
      return {
        evaluable, currentMet, proposedMet,
        currentPct: evaluable ? (currentMet / evaluable) * 100 : null,
        proposedPct: evaluable ? (proposedMet / evaluable) * 100 : null,
        flipped, median: agg.median, p90: agg.p90, max: maxOf(values),
      };
    };
    return { 1: run(1), 2: run(2) };
  }, [bySev, whatIfCadence]);

  const setFr = (sev: Severity, v: number) =>
    setWhatIf((prev) => ({ ...prev, [sev]: { ...prev[sev], firstResponseS: v } }));
  const setRes = (sev: Severity, v: number) =>
    setWhatIf((prev) => ({ ...prev, [sev]: { ...prev[sev], resolutionS: v } }));
  const reset = () => {
    setWhatIf(structuredClone(SLA_TARGETS));
    setWhatIfTriage(TRIAGE_TARGET_S);
    setWhatIfCadence({ 1: CADENCE_TARGETS[1]!.maxGapS, 2: CADENCE_TARGETS[2]!.maxGapS });
  };

  const sevs: Severity[] = [1, 2, 3, 4];

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">SLA what-if</h1>
            <p className="text-sm text-muted-foreground">
              Move the targets and watch compliance move with them — calibration sandbox.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={reset}>Reset to current</Button>
          </div>
        </div>

        <div className="rounded-lg border-2 border-destructive/60 bg-destructive/10 p-4">
          <div className="font-bold uppercase tracking-wide text-destructive">Visualization only</div>
          <p className="mt-1 text-sm">
            This page holds a <strong>local, in-memory copy</strong> of the SLA targets. It{" "}
            <strong>never writes SLA_TARGETS, never persists anything, and never feeds the real
            Dashboard, Report, or breach cards</strong>. It cannot create or hide a single real breach.
            Numbers here are RAW met/breach — breach excuses are deliberately not applied, because
            this is target calibration, not the compliance report.
          </p>
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading SLA population…</div>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Population</CardTitle>
                <CardDescription>
                  In-scope tickets finalized in {months.find((m) => m.value === month)?.label}:{" "}
                  <strong className="tabular-nums">{population.length}</strong>
                  {unclassified > 0 && (
                    <> · <span className="tabular-nums">{unclassified}</span> unclassified (no Severity — never scored)</>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Triage</CardTitle>
                <CardDescription>
                  Single global target, business-hours basis (matches the report headline). Tickets
                  with no Severity event are NOT-EVALUABLE and never counted as a miss.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <KnobCard
                  title="Time to first Severity assignment"
                  clock="business"
                  value={whatIfTriage}
                  currentValue={TRIAGE_TARGET_S}
                  knob={knobFor("triage", null)}
                  onChange={setWhatIfTriage}
                  comparison={triageCompare}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">First response time</CardTitle>
                <CardDescription>
                  Customer-initiated tickets only, same basis as the monthly report.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sevs.map((sev) => (
                  <KnobCard
                    key={sev}
                    title={`Sev ${sev} — first response time`}
                    clock={whatIf[sev].firstResponseClock}
                    value={whatIf[sev].firstResponseS}
                    currentValue={SLA_TARGETS[sev].firstResponseS}
                    knob={knobFor("first_response", sev)}
                    onChange={(v) => setFr(sev, v)}
                    comparison={frCompare[sev]}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Communication cadence</CardTitle>
                <CardDescription>
                  Largest gap between our public human updates, from the first update through close
                  (tail gap included). Sev 3 / Sev 4 carry no cadence target. Tickets with no human
                  update or no close are NOT-EVALUABLE and never counted as a miss.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {([1, 2] as Array<1 | 2>).map((sev) => (
                  <KnobCard
                    key={sev}
                    title={`Sev ${sev} — update cadence`}
                    clock={CADENCE_TARGETS[sev]!.clock}
                    value={whatIfCadence[sev]}
                    currentValue={CADENCE_TARGETS[sev]!.maxGapS}
                    knob={knobFor("cadence", sev)}
                    onChange={(v) => setWhatIfCadence((prev) => ({ ...prev, [sev]: v }))}
                    comparison={cadenceCompare[sev]}
                  />
                ))}
                <p className="text-xs text-muted-foreground">
                  Phase-1 <strong>drumbeat</strong>: customer replies do <strong>not</strong> pause
                  the cadence clock. These targets are <strong>provisional</strong>, same as every
                  other target on this page.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resolution</CardTitle>
                <CardDescription>
                  Stop-the-clock active in-our-court time, all in-scope tickets. Sev 4 is best-effort.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sevs.map((sev) => (
                  <KnobCard
                    key={sev}
                    title={`Sev ${sev} — resolution`}
                    clock={whatIf[sev].resolutionClock}
                    value={sev === 4 ? null : whatIf[sev].resolutionS}
                    currentValue={SLA_TARGETS[sev].resolutionS}
                    knob={knobFor("resolution", sev)}
                    onChange={(v) => setRes(sev, v)}
                    comparison={resCompare[sev]}
                  />
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
