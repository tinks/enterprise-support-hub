import { useEffect, useMemo, useState } from "react";
import { PlanBadge } from "@/components/PlanScopeSelect";
import { planTierOf } from "@/lib/planTier";
import {
  ACTIVE_LABEL,
  RAW_LABEL,
  SPLIT_LABEL,
  SPLIT_KEYS,
  SPLIT_CLASS,
  SPLIT_TOOLTIP,
  summarizeSplit,
  activeSeconds,
} from "@/lib/resolutionDisplay";
import { metricLabel } from "@/lib/reportingMetrics";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import { Loader2, RefreshCw, Info } from "lucide-react";

import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { IssueDetailSheet, IssueField } from "@/components/issues/IssueDetailSheet";
import {
  idColumn,
  subjectColumn,
  contactColumn,
  customerColumn,
  ageColumn,
} from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import { displaySubject } from "@/lib/subjectDisplay";
import { CLEAN_DATA_START_ISO, CLEAN_DATA_START_LABEL } from "./inbox-v3/constants";
import { excludeTestTickets, showTestDataNow } from "@/lib/testTickets";

type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  customer_key: string | null;
  plan_tier?: string | null;
  lifecycle_status: string | null;
  state: string | null;
  product_area: string | null;
  classification: string | null;
  tags: string[] | null;
  csat_rating: number | null;
  csat_remark: string | null;
  time_to_resolve_s: number | null;
  resolution_active_s: number | null;
  resolution_customer_wait_s: number | null;
  resolution_eng_wait_s: number | null;
  resolution_closed_s: number | null;
  resolution_window_s: number | null;
  active_clock_engine_version: number | null;
  time_to_triage_s: number | null;
  time_to_first_human_reply_s: number | null;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  last_synced_at: string | null;
};

const SELECT =
  "id,intercom_conversation_id,subject,subject_override,contact_name,contact_email,owner,customer_key,lifecycle_status,state,product_area,classification,tags,csat_rating,csat_remark,time_to_resolve_s,resolution_active_s,resolution_customer_wait_s,resolution_eng_wait_s,resolution_closed_s,resolution_window_s,active_clock_engine_version,time_to_triage_s,time_to_first_human_reply_s,intercom_created_at,intercom_closed_at,last_synced_at,plan_tier";

type Tab = "active" | "closed";

// Metric labels + accessors come from the shared standard; this page must not
// invent its own definition of "resolve time".

const ACTIVE_STATES = new Set(["open", "reopened_after_finalize"]);

