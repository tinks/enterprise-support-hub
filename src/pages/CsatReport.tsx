import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, CalendarIcon, Beaker, Download } from "lucide-react";
import {
  format, startOfMonth, endOfMonth, subMonths, subDays, startOfDay, endOfDay, max as maxDate,
} from "date-fns";
import { CLEAN_DATA_START_DATE } from "@/pages/inbox-v3/constants";
import { displaySubject } from "@/lib/subjectDisplay";
import {
  summarizeCsat, isRatingCounted, csatExclusionNote, useCsatFilters, useCsatOverrides,
} from "@/lib/csat";
import { CsatFilterMenu } from "@/components/csat/CsatFilterMenu";
import { CsatOverrideDialog } from "@/components/csat/CsatOverrideDialog";
import { IntercomIdChip } from "@/components/issues/IssueTable";
import { SortableHead, useTableSort } from "@/components/issues/useTableSort";
import { Link } from "react-router-dom";

import { PlanScopeSelect } from "@/components/PlanScopeSelect";
import { inPlanScope, type PlanScope } from "@/lib/planTier";
import { excludeTestTickets, showTestDataNow } from "@/lib/testTickets";

const sel = (s: string): string => s;
const SELECT_COLS = sel(
  "id,intercom_conversation_id,subject,subject_override,subject_ai,csat_rating,csat_remark,csat_rated_at," +
  "csat_rater_name,csat_rater_email,csat_rater_is_internal,contact_name,contact_email," +
  "customer_key,owner,classification,finalized_at,intercom_created_at,plan_tier,is_test_ticket",
);

const CSAT_EMOJI: Record<number, string> = { 1: "😠", 2: "🙁", 3: "😐", 4: "😀", 5: "🤩" };

type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  subject_ai: string | null;
  csat_rating: number | null;
  csat_remark: string | null;
  csat_rated_at: string | null;
  csat_rater_name: string | null;
  csat_rater_email: string | null;
  csat_rater_is_internal: boolean | null;
  contact_name: string | null;
  contact_email: string | null;
  customer_key: string | null;
  owner: string | null;
  classification: string | null;
  finalized_at: string | null;
  intercom_created_at: string | null;
};

type AccountOpt = { account_key: string; label: string };

type RangePreset = "7d" | "14d" | "30d" | "this_month" | "last_month" | "custom";

function clampToFloor(d: Date): Date {
  return maxDate([d, CLEAN_DATA_START_DATE]);
}

