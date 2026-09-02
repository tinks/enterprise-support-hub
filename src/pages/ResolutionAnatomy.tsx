import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Loader2, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend,
} from "recharts";
import { CLEAN_DATA_START_DATE, CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import { intercomUrl } from "@/lib/intercom";
import { isSlaExcluded } from "@/lib/slaExclusions";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { idColumn } from "@/components/issues/issueColumns";

import { formatDuration, median } from "@/lib/durationStats";
import {
  computeAnatomy, anatomyReconciles, type AnatomyResult, type OwedBy,
} from "@/lib/resolutionAnatomy";
import {
  SPLIT_FOOTNOTE, SPLIT_KEYS, SPLIT_LABEL, SPLIT_CLASS, summarizeSplit, splitMedians,
} from "@/lib/resolutionDisplay";
import { ResolutionSplitLine } from "@/components/ResolutionSplitLine";

type ScalarRow = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  owner: string | null;
  product_area: string | null;
  classification: string | null;
  customer_key: string | null;
  finalized_at: string | null;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  time_to_resolve_s: number | null;
  reopen_count_at_finalize: number | null;
  tags: string[] | null;
  rsa_override: boolean | null;
  customer_resolution_method: string | null;
  /** Engine-v3 persisted clocks. Null on rows the engine never stamped. */
  resolution_active_s: number | null;
  resolution_customer_wait_s: number | null;
  resolution_eng_wait_s: number | null;
  resolution_closed_s: number | null;
  resolution_window_s: number | null;
  active_clock_engine_version: number | null;
};

type LongRow = ScalarRow & { anatomy: AnatomyResult };

import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { inPlanScope, type PlanScope } from "@/lib/planTier";
import { showTestDataNow } from "@/lib/testTickets";

const SCALAR_COLS =
  "id,intercom_conversation_id,subject,subject_override,owner,product_area,classification," +
  "customer_key,finalized_at,intercom_created_at,intercom_closed_at,time_to_resolve_s," +
  "reopen_count_at_finalize,tags,rsa_override,customer_resolution_method,plan_tier,is_test_ticket," +
  // Engine-v3 persisted clocks — the authoritative split for the whole cohort.
  "resolution_active_s,resolution_customer_wait_s,resolution_eng_wait_s,resolution_closed_s,resolution_window_s,active_clock_engine_version";


const ANY = "__any__";

function displaySubject(r: ScalarRow) {
  return r.subject_override?.trim() || r.subject || `Intercom #${r.intercom_conversation_id}`;
}

function pct(part: number | null, total: number | null): number | null {
  if (part == null || !total) return null;
  return (part / total) * 100;
}

/**
 * Active clock — wall clock with the time the ticket sat CLOSED removed.
 * Nobody owed a reply during a closed stretch, so it is elapsed time we neither
 * caused nor could shorten. Reported alongside the recorded clock, never instead
 * of it.
 */
function activeOf(r: { anatomy: AnatomyResult }): number | null {
  const a = r.anatomy;
  if (a.totalS == null) return null;
  return Math.max(0, a.totalS - (a.closedS ?? 0));
}



/** The four-way split as one stacked bar. */
function SplitBar({ a }: { a: AnatomyResult }) {
  if (a.totalS == null || a.totalS === 0) return <span className="text-muted-foreground">—</span>;
  const w = (v: number | null) => `${Math.max(0, ((v ?? 0) / a.totalS!) * 100)}%`;
  return (
    <div
      className="flex h-3 w-full overflow-hidden rounded-sm bg-muted"
      title={`Us ${formatDuration(a.ourClockS)} · Customer ${formatDuration(a.theirClockS)} · Closed ${formatDuration(a.closedS)} · Drift ${formatDuration(a.driftS)}`}
    >
      <div style={{ width: w(a.ourClockS) }} className="bg-primary" />
      <div style={{ width: w(a.theirClockS) }} className="bg-[hsl(var(--chart-2,220_10%_60%))] bg-muted-foreground/60" />
      <div style={{ width: w(a.closedS) }} className="bg-muted-foreground/25" />
      <div style={{ width: w(a.driftS) }} className="bg-destructive/60" />
    </div>
  );
}