const fmtDuration = (s: number | null) => {
  if (s == null) return "—";
  const h = s / 3600;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

type ListFilter = "all" | "at_risk" | "reopened";
type MixKey = "area" | "type";

const StatCard = ({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
  onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`rounded-lg border px-4 py-3 text-left transition-colors ${
      tone === "warn" ? "border-[#FF6B6B]/50 bg-[#FF6B6B]/5" : "border-border bg-card"
    } ${onClick ? "hover:bg-muted/60 cursor-pointer" : "cursor-default"}`}
  >
    <div className="text-xs text-muted-foreground truncate" title={label}>{label}</div>
    <div className="text-2xl font-semibold tabular-nums leading-tight pt-1">{value}</div>
    {sub && <div className="text-[11px] text-muted-foreground pt-0.5">{sub}</div>}
  </button>
);

const Panel = ({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border border-border bg-card p-4 space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);


const OwnerDashboardV3 = () => {
  const { owner } = useParams<{ owner: string }>();
  const ownerName = owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [mix, setMix] = useState<MixKey>("area");
  const [showAll, setShowAll] = useState(false);

  const { accountLabel } = useCustomerLabels();

  const load = async () => {
    if (!owner) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("intercom_tickets_v3")
      .select(SELECT)
      .ilike("owner", owner)
      .gte("intercom_created_at", CLEAN_DATA_START_ISO)
      .neq("lifecycle_status", "transferred_out")
      .order("intercom_created_at", { ascending: false })
      .limit(2000);

    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows(excludeTestTickets((data ?? []) as any, showTestDataNow()) as unknown as Row[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const { active, closed } = useMemo(() => {
    const a: Row[] = [];
    const c: Row[] = [];
    for (const r of rows) {
      if (ACTIVE_STATES.has(r.lifecycle_status ?? "")) a.push(r);
      else if (r.lifecycle_status === "finalized") c.push(r);
    }
    // Active: oldest first (the work that has waited longest).
    a.sort(
      (x, y) =>
        new Date(x.intercom_created_at ?? 0).getTime() - new Date(y.intercom_created_at ?? 0).getTime(),
    );
    // Closed: newest first.
    c.sort(
      (x, y) =>
        new Date(y.intercom_created_at ?? 0).getTime() - new Date(x.intercom_created_at ?? 0).getTime(),
    );
    return { active: a, closed: c };
  }, [rows]);

  const visible = useMemo(() => {
    const base = tab === "active" ? active : closed;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      [displaySubject(r), r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id, r.product_area, r.classification]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [tab, active, closed, search]);

  const baseColumns: IssueColumn<Row>[] = useMemo(
    () => [
      idColumn<Row>((r) => r.intercom_conversation_id),
      subjectColumn<Row>((r) => displaySubject(r)),
      contactColumn<Row>((r) => r.contact_name, (r) => r.contact_email),
      customerColumn<Row>((r) => r.customer_key, accountLabel),
      {
        key: "plan",
        header: "Plan",
        width: "w-[110px]",
        cellClassName: "text-xs",
        sortValue: (r) => planTierOf((r as any).plan_tier),
        cell: (r) => <PlanBadge value={(r as any).plan_tier} />,
      },
    ],
    [accountLabel],
  );

  const activeColumns: IssueColumn<Row>[] = useMemo(
    () => [
      ...baseColumns,
      {
        key: "lifecycle",
        header: "State",
        width: "w-[130px]",
        cellClassName: "text-xs",
        sortValue: (r) => (r.lifecycle_status === "reopened_after_finalize" ? "Reopened" : r.state || "open"),
        cell: (r) =>
          r.lifecycle_status === "reopened_after_finalize" ? (
            <Badge variant="outline" className="text-[10px]">Reopened</Badge>
          ) : (
            <span className="text-muted-foreground">{r.state || "open"}</span>
          ),
      },
      ageColumn<Row>((r) => (r.intercom_created_at ? new Date(r.intercom_created_at).getTime() : null)),
    ],
    [baseColumns],
  );

  const closedColumns: IssueColumn<Row>[] = useMemo(
    () => [
      ...baseColumns,
      {
        key: "product_area",
        header: "Product area",
        width: "w-[150px]",
        cellClassName: "text-xs",
        sortValue: (r) => r.product_area,
        cell: (r) => r.product_area || "—",
      },
      {
        key: "classification",
        header: "Type",
        width: "w-[140px]",
        cellClassName: "text-xs",
        sortValue: (r) => r.classification,
        cell: (r) => r.classification || "—",
      },
      {
        key: "tags",
        header: "Tags",
        width: "w-[170px]",
        cellClassName: "text-xs",
        sortValue: (r) => (r.tags && r.tags.length ? r.tags.join(", ") : null),
        cell: (r) =>
          r.tags && r.tags.length ? (
            <span className="text-muted-foreground truncate block">{r.tags.join(", ")}</span>
          ) : (
            "—"
          ),
      },
      {
        key: "csat",
        header: "CSAT",
        width: "w-[80px]",
        sortValue: (r) => r.csat_rating,
        cellClassName: "text-xs tabular-nums",
        cell: (r) => (r.csat_rating == null ? "—" : String(r.csat_rating)),
      },
      {
        // Active clock only — the shared reporting standard. Raw wall clock
        // stays available in the detail pane, explicitly labelled.
        key: "resolve",
        header: ACTIVE_LABEL,
        width: "w-[140px]",
        sortValue: (r) => activeSeconds(r),
        cellClassName: "text-xs tabular-nums",
        cell: (r) => fmtDuration(activeSeconds(r)),
      },
      {
        key: "created",
        header: "Created",
        width: "w-[110px]",
        sortValue: (r) => (r.intercom_created_at ? new Date(r.intercom_created_at).getTime() : null),
        cellClassName: "text-xs text-muted-foreground",
        cell: (r) => (r.intercom_created_at ? format(new Date(r.intercom_created_at), "d MMM yyyy") : "—"),
      },
    ],
    [baseColumns],
  );

  const oldestActiveDays = useMemo(() => {
    const first = active[0]?.intercom_created_at;
    if (!first) return null;
    return Math.floor((Date.now() - new Date(first).getTime()) / 86_400_000);
  }, [active]);

  const ageDays = (r: Row) =>
    r.intercom_created_at ? (Date.now() - new Date(r.intercom_created_at).getTime()) / 86_400_000 : 0;

  const median = (xs: number[]) => {
    const s = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // ---- Dashboard aggregates (all durations come from the shared SLA clocks) ----
  const stats = useMemo(() => {
    const atRisk = active.filter((r) => ageDays(r) > 7);
    const reopened = active.filter((r) => r.lifecycle_status === "reopened_after_finalize");

    const bands = [
      { label: "< 1d", rows: active.filter((r) => ageDays(r) < 1) },
      { label: "1–3d", rows: active.filter((r) => ageDays(r) >= 1 && ageDays(r) < 3) },
      { label: "3–7d", rows: active.filter((r) => ageDays(r) >= 3 && ageDays(r) < 7) },
      { label: "7d+", rows: atRisk },
    ];

    const medActive = median(
      closed.map((r) => activeSeconds(r)).filter((n): n is number => n != null),
    );

    const csatRows = closed.filter((r) => r.csat_rating != null);
    const csatAvg = csatRows.length
      ? csatRows.reduce((a, r) => a + (r.csat_rating ?? 0), 0) / csatRows.length
      : null;

    // Where the time went, for this owner's finalized cohort — shared engine only.
    const split = summarizeSplit(closed);

    // Opened vs finalized, last 8 weeks.
    const weekStart = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    };
    const weeks: { key: string; label: string; opened: number; finalized: number }[] = [];
    const thisWeek = weekStart(new Date());
    for (let i = 7; i >= 0; i--) {
      const d = new Date(thisWeek);
      d.setDate(d.getDate() - i * 7);
      weeks.push({ key: d.toISOString().slice(0, 10), label: format(d, "d MMM"), opened: 0, finalized: 0 });
    }
    const byKey = new Map(weeks.map((w) => [w.key, w]));
    for (const r of rows) {
      if (r.intercom_created_at) {
        const w = byKey.get(weekStart(new Date(r.intercom_created_at)).toISOString().slice(0, 10));
        if (w) w.opened++;
      }
      if (r.intercom_closed_at) {
        const w = byKey.get(weekStart(new Date(r.intercom_closed_at)).toISOString().slice(0, 10));
        if (w) w.finalized++;
      }
    }
    const weekMax = Math.max(1, ...weeks.map((w) => Math.max(w.opened, w.finalized)));

    const mixOf = (pick: (r: Row) => string | null) => {
      const m = new Map<string, number>();
      for (const r of closed) m.set(pick(r) || "Unspecified", (m.get(pick(r) || "Unspecified") ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    };

    return {
      atRisk,
      reopened,
      bands,
      medActive,
      csatAvg,
      csatN: csatRows.length,
      split,
      weeks,
      weekMax,
      areaMix: mixOf((r) => r.product_area),
      typeMix: mixOf((r) => r.classification),
    };
  }, [active, closed, rows]);

  const needsAttention = useMemo(
    () =>
      [...active]
        .sort((a, b) => ageDays(b) - ageDays(a))
        .slice(0, 8),
    [active],
  );
  const recentlyFinalized = useMemo(() => closed.slice(0, 8), [closed]);

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{ownerName}'s dashboard</h1>
              <Badge variant="outline" className="text-[10px]">Read-only</Badge>
              <Badge variant="outline" className="text-[10px]">v3 reporting set</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Enterprise Intercom tickets owned by {ownerName || "—"} since {CLEAN_DATA_START_LABEL}. Slack, Gmail and
              manual-only conversations live on the legacy dashboard.
            </p>
          </div>
          <Button onClick={load} size="sm" variant="outline" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Failed to load: {error}
          </div>
        )}

        {/* ---- Row 1: decision cards ---- */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Open now"
            value={String(active.length)}
            sub={oldestActiveDays != null ? `oldest ${oldestActiveDays}d` : "nothing open"}
            onClick={() => { setTab("active"); setListFilter("all"); }}
          />
          <StatCard
            label="At risk"
            value={String(stats.atRisk.length)}
            sub="open more than 7 days"
            tone={stats.atRisk.length > 0 ? "warn" : undefined}
            onClick={() => { setTab("active"); setListFilter("at_risk"); }}
          />
          <StatCard
            label={ACTIVE_LABEL + " — median"}
            value={stats.medActive == null ? "—" : fmtDuration(stats.medActive)}
            sub={`${closed.length} finalized`}
          />
          <StatCard
            label="CSAT"
            value={stats.csatAvg == null ? "—" : stats.csatAvg.toFixed(2)}
            sub={stats.csatN ? `${stats.csatN} responses` : "no responses yet"}
          />
        </div>

        {/* ---- Row 2: ageing + resolution anatomy ---- */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Workload and ageing" desc="Active tickets by how long they have been open.">
            {stats.bands.map((b) => {
              const pct = active.length ? (b.rows.length / active.length) * 100 : 0;
              return (
                <div key={b.label} className="flex items-center gap-3 text-xs">
                  <span className="w-12 text-muted-foreground">{b.label}</span>
                  <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
                    <div
                      className={b.label === "7d+" ? "h-full bg-[#FF6B6B]" : "h-full bg-primary"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums">{b.rows.length}</span>
                </div>
              );
            })}
            {active.length === 0 && <p className="text-xs text-muted-foreground">No active tickets.</p>}
          </Panel>

          <Panel
            title="Where the time went"
            desc={`Finalized cohort, shared SLA clocks. n=${stats.split.n}${
              stats.split.noSplit ? `, ${stats.split.noSplit} without a split` : ""
            }`}
          >
            <div className="flex h-3 w-full overflow-hidden rounded">
              {SPLIT_KEYS.map((k) => (
                <div
                  key={k}
                  className={SPLIT_CLASS[k]}
                  style={{ width: `${stats.split.share[k] ?? 0}%` }}
                  title={SPLIT_TOOLTIP[k]}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
              {SPLIT_KEYS.map((k) => (
                <div key={k} className="flex items-center justify-between gap-2 text-xs" title={SPLIT_TOOLTIP[k]}>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={`h-2 w-2 rounded-sm ${SPLIT_CLASS[k]}`} />
                    {SPLIT_LABEL[k]}
                  </span>
                  <span className="tabular-nums">
                    {stats.split.share[k] == null ? "—" : `${(stats.split.share[k] as number).toFixed(0)}%`}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ---- Row 3: throughput + work mix ---- */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Throughput" desc="Opened vs finalized, last 8 weeks.">
            <div className="flex items-end gap-2 h-28">
              {stats.weeks.map((w) => (
                <div key={w.key} className="flex-1 flex flex-col items-center gap-1" title={`${w.label}: ${w.opened} opened, ${w.finalized} finalized`}>
                  <div className="flex items-end gap-0.5 h-24 w-full justify-center">
                    <div className="w-2.5 rounded-t bg-primary" style={{ height: `${(w.opened / stats.weekMax) * 100}%` }} />
                    <div className="w-2.5 rounded-t bg-[#9B87F5]" style={{ height: `${(w.finalized / stats.weekMax) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{w.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary" />Opened</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#9B87F5]" />Finalized</span>
            </div>
          </Panel>

          <Panel
            title="Work mix"
            desc="Finalized tickets by what they were about."
            action={
              <div className="inline-flex rounded-md border border-border p-0.5">
                {([["area", "Product area"], ["type", "Ticket type"]] as Array<[MixKey, string]>).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMix(k)}
                    className={`rounded px-2 py-1 text-[11px] transition-colors ${
                      mix === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            }
          >
            {(mix === "area" ? stats.areaMix : stats.typeMix).map(([label, n]) => {
              const pct = closed.length ? (n / closed.length) * 100 : 0;
              return (
                <div key={label} className="flex items-center gap-3 text-xs">
                  <span className="w-32 truncate text-muted-foreground" title={label}>{label}</span>
                  <div className="h-2 flex-1 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-[#E66FD2]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right tabular-nums">{n}</span>
                </div>
              );
            })}
            {closed.length === 0 && <p className="text-xs text-muted-foreground">No finalized tickets yet.</p>}
          </Panel>
        </div>

        {/* ---- Row 4: focused worklists ---- */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {([
              ["active", `Needs attention (${listFilter === "at_risk" ? stats.atRisk.length : active.length})`],
              ["closed", `Recently finalized (${closed.length})`],
            ] as Array<[Tab, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded px-3 py-1.5 text-xs transition-colors ${
                  tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {tab === "active" && (
              <div className="inline-flex rounded-md border border-border p-0.5">
                {([
                  ["all", "All active"],
                  ["at_risk", "7d+"],
                  ["reopened", "Reopened"],
                ] as Array<[ListFilter, string]>).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setListFilter(k)}
                    className={`rounded px-2 py-1 text-[11px] transition-colors ${
                      listFilter === k ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, contact, Intercom ID…"
              className="w-64 h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show top 8" : "View all"}
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            This is the reporting view. Day-to-day queue work will live on its own page under Issues; these lists are the
            shortlist that the cards above link into.
          </span>
        </div>

        <IssueTable
          rows={visible}
          columns={tab === "active" ? activeColumns : closedColumns}
          getRowKey={(r) => r.id}
          loading={loading}
          emptyMessage={
            tab === "active"
              ? `No active v3 tickets owned by ${ownerName}.`
              : `No finalized v3 tickets owned by ${ownerName}.`
          }
          rowClassName={(r) =>
            tab === "active" &&
            r.intercom_created_at &&
            Date.now() - new Date(r.intercom_created_at).getTime() > 14 * 86_400_000
              ? "bg-amber-50/50"
              : undefined
          }
          onRowClick={(r) => setSelected(r)}
        />

        <p className="text-xs text-muted-foreground">
          Showing all {visible.length} {tab === "active" ? "active" : "closed"} conversations
          {search.trim() ? " matching the search" : ""}.
        </p>

        <IssueDetailSheet
          open={!!selected}
          onOpenChange={(o) => !o && setSelected(null)}
          title={selected ? displaySubject(selected) : ""}
          conversationId={selected?.intercom_conversation_id ?? null}
        >
          {selected && (
            <>
              <IssueField label="Intercom ID" value={selected.intercom_conversation_id} mono />
              <IssueField label="Owner" value={selected.owner} />
              <IssueField label="Customer" value={accountLabel(selected.customer_key)} />
              <IssueField label="Contact" value={selected.contact_name} />
              <IssueField label="Email" value={selected.contact_email} />
              <IssueField label="Lifecycle" value={selected.lifecycle_status} />
              <IssueField label="Intercom state" value={selected.state} />
              <IssueField label="Product area" value={selected.product_area} />
              <IssueField label="Type" value={selected.classification} />
              <IssueField label="Tags" value={selected.tags?.length ? selected.tags.join(", ") : null} />
              <IssueField label="CSAT" value={selected.csat_rating == null ? null : String(selected.csat_rating)} />
              <IssueField label="CSAT remark" value={selected.csat_remark} />
              <IssueField label={ACTIVE_LABEL} value={fmtDuration(activeSeconds(selected))} />
              <IssueField
                label={SPLIT_LABEL.customerWait}
                value={fmtDuration(selected.resolution_customer_wait_s)}
              />
              <IssueField label={SPLIT_LABEL.engWait} value={fmtDuration(selected.resolution_eng_wait_s)} />
              <IssueField label={SPLIT_LABEL.closed} value={fmtDuration(selected.resolution_closed_s)} />
              <IssueField label={RAW_LABEL} value={fmtDuration(selected.time_to_resolve_s)} />
              <IssueField
                label={metricLabel("time_to_triage")}
                value={fmtDuration(selected.time_to_triage_s)}
              />
              <IssueField
                label={metricLabel("time_to_first_human_reply")}
                value={fmtDuration(selected.time_to_first_human_reply_s)}
              />
              <IssueField
                label="Created"
                value={
                  selected.intercom_created_at
                    ? format(new Date(selected.intercom_created_at), "d MMM yyyy HH:mm")
                    : null
                }
              />
              <IssueField
                label="Closed"
                value={
                  selected.intercom_closed_at
                    ? format(new Date(selected.intercom_closed_at), "d MMM yyyy HH:mm")
                    : null
                }
              />
              <IssueField
                label="Last synced"
                value={selected.last_synced_at ? format(new Date(selected.last_synced_at), "d MMM HH:mm") : null}
              />
            </>
          )}
        </IssueDetailSheet>
      </div>
    </AppLayout>
  );
};

export default OwnerDashboardV3;
