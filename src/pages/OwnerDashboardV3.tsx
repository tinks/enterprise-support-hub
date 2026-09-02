import { useEffect, useMemo, useState } from "react";
import { PlanBadge } from "@/components/PlanScopeSelect";
import { planTierOf } from "@/lib/planTier";
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
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  last_synced_at: string | null;
};

const SELECT =
  "id,intercom_conversation_id,subject,subject_override,contact_name,contact_email,owner,customer_key,lifecycle_status,state,product_area,classification,tags,csat_rating,csat_remark,time_to_resolve_s,intercom_created_at,intercom_closed_at,last_synced_at,plan_tier";

type Tab = "active" | "closed";

const ACTIVE_STATES = new Set(["open", "reopened_after_finalize"]);

const fmtDuration = (s: number | null) => {
  if (s == null) return "—";
  const h = s / 3600;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

const OwnerDashboardV3 = () => {
  const { owner } = useParams<{ owner: string }>();
  const ownerName = owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "";

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);

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
        key: "resolve",
        header: "Resolve",
        width: "w-[100px]",
        sortValue: (r) => r.time_to_resolve_s,
        cellClassName: "text-xs tabular-nums",
        cell: (r) => fmtDuration(r.time_to_resolve_s),
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

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{ownerName} — v3</h1>
              <Badge variant="outline" className="text-[10px]">Read-only</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Enterprise Intercom tickets owned by {ownerName || "—"} from the v3 reporting set, since{" "}
              {CLEAN_DATA_START_LABEL}. Slack, Gmail and manual-only conversations that never became an Intercom
              ticket live on the legacy dashboard.
            </p>
          </div>
          <Button onClick={load} size="sm" variant="outline" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>

        <div className="inline-flex rounded-md border border-border p-0.5">
          {([
            ["active", `Active (${active.length})`],
            ["closed", `Closed (${closed.length})`],
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

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Active = open or reopened (oldest first{oldestActiveDays != null ? `, oldest ${oldestActiveDays}d` : ""}).
            Closed = finalized. Transferred-out tickets are excluded. Everything loads in one pass — scroll, no pager.
          </span>
        </div>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, contact, Intercom ID…"
          className="max-w-sm h-8 text-sm"
        />

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Failed to load: {error}
          </div>
        )}

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
              <IssueField label="Resolve time" value={fmtDuration(selected.time_to_resolve_s)} />
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