const REOPEN_BY_LABEL: Record<string, string> = {
  customer: "by customer",
  admin: "by us",
  auto: "by bot / system",
  unknown: "unknown",
};

const OWED_LABEL: Record<OwedBy, string> = {
  us: "We owed a reply",
  customer: "Customer owed a reply",
  nobody: "Nobody was blocked",
  closed: "Closed — nobody owed a reply",
};


export default function ResolutionAnatomy() {
  const { accountLabel } = useCustomerLabels();

  const [months, setMonths] = useState(3);
  const [thresholdDays, setThresholdDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [loadingLong, setLoadingLong] = useState(false);
  const [scalars, setScalars] = useState<ScalarRow[]>([]);
  const [excludedCount, setExcludedCount] = useState(0);
  const [testAccountKeys, setTestAccountKeys] = useState<Set<string>>(new Set());
  const [longRows, setLongRows] = useState<LongRow[]>([]);
  const [planScope, setPlanScope] = useState<PlanScope>("all");
  const [error, setError] = useState<string | null>(null);
  const [reconFailures, setReconFailures] = useState(0);
  const [detail, setDetail] = useState<LongRow | null>(null);


  const [fArea, setFArea] = useState(ANY);
  const [fClass, setFClass] = useState(ANY);
  const [fOwner, setFOwner] = useState(ANY);
  const [fCustomer, setFCustomer] = useState(ANY);
  const [fReopened, setFReopened] = useState(ANY);
  /** When on, the long-runner threshold is applied to the active clock (total − closed). */
  const [excludeClosed, setExcludeClosed] = useState(false);

  const windowStart = useMemo(() => {
    const s = startOfMonth(subMonths(new Date(), months - 1));
    return s < CLEAN_DATA_START_DATE ? CLEAN_DATA_START_DATE : s;
  }, [months]);

  const thresholdS = thresholdDays * 86400;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Test/sandbox accounts, so the SLA-population predicate can be applied
      // with the same inputs the SLA workbench uses.
      const { data: accts } = await supabase
        .from("v3_customer_accounts")
        .select("account_key,is_test");
      const testKeys = new Set<string>(
        ((accts ?? []) as Array<{ account_key: string; is_test: boolean | null }>)
          .filter((a) => a.is_test)
          .map((a) => a.account_key),
      );
      setTestAccountKeys(testKeys);

      // Pass 1 — scalars only, for the cohort rollup. raw_payload is huge and
      // is fetched only for the long runners in pass 2.
      const all: ScalarRow[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("intercom_tickets_v3")
          .select(SCALAR_COLS)
          .eq("lifecycle_status", "finalized")
          .gte("finalized_at", windowStart.toISOString())
          .not("time_to_resolve_s", "is", null)
          .order("finalized_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as unknown as ScalarRow[];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      // Same population as the SLA surfaces: enterprise-fyi / enterprise-duplicate,
      // merged tickets, RSA=false, non-enterprise / prospect dispositions and test
      // accounts are NOT resolution work and must not shape the resolution curve.
      const inScope = all.filter((r) => !isSlaExcluded(r, { testAccountKeys: testKeys, showTestData: showTestDataNow() }));
      setExcludedCount(all.length - inScope.length);
      setScalars(inScope);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadLong() {
    setLoadingLong(true);
    try {
      const ids = scalars.filter((r) => (r.time_to_resolve_s ?? 0) > thresholdS).map((r) => r.id);
      const out: LongRow[] = [];
      let failures = 0;
      const CHUNK = 40; // raw_payload rows are large — keep responses small
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("intercom_tickets_v3")
          .select(`${SCALAR_COLS},raw_payload`)
          .in("id", slice);
        if (error) throw error;
        for (const row of (data ?? []) as any[]) {
          const closedSec = row.intercom_closed_at
            ? Math.floor(new Date(row.intercom_closed_at).getTime() / 1000)
            : null;
          const anatomy = computeAnatomy(row.raw_payload, { closedAtSec: closedSec });
          if (!anatomyReconciles(anatomy)) failures++;
          const { raw_payload, ...scalar } = row;
          out.push({ ...(scalar as ScalarRow), anatomy });
        }
      }
      out.sort((a, b) => (b.time_to_resolve_s ?? 0) - (a.time_to_resolve_s ?? 0));
      setReconFailures(failures);
      setLongRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Long-runner load failed");
    } finally {
      setLoadingLong(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [windowStart]);
  useEffect(() => { if (scalars.length) loadLong(); /* eslint-disable-next-line */ }, [scalars, thresholdS]);

  const options = useMemo(() => {
    const areas = new Set<string>(), classes = new Set<string>(), owners = new Set<string>(), customers = new Set<string>();
    for (const r of longRows) {
      if (r.product_area) areas.add(r.product_area);
      if (r.classification) classes.add(r.classification);
      if (r.owner) owners.add(r.owner);
      if (r.customer_key) customers.add(r.customer_key);
    }
    const s = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b));
    return { areas: s(areas), classes: s(classes), owners: s(owners), customers: s(customers) };
  }, [longRows]);

  const filtered = useMemo(() => longRows.filter((r) => {
    if (!inPlanScope((r as any).plan_tier, planScope)) return false;
    if (fArea !== ANY && (r.product_area ?? "") !== fArea) return false;
    if (fClass !== ANY && (r.classification ?? "") !== fClass) return false;
    if (fOwner !== ANY && (r.owner ?? "") !== fOwner) return false;
    if (fCustomer !== ANY && (r.customer_key ?? "") !== fCustomer) return false;
    // Payload-derived, not reopen_count_at_finalize — that column undercounts.
    const rc = r.anatomy.episodes.reopenCount;
    if (fReopened === "yes" && !rc) return false;
    if (fReopened === "no" && rc > 0) return false;
    if (fReopened === "customer" && r.anatomy.episodes.firstReopenBy !== "customer") return false;
    if (fReopened === "admin" && r.anatomy.episodes.firstReopenBy !== "admin") return false;
    if (fReopened === "auto" && r.anatomy.episodes.firstReopenBy !== "auto") return false;
    if (excludeClosed && (activeOf(r) ?? 0) <= thresholdS) return false;
    return true;
  }), [longRows, planScope, fArea, fClass, fOwner, fCustomer, fReopened, excludeClosed, thresholdS]);

  // ---- Cohort rollups -------------------------------------------------------

  const byMonth = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; us: number[]; them: number[]; drift: number[]; closed: number[]; n: number }>();
    for (let i = months - 1; i >= 0; i--) {
      const anchor = subMonths(new Date(), i);
      const start = startOfMonth(anchor);
      if (endOfMonth(anchor) < CLEAN_DATA_START_DATE) continue;
      const key = format(start, "yyyy-MM");
      buckets.set(key, { key, label: format(start, "MMM yyyy"), us: [], them: [], drift: [], closed: [], n: 0 });
    }
    for (const r of filtered) {
      if (!r.finalized_at) continue;
      const key = format(new Date(r.finalized_at), "yyyy-MM");
      const b = buckets.get(key);
      if (!b || r.anatomy.totalS == null) continue;
      b.n++;
      b.us.push((r.anatomy.ourClockS ?? 0) / 86400);
      b.them.push((r.anatomy.theirClockS ?? 0) / 86400);
      b.drift.push((r.anatomy.driftS ?? 0) / 86400);
      b.closed.push((r.anatomy.closedS ?? 0) / 86400);
    }
    return [...buckets.values()].map((b) => ({
      label: b.label,
      n: b.n,
      "Our clock": Number((median(b.us) ?? 0).toFixed(2)),
      "Their clock": Number((median(b.them) ?? 0).toFixed(2)),
      "Closed": Number((median(b.closed) ?? 0).toFixed(2)),
      "Silent drift": Number((median(b.drift) ?? 0).toFixed(2)),
    }));
  }, [filtered, months]);

  // Authoritative split from the persisted engine-v3 columns, over the whole
  // in-scope cohort rather than only the long runners.
  const persistedSplit = useMemo(() => summarizeSplit(scalars), [scalars]);
  const persistedMedians = useMemo(() => splitMedians(scalars), [scalars]);

  const totals = useMemo(() => {
    let us = 0, them = 0, drift = 0, closed = 0, n = 0, closedNoConfirm = 0, reopened = 0;
    let crossedByReopen = 0, miscounted = 0;
    for (const r of filtered) {
      if (r.anatomy.totalS == null) continue;
      n++;
      us += r.anatomy.ourClockS ?? 0;
      them += r.anatomy.theirClockS ?? 0;
      drift += r.anatomy.driftS ?? 0;
      closed += r.anatomy.closedS ?? 0;
      if (r.anatomy.closedWithoutCustomerConfirm) closedNoConfirm++;
      if (r.anatomy.episodes.reopenCount > 0) reopened++;
      if (
        r.anatomy.episodes.reopenCount > 0 &&
        r.anatomy.episodes.timeToFirstCloseS != null &&
        r.anatomy.episodes.timeToFirstCloseS <= thresholdS
      ) crossedByReopen++;
      if (
        r.anatomy.episodes.reopenCount > 0 &&
        (r.reopen_count_at_finalize ?? 0) === 0
      ) miscounted++;
    }
    const total = us + them + drift + closed;
    return { us, them, drift, closed, total, active: us + them + drift, n, closedNoConfirm, reopened, crossedByReopen, miscounted };
  }, [filtered, thresholdS]);


  const cohortRollup = useMemo(() => {
    function group(keyFn: (r: LongRow) => string) {
      const m = new Map<string, { key: string; n: number; us: number; them: number; drift: number; total: number[] }>();
      for (const r of filtered) {
        if (r.anatomy.totalS == null) continue;
        const k = keyFn(r) || "(none)";
        const g = m.get(k) ?? { key: k, n: 0, us: 0, them: 0, drift: 0, total: [] };
        g.n++;
        g.us += r.anatomy.ourClockS ?? 0;
        g.them += r.anatomy.theirClockS ?? 0;
        g.drift += r.anatomy.driftS ?? 0;
        g.total.push(r.anatomy.totalS);
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10);
    }
    return {
      area: group((r) => r.product_area ?? ""),
      owner: group((r) => r.owner ?? ""),
      customer: group((r) => accountLabel(r.customer_key)),
    };
  }, [filtered, accountLabel]);

  const reopenDelta = useMemo(() => {
    // Where time_to_last_close and time-to-first-close diverge, the headline
    // metric is partly measuring reopen behaviour rather than resolution speed.
    const pairs = filtered
      .filter((r) => r.anatomy.episodes.timeToFirstCloseS != null && r.time_to_resolve_s != null)
      .map((r) => ({ first: r.anatomy.episodes.timeToFirstCloseS!, last: r.time_to_resolve_s! }));
    if (!pairs.length) return null;
    return {
      n: pairs.length,
      medFirst: median(pairs.map((p) => p.first)),
      medLast: median(pairs.map((p) => p.last)),
    };
  }, [filtered]);

  const activeDelta = useMemo(() => {
    const rows = filtered.filter((r) => r.anatomy.totalS != null);
    if (!rows.length) return null;
    const recorded = rows.map((r) => r.anatomy.totalS!);
    const active = rows.map((r) => activeOf(r)!);
    const withClosed = rows.filter((r) => (r.anatomy.closedS ?? 0) > 0).length;
    // Tickets that only clear the long-runner bar because of closed time.
    const belowOnActive = rows.filter((r) => (activeOf(r) ?? 0) <= thresholdS).length;
    return {
      n: rows.length,
      medRecorded: median(recorded),
      medActive: median(active),
      withClosed,
      belowOnActive,
    };
  }, [filtered, thresholdS]);


  // ---- Table ----------------------------------------------------------------

  const columns: IssueColumn<LongRow>[] = [
    idColumn<LongRow>((r) => r.intercom_conversation_id),
    {
      key: "subject",
      header: "Subject",
      sortValue: (r) => displaySubject(r).toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate">{displaySubject(r)}</div>
        </div>
      ),
    },

    {
      key: "total", header: "Total", width: "w-[90px]",
      sortValue: (r) => r.time_to_resolve_s ?? null,
      cell: (r) => <span className="tabular-nums">{formatDuration(r.time_to_resolve_s)}</span>,
    },
    {
      key: "active", header: "Active", width: "w-[95px]",
      headerTitle: "Wall clock minus time the ticket sat closed — nobody owed a reply then",
      sortValue: (r) => activeOf(r),
      cell: (r) => (
        <div className="text-xs">
          <div className="tabular-nums">{formatDuration(activeOf(r))}</div>
          {(r.anatomy.closedS ?? 0) > 0 && (
            <div className="text-muted-foreground">−{formatDuration(r.anatomy.closedS)} closed</div>
          )}
        </div>
      ),
    },
    {
      key: "split", header: "Split", width: "w-[150px]", headerTitle: "Blue = our clock · grey = customer · red = silent drift",
      sortValue: (r) => pct(r.anatomy.ourClockS, r.anatomy.totalS),
      cell: (r) => <SplitBar a={r.anatomy} />,
    },
    {
      key: "us", header: "Us", width: "w-[85px]",
      sortValue: (r) => r.anatomy.ourClockS ?? null,
      cell: (r) => <span className="tabular-nums">{formatDuration(r.anatomy.ourClockS)}</span>,
    },
    {
      key: "them", header: "Customer", width: "w-[95px]",
      sortValue: (r) => r.anatomy.theirClockS ?? null,
      cell: (r) => <span className="tabular-nums">{formatDuration(r.anatomy.theirClockS)}</span>,
    },
    {
      key: "drift", header: "Drift", width: "w-[85px]",
      sortValue: (r) => r.anatomy.driftS ?? null,
      cell: (r) => <span className="tabular-nums">{formatDuration(r.anatomy.driftS)}</span>,
    },
    {
      key: "longest", header: "Longest gap", width: "w-[150px]",
      sortValue: (r) => r.anatomy.longestGap?.seconds ?? null,
      cell: (r) => r.anatomy.longestGap
        ? (
          <div className="text-xs">
            <div className="tabular-nums">{formatDuration(r.anatomy.longestGap.seconds)}</div>
            <div className="text-muted-foreground">{OWED_LABEL[r.anatomy.longestGap.owedBy]}</div>
          </div>
        )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "replies", header: "Replies", width: "w-[80px]",
      sortValue: (r) => r.anatomy.replyCount,
      cell: (r) => <span className="tabular-nums text-xs">{r.anatomy.adminReplyCount}↔{r.anatomy.customerReplyCount}</span>,
    },
    {
      key: "firstclose", header: "First close", width: "w-[100px]",
      headerTitle: "Time from open to the FIRST close — the resolution clock before any reopen",
      sortValue: (r) => r.anatomy.episodes.timeToFirstCloseS ?? null,
      cell: (r) => <span className="tabular-nums">{formatDuration(r.anatomy.episodes.timeToFirstCloseS)}</span>,
    },
    {
      key: "reopened", header: "Reopens", width: "w-[90px]",
      headerTitle: "Counted from the conversation payload, not Intercom's reopen_count",
      sortValue: (r) => r.anatomy.episodes.reopenCount,
      cell: (r) => (
        <div className="text-xs">
          <div className="tabular-nums">{r.anatomy.episodes.reopenCount}</div>
          {r.anatomy.episodes.firstReopenBy && (
            <div className="text-muted-foreground">{REOPEN_BY_LABEL[r.anatomy.episodes.firstReopenBy]}</div>
          )}
        </div>
      ),
    },
    {
      key: "area", header: "Product area", width: "w-[160px]",
      sortValue: (r) => r.product_area ?? null,
      cell: (r) => r.product_area ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "owner", header: "Owner", width: "w-[110px]",
      sortValue: (r) => r.owner ?? null,
      cell: (r) => r.owner ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "customer", header: "Customer acct", width: "w-[150px]",
      sortValue: (r) => accountLabel(r.customer_key),
      cell: (r) => accountLabel(r.customer_key),
    },
    {
      key: "closed", header: "Closed", width: "w-[100px]",
      sortValue: (r) => r.finalized_at ?? null,
      cell: (r) => r.finalized_at ? format(new Date(r.finalized_at), "MMM d") : "—",
    },
  ];

  const share = (v: number) => totals.total ? `${((v / totals.total) * 100).toFixed(0)}%` : "—";

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Resolution anatomy</h1>
          <p className="text-muted-foreground text-sm">
            Where the elapsed time on long-running tickets actually goes. Read-only, derived on
            read, and it changes no existing metric. Data floor {CLEAN_DATA_START_LABEL}.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <PlanScopeSelect value={planScope} onChange={setPlanScope} className="w-[200px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Months</Label>
              <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 6, 12].map((m) => <SelectItem key={m} value={String(m)}>{m} month{m > 1 ? "s" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Long runner over (days)</Label>
              <Input
                type="number" min={1} max={90} value={thresholdDays}
                onChange={(e) => setThresholdDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-[120px]"
              />
            </div>
            <FilterSelect label="Product area" value={fArea} onChange={setFArea} options={options.areas} />
            <FilterSelect label="Type" value={fClass} onChange={setFClass} options={options.classes} />
            <FilterSelect label="Owner" value={fOwner} onChange={setFOwner} options={options.owners} />
            <FilterSelect
              label="Customer" value={fCustomer} onChange={setFCustomer}
              options={options.customers} render={accountLabel}
            />
            <div className="space-y-1">
              <Label className="text-xs">Reopened</Label>
              <Select value={fReopened} onValueChange={setFReopened}>
                <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="yes">Reopened</SelectItem>
                  <SelectItem value="no">Never</SelectItem>
                  <SelectItem value="customer">Reopened by customer</SelectItem>
                  <SelectItem value="admin">Reopened by us</SelectItem>
                  <SelectItem value="auto">Reopened by bot / system</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={excludeClosed}
                onChange={(e) => setExcludeClosed(e.target.checked)}
              />
              <span>Measure long runners on the active clock (exclude closed time)</span>
            </label>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
          </CardContent>
        </Card>

        {excludedCount > 0 && (
          <Card>
            <CardContent className="pt-6 text-xs text-muted-foreground">
              {excludedCount} finalized ticket{excludedCount > 1 ? "s" : ""} in this window
              excluded from the population (enterprise-fyi, enterprise-duplicate, enterprise-not-enterprise, merged,
              RSA=false, non-enterprise / prospect dispositions, test accounts) — the same
              predicate the SLA surfaces use.
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {reconFailures > 0 && (
          <Card className="border-destructive">
            <CardContent className="pt-6 text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {reconFailures} ticket{reconFailures > 1 ? "s" : ""} failed the reconciliation check
              (buckets do not sum to wall clock). Treat their split as UNVERIFIED.
            </CardContent>
          </Card>
        )}

        {/* Engine-v3 persisted split — the authoritative one. It covers the
            WHOLE in-scope cohort, unlike the long-runner anatomy below, which
            is derived client-side from raw_payload for tickets over the
            threshold only. The two taxonomies are not interchangeable: engine
            v3 has an explicit engineering-wait bucket and no "silent drift". */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Where the time went — whole cohort</CardTitle>
            <CardDescription className="text-xs">
              Engine-v3 persisted clocks across all {scalars.length.toLocaleString()} in-scope
              finalized tickets in range. {SPLIT_FOOTNOTE}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ResolutionSplitLine summary={persistedSplit} />
            <div className="grid gap-2 sm:grid-cols-4 text-xs">
              {SPLIT_KEYS.map((k) => (
                <div key={k} className="rounded-md border p-2">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={`inline-block h-2 w-2 rounded-sm ${SPLIT_CLASS[k]}`} />
                    {SPLIT_LABEL[k]} median
                  </div>
                  <div className="mt-0.5 font-medium">
                    {persistedMedians[k] == null ? "—" : formatDuration(persistedMedians[k]!)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Long-runner anatomy (client-side, legacy taxonomy) */}
        <div className="grid gap-4 md:grid-cols-5">
          <SplitCard title="Our clock" desc="Customer waited on us" value={totals.us} share={share(totals.us)} />
          <SplitCard title="Their clock" desc="We waited on the customer" value={totals.them} share={share(totals.them)} />
          <SplitCard title="Closed" desc="Closed, before a reopen" value={totals.closed} share={share(totals.closed)} />
          <SplitCard title="Silent drift" desc="Nobody was blocked" value={totals.drift} share={share(totals.drift)} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cohort</CardTitle>
              <CardDescription className="text-xs">
                Tickets over {thresholdDays}d {excludeClosed ? "of active clock" : "of wall clock"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-1 text-sm">
              <Row label="Tickets" value={String(totals.n)} />
              <Row label="Closed with no customer reply" value={String(totals.closedNoConfirm)} />
              <Row label="Reopened at least once" value={String(totals.reopened)} />
              <Row
                label={`Over ${thresholdDays}d only because of a reopen`}
                value={String(totals.crossedByReopen)}
              />
            </CardContent>
          </Card>
        </div>

        {/* Active clock — closed time removed */}
        {activeDelta && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active clock — closed time removed</CardTitle>
              <CardDescription>
                A closed stretch before a reopen is elapsed time nobody owed a reply for. Active
                clock = wall clock − closed. Shown alongside the recorded clock; it replaces no
                existing metric.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row label={`Median recorded clock (n=${activeDelta.n})`} value={formatDuration(activeDelta.medRecorded)} />
              <Row label="Median active clock" value={formatDuration(activeDelta.medActive)} />
              <Row label="Total closed time in cohort" value={`${formatDuration(totals.closed)} (${share(totals.closed)} of elapsed)`} />
              <Row label="Tickets with any closed time" value={`${activeDelta.withClosed} of ${activeDelta.n}`} />
              <Row
                label={`Over ${thresholdDays}d only because of closed time`}
                value={excludeClosed ? "0 (filtered out)" : String(activeDelta.belowOnActive)}
              />
            </CardContent>
          </Card>
        )}


        {/* Month trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Median split by month</CardTitle>
            <CardDescription>
              Which bucket is growing answers the question: staffing, customer responsiveness, or hygiene.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {loadingLong ? (
              <div className="h-full grid place-items-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis className="text-xs" unit="d" />
                  <RTooltip formatter={(v: any) => `${v} d`} />
                  <Legend />
                  <Bar dataKey="Our clock" stackId="a" fill="hsl(var(--primary))" />
                  <Bar dataKey="Their clock" stackId="a" fill="hsl(var(--muted-foreground))" />
                  <Bar dataKey="Closed" stackId="a" fill="hsl(var(--muted-foreground) / 0.35)" />
                  <Bar dataKey="Silent drift" stackId="a" fill="hsl(var(--destructive))" />

                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Reopen measurement check */}
        {reopenDelta && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Time to first close vs time to last close</CardTitle>
              <CardDescription>
                The headline metric is Intercom's time to <em>last</em> close, so a reopen re-clocks the
                whole ticket. Both are shown; neither replaces the other.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <Row label={`Median time to first close (n=${reopenDelta.n})`} value={formatDuration(reopenDelta.medFirst)} />
              <Row label="Median time to last close" value={formatDuration(reopenDelta.medLast)} />
              <Row
                label={`Long runners only because of a reopen`}
                value={`${totals.crossedByReopen} of ${totals.n}`}
              />
              {totals.miscounted > 0 && (
                <p className="pt-2 text-xs text-destructive">
                  {totals.miscounted} ticket{totals.miscounted > 1 ? "s" : ""} in this cohort show
                  reopens in the conversation payload while Intercom's reopen_count reads 0. Every
                  reopen figure on this page is counted from the payload for that reason.
                </p>
              )}
            </CardContent>

          </Card>
        )}

        {/* Cohort rollups */}
        <div className="grid gap-4 lg:grid-cols-3">
          <RollupCard title="By product area" rows={cohortRollup.area} />
          <RollupCard title="By owner" rows={cohortRollup.owner} />
          <RollupCard title="By customer" rows={cohortRollup.customer} />
        </div>

        {/* Long runners */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Long runners — over {thresholdDays} days
              <Badge variant="secondary" className="ml-2">{filtered.length}</Badge>
            </CardTitle>
            <CardDescription>Click a row to read the timeline gap by gap.</CardDescription>
          </CardHeader>
          <CardContent>
            <IssueTable
              rows={filtered}
              columns={columns}
              getRowKey={(r) => r.id}
              loading={loading || loadingLong}
              loadingMessage="Reading conversations…"
              emptyMessage="No tickets over the threshold in this window."
              onRowClick={(r) => setDetail(r)}
            />
          </CardContent>
        </Card>
      </div>

      <TimelineSheet row={detail} onClose={() => setDetail(null)} />
    </AppLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SplitCard({ title, desc, value, share }: { title: string; desc: string; value: number; share: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold tabular-nums">{share}</div>
        <div className="text-xs text-muted-foreground">{formatDuration(value)} across the cohort</div>
      </CardContent>
    </Card>
  );
}

function RollupCard({
  title, rows,
}: {
  title: string;
  rows: { key: string; n: number; us: number; them: number; drift: number }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{title}</CardTitle></CardHeader>
      <CardContent className="pt-0 space-y-2">
        {rows.length === 0 && <div className="text-xs text-muted-foreground">No rows.</div>}
        {rows.map((r) => {
          const total = r.us + r.them + r.drift || 1;
          return (
            <div key={r.key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="truncate pr-2">{r.key}</span>
                <span className="text-muted-foreground tabular-nums">{r.n}</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-sm bg-muted"
                title={`Us ${((r.us / total) * 100).toFixed(0)}% · Customer ${((r.them / total) * 100).toFixed(0)}% · Drift ${((r.drift / total) * 100).toFixed(0)}%`}>
                <div style={{ width: `${(r.us / total) * 100}%` }} className="bg-primary" />
                <div style={{ width: `${(r.them / total) * 100}%` }} className="bg-muted-foreground/60" />
                <div style={{ width: `${(r.drift / total) * 100}%` }} className="bg-destructive/60" />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label, value, onChange, options, render,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  render?: (v: string) => string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{render ? render(o) : o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function TimelineSheet({ row, onClose }: { row: LongRow | null; onClose: () => void }) {
  const a = row?.anatomy;
  const parts = a?.timeline ?? [];
  const gapByIndex = useMemo(() => {
    const m = new Map<number, { seconds: number; owedBy: OwedBy }[]>();
    for (const s of a?.segments ?? []) {
      const list = m.get(s.afterIndex) ?? [];
      list.push({ seconds: s.seconds, owedBy: s.owedBy });
      m.set(s.afterIndex, list);
    }
    return m;

  }, [a]);

  // Segment indices point at the substantive-part list; map back to timeline order.
  const substantiveIdx = useMemo(() => {
    const out: number[] = [];
    parts.forEach((p, i) => {
      if (p.isNote) return;
      if (p.partType === "source" || p.isPublicReply || (p.partType === "comment" && p.body.trim())) out.push(i);
    });
    return out;
  }, [parts]);

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[560px] sm:max-w-[560px] overflow-auto">
        {row && a && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{displaySubject(row)}</SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                <a
                  href={intercomUrl(row.intercom_conversation_id)}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                >
                  {row.intercom_conversation_id}<ExternalLink className="h-3 w-3" />
                </a>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-1">
              <SplitBar a={a} />
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span>Us {formatDuration(a.ourClockS)}</span>
                <span>Customer {formatDuration(a.theirClockS)}</span>
                <span>Closed {formatDuration(a.closedS)}</span>
                <span>Drift {formatDuration(a.driftS)}</span>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {substantiveIdx.map((tIdx, sIdx) => {
                const p = parts[tIdx];
                const gaps = gapByIndex.get(sIdx) ?? [];
                return (
                  <div key={tIdx} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">
                        {p.authorName || p.authorEmail || "Unknown"}
                        <span className="ml-2 text-muted-foreground font-normal">{p.actor}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {format(new Date(p.ts * 1000), "MMM d HH:mm")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-3">{p.body || "—"}</div>
                    {gaps.map((gap, gi) => (
                      <div key={gi} className="text-[11px] pl-2 border-l-2 border-border py-1">
                        <span className="tabular-nums font-medium">{formatDuration(gap.seconds)}</span>
                        <span className="text-muted-foreground"> · {OWED_LABEL[gap.owedBy]}</span>
                      </div>
                    ))}
                  </div>
                );
              })}

              {a.unavailableReason && (
                <div className="text-xs text-muted-foreground">
                  No usable timeline on this conversation ({a.unavailableReason}).
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