function computeRange(preset: RangePreset, from?: Date, to?: Date): { from: Date; to: Date } {
  const now = new Date();
  let raw: { from: Date; to: Date };
  if (preset === "7d") raw = { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
  else if (preset === "14d") raw = { from: startOfDay(subDays(now, 13)), to: endOfDay(now) };
  else if (preset === "30d") raw = { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
  else if (preset === "this_month") raw = { from: startOfMonth(now), to: endOfMonth(now) };
  else if (preset === "last_month") {
    const lm = subMonths(now, 1);
    raw = { from: startOfMonth(lm), to: endOfMonth(lm) };
  } else {
    raw = {
      from: from ? startOfDay(from) : startOfDay(subDays(now, 29)),
      to: to ? endOfDay(to) : endOfDay(now),
    };
  }
  return { from: clampToFloor(raw.from), to: raw.to };
}

export default function CsatReport() {
  const [preset, setPreset] = useState<RangePreset>("this_month");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [csatFilters, setCsatFilters] = useCsatFilters();
  const { overrides: csatOverrides, refresh: refreshOverrides } = useCsatOverrides();

  const [rows, setRows] = useState<Row[]>([]);
  const [closedInRange, setClosedInRange] = useState<number>(0);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [customerFilter, setCustomerFilter] = useState<string>("__any__");
  // CSAT applies to both plans, so the default scope is All plans.
  const [planScope, setPlanScope] = useState<PlanScope>("all");
  const [ratingFilter, setRatingFilter] = useState<string>("__any__");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const range = useMemo(() => computeRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("v3_customer_accounts").select("account_key,label").order("label");
      setAccounts((data ?? []) as AccountOpt[]);
    })();
  }, []);

  const accountLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.account_key, a.label);
    return (key: string | null) => {
      if (!key) return "—";
      if (key === "unknown") return "Unknown";
      if (key === "domain:_personal") return "Personal email";
      if (key.startsWith("domain:")) return key.slice(7);
      return m.get(key) ?? key;
    };
  }, [accounts]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fromIso = range.from.toISOString();
        const toIso = range.to.toISOString();

        // Rated tickets, anchored on when the rating was given.
        const all: Row[] = [];
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select(SELECT_COLS)
            .not("csat_rating", "is", null)
            .gte("csat_rated_at", fromIso)
            .lte("csat_rated_at", toIso)
            .order("csat_rated_at", { ascending: false })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as unknown as Row[];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }

        // Denominator for the response rate: tickets finalized in the same window.
        let denom = supabase
          .from("intercom_tickets_v3")
          .select("id", { count: "exact", head: true })
          .eq("lifecycle_status", "finalized")
          .gte("finalized_at", fromIso)
          .lte("finalized_at", toIso);
        if (!showTestDataNow()) denom = denom.eq("is_test_ticket", false);
        const { count, error: cErr } = await denom;
        if (cErr) throw cErr;

        if (!cancelled) {
          setRows(excludeTestTickets(all as any, showTestDataNow()) as Row[]);
          setClosedInRange(count ?? 0);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from.getTime(), range.to.getTime(), refreshKey]);

  const scoped = useMemo(() => {
    let r = rows;
    if (planScope !== "all") r = r.filter((x) => inPlanScope((x as any).plan_tier, planScope));
    if (customerFilter !== "__any__") r = r.filter((x) => x.customer_key === customerFilter);
    if (ratingFilter !== "__any__") r = r.filter((x) => String(x.csat_rating) === ratingFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      r = r.filter((x) =>
        [
          displaySubject(x), x.csat_remark, x.contact_name, x.contact_email,
          x.csat_rater_name, x.csat_rater_email, x.intercom_conversation_id, x.owner,
        ].some((v) => (v ?? "").toString().toLowerCase().includes(needle)),
      );
    }
    return r;
  }, [rows, customerFilter, ratingFilter, q]);

  const { sorted: sortedRows, sort, toggle } = useTableSort<Row>(scoped, {
    rating: (r) => r.csat_rating,
    subject: (r) => displaySubject(r),
    intercom_id: (r) => r.intercom_conversation_id,
    customer: (r) => accountLabel(r.customer_key),
    rater: (r) => r.csat_rater_name ?? r.contact_name ?? r.csat_rater_email ?? r.contact_email,
    remark: (r) => r.csat_remark,
    rated_at: (r) => (r.csat_rated_at ? new Date(r.csat_rated_at).getTime() : null),
    owner: (r) => r.owner,
    counting: (r) => (isRatingCounted(r, csatOverrides, csatFilters) ? "Counted" : "Not counted"),
  });

  const summary = useMemo(
    () => summarizeCsat(scoped, csatOverrides, csatFilters),
    [scoped, csatOverrides, csatFilters],
  );

  const distribution = useMemo(() => {
    const counted = scoped.filter((r) => isRatingCounted(r, csatOverrides, csatFilters));
    const buckets = [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: counted.filter((r) => r.csat_rating === star).length,
    }));
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return buckets.map((b) => ({ ...b, barPct: (b.count / max) * 100, pct: counted.length ? (b.count / counted.length) * 100 : 0 }));
  }, [scoped, csatOverrides, csatFilters]);

  const responseRate = closedInRange > 0 ? (summary.n / closedInRange) * 100 : null;
  const note = csatExclusionNote(summary);

  const exportCsv = () => {
    const head = [
      "intercom_id", "subject", "rating", "counted", "internal_rater", "overridden",
      "remark", "rated_at", "rater_name", "rater_email", "customer", "owner", "type",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const r of scoped) {
      lines.push([
        r.intercom_conversation_id,
        displaySubject(r),
        r.csat_rating,
        isRatingCounted(r, csatOverrides, csatFilters) ? "yes" : "no",
        r.csat_rater_is_internal ? "yes" : "no",
        csatOverrides.has(r.id) ? "yes" : "no",
        r.csat_remark,
        r.csat_rated_at,
        r.csat_rater_name ?? r.contact_name,
        r.csat_rater_email ?? r.contact_email,
        accountLabel(r.customer_key),
        r.owner,
        r.classification,
      ].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `csat-${format(range.from, "yyyy-MM-dd")}_${format(range.to, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Beaker className="h-3.5 w-3.5" /> Sandbox · v3
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">CSAT report</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every rated ticket in the window, anchored on when the rating was given
              (<code className="text-xs">csat_rated_at</code>). Internal raters and overridden ratings are shown, not
              hidden — the counting rules below decide which ones feed the averages.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || scoped.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Range</span>
              <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="14d">Last 14 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="last_month">Last month</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {preset === "custom" && (
              <div className="flex items-center gap-2">
                <DateField label="From" date={customFrom} onSelect={setCustomFrom} minDate={CLEAN_DATA_START_DATE} />
                <DateField label="To" date={customTo} onSelect={setCustomTo} minDate={CLEAN_DATA_START_DATE} />
              </div>
            )}

            <div className="text-xs text-muted-foreground ml-1">
              {format(range.from, "MMM d, yyyy")} → {format(range.to, "MMM d, yyyy")}
            </div>

            <PlanScopeSelect value={planScope} onChange={setPlanScope} className="w-[200px] h-9 text-xs" />
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-[200px] h-9 text-xs"><SelectValue placeholder="Customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Customer: any</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>
                ))}
                <SelectItem value="domain:_personal">Personal email</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>

            <Select value={ratingFilter} onValueChange={setRatingFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue placeholder="Rating" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Rating: any</SelectItem>
                {[5, 4, 3, 2, 1].map((s) => (
                  <SelectItem key={s} value={String(s)}>{CSAT_EMOJI[s]} {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject, remark, rater, Intercom ID…"
              className="h-9 w-[280px] text-xs"
            />

            <div className="ml-auto">
              <CsatFilterMenu filters={csatFilters} onChange={setCsatFilters} summary={summary} />
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card><CardContent className="p-4 text-sm text-destructive">Failed to load: {error}</CardContent></Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi
            title="Average CSAT"
            value={loading ? "…" : summary.avg != null ? summary.avg.toFixed(2) : "—"}
            sub={`${summary.n} counted of ${summary.rawN} ratings${note ? ` · ${note}` : ""}`}
          />
          <Kpi
            title="Positive (4–5)"
            value={loading ? "…" : summary.pctPositive != null ? `${summary.pctPositive.toFixed(0)}%` : "—"}
            sub={summary.n ? `${Math.round((summary.pctPositive ?? 0) / 100 * summary.n)} of ${summary.n} counted` : "no counted ratings"}
          />
          <Kpi
            title="Response rate"
            value={loading ? "…" : responseRate != null ? `${responseRate.toFixed(1)}%` : "—"}
            sub={`${summary.n} counted ratings / ${closedInRange.toLocaleString()} tickets closed in window`}
          />
          <Kpi
            title="Excluded from the average"
            value={loading ? "…" : String(summary.internalExcluded + summary.overriddenExcluded)}
            sub={`${summary.internalExcluded} internal rater · ${summary.overriddenExcluded} overridden`}
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Rating distribution</CardTitle>
            <CardDescription>Counted ratings only — internal and overridden ratings follow the counting rules above.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {distribution.map((b) => (
              <div key={b.star} className="flex items-center gap-3">
                <div className="w-16 text-sm">{CSAT_EMOJI[b.star]} {b.star}</div>
                <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${b.barPct}%` }} />
                </div>
                <div className="w-28 text-xs text-muted-foreground text-right">
                  {b.count} ({b.pct.toFixed(0)}%)
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Rated tickets</CardTitle>
              <CardDescription>
                {loading ? "Loading…" : `${scoped.length} rated ticket${scoped.length === 1 ? "" : "s"} in window`}
              </CardDescription>
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead sortKey="rating" sort={sort} onToggle={toggle} className="w-[80px]">Rating</SortableHead>
                    <SortableHead sortKey="subject" sort={sort} onToggle={toggle} className="min-w-[280px]">Subject</SortableHead>
                    <SortableHead sortKey="intercom_id" sort={sort} onToggle={toggle} className="w-[140px]">Intercom ID</SortableHead>
                    <SortableHead sortKey="customer" sort={sort} onToggle={toggle} className="w-[160px]">Customer</SortableHead>
                    <SortableHead sortKey="rater" sort={sort} onToggle={toggle} className="min-w-[220px]">Rated by</SortableHead>
                    <SortableHead sortKey="remark" sort={sort} onToggle={toggle} className="min-w-[240px]">Remark</SortableHead>
                    <SortableHead sortKey="rated_at" sort={sort} onToggle={toggle} className="w-[120px]">Rated</SortableHead>
                    <SortableHead sortKey="owner" sort={sort} onToggle={toggle} className="w-[120px]">Owner</SortableHead>
                    <SortableHead sortKey="counting" sort={sort} onToggle={toggle} className="w-[180px]">Counting</SortableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">
                        No rated tickets in this window.
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedRows.map((r) => {
                    const overridden = csatOverrides.get(r.id) ?? null;
                    const counted = isRatingCounted(r, csatOverrides, csatFilters);
                    return (
                      <TableRow key={r.id} className={counted ? "" : "opacity-60"}>
                        <TableCell className="text-left">
                          <span className={overridden && csatFilters.excludeOverridden ? "line-through" : ""}>
                            {CSAT_EMOJI[r.csat_rating ?? 0]} {r.csat_rating}
                          </span>
                        </TableCell>
                        <TableCell className="text-left text-sm">
                          <Link
                            to={`/inbox-v3?tab=${r.finalized_at ? "finalized" : "active"}&q=${encodeURIComponent(r.intercom_conversation_id)}`}
                            className="hover:underline"
                            title="Open in Inbox v3"
                          >
                            {displaySubject(r)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-left"><IntercomIdChip id={r.intercom_conversation_id} /></TableCell>
                        <TableCell className="text-left text-xs">{accountLabel(r.customer_key)}</TableCell>
                        <TableCell className="text-left text-xs">
                          <div>{r.csat_rater_name ?? r.contact_name ?? "—"}</div>
                          <div className="text-muted-foreground">{r.csat_rater_email ?? r.contact_email ?? ""}</div>
                        </TableCell>
                        <TableCell className="text-left text-xs">{r.csat_remark || "—"}</TableCell>
                        <TableCell className="text-left text-xs">
                          {r.csat_rated_at ? format(new Date(r.csat_rated_at), "MMM d, yyyy") : "—"}
                        </TableCell>
                        <TableCell className="text-left text-xs">{r.owner ?? "—"}</TableCell>
                        <TableCell className="text-left">
                          <div className="flex flex-col items-start gap-1">
                            <div className="flex flex-wrap gap-1">
                              {r.csat_rater_is_internal ? (
                                <Badge variant="secondary" className="text-[10px]">Internal rater</Badge>
                              ) : null}
                              {overridden ? (
                                <Badge variant="outline" className="text-[10px]" title={overridden.reason}>Overridden</Badge>
                              ) : null}
                              {counted ? null : (
                                <Badge variant="outline" className="text-[10px]">Not counted</Badge>
                              )}
                            </div>
                            <CsatOverrideDialog
                              ticketId={r.id}
                              conversationId={r.intercom_conversation_id}
                              rating={r.csat_rating}
                              existing={overridden}
                              onSaved={refreshOverrides}
                            />
                            {overridden ? (
                              <div className="text-[11px] text-muted-foreground max-w-[220px]">
                                {overridden.reason}
                                <span className="block">
                                  {overridden.created_by_email ?? "unknown"} · {format(new Date(overridden.created_at), "MMM d, yyyy")}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function Kpi({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {sub ? <div className="text-xs text-muted-foreground mt-1">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function DateField({
  label, date, onSelect, minDate,
}: { label: string; date?: Date; onSelect: (d?: Date) => void; minDate?: Date }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 justify-start font-normal">
          <CalendarIcon className="h-3.5 w-3.5 mr-2" />
          {date ? format(date, "MMM d, yyyy") : <span className="text-muted-foreground">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onSelect}
          disabled={minDate ? (d) => d < minDate : undefined}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
