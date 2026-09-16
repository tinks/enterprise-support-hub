import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Info, Download } from "lucide-react";
import { format } from "date-fns";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { IssueDetailSheet, IssueField } from "@/components/issues/IssueDetailSheet";
import { displaySubject } from "@/lib/subjectDisplay";
import {
  idColumn,
  subjectColumn,
  contactColumn,
  customerColumn,
  ownerColumn,
  ageColumn,
} from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import { SamReviewCard, SAM_FAILURE_CATEGORIES, type SamReview as SamReviewRow } from "@/components/sam/SamReviewCard";

type Ticket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  subject_ai: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_domain: string | null;
  owner: string | null;
  product_area: string | null;
  classification: string | null;
  state: string | null;
  lifecycle_status: string;
  tags: string[];
  customer_key: string | null;
  customer_source: string | null;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
};

const ANY = "__any__";
const TAG_WRONG = "enterprise-sam-wrong";
const TAG_AVOID = "Sam - Avoid";

function fmtDate(v: string | null) {
  return v ? format(new Date(v), "d MMM yyyy") : "—";
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function SamReview() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [reviews, setReviews] = useState<Record<string, SamReviewRow>>({});
  const [loading, setLoading] = useState(true);
  const [tagScope, setTagScope] = useState<"wrong" | "avoid" | "both">("wrong");
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<"all" | "open" | "finalized">("all");
  const [category, setCategory] = useState(ANY);
  const [selected, setSelected] = useState<Ticket | null>(null);

  const { accountLabel } = useCustomerLabels();

  const load = async () => {
    setLoading(true);
    const tags =
      tagScope === "wrong" ? [TAG_WRONG] : tagScope === "avoid" ? [TAG_AVOID] : [TAG_WRONG, TAG_AVOID];
    const [ticketsRes, reviewsRes] = await Promise.all([
      supabase
        .from("intercom_tickets_v3")
        .select(
          "id,intercom_conversation_id,subject,subject_override,subject_ai,contact_name,contact_email,contact_domain,owner,product_area,classification,state,lifecycle_status,tags,customer_key,customer_source,intercom_created_at,intercom_closed_at",
        )
        .overlaps("tags", tags)
        .order("intercom_created_at", { ascending: false, nullsFirst: false })
        .limit(1000),
      supabase.from("sam_ticket_reviews").select("*"),
    ]);
    if (!ticketsRes.error) setRows((ticketsRes.data ?? []) as Ticket[]);
    if (!reviewsRes.error) {
      const map: Record<string, SamReviewRow> = {};
      for (const r of (reviewsRes.data ?? []) as SamReviewRow[]) map[r.conversation_id] = r;
      setReviews(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagScope]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (lifecycle === "open" && r.lifecycle_status !== "open") return false;
      if (lifecycle === "finalized" && r.lifecycle_status === "open") return false;
      if (category !== ANY) {
        const c = reviews[r.intercom_conversation_id]?.failure_category ?? null;
        if (category === "__uncategorised__" ? c !== null : c !== category) return false;
      }
      if (q) {
        const hay = [
          displaySubject(r),
          r.subject,
          r.contact_name,
          r.contact_email,
          r.contact_domain,
          r.intercom_conversation_id,
          reviews[r.intercom_conversation_id]?.review_note,
          ...(r.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, lifecycle, category, reviews]);

  const openCount = filtered.filter((r) => r.lifecycle_status === "open").length;
  const reviewedCount = filtered.filter((r) => reviews[r.intercom_conversation_id]?.failure_category).length;

  const categoryMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of filtered) {
      const c = reviews[r.intercom_conversation_id]?.failure_category ?? "Not categorised";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered, reviews]);

  const columns: IssueColumn<Ticket>[] = useMemo(
    () => [
      idColumn<Ticket>((r) => r.intercom_conversation_id),
      subjectColumn<Ticket>((r) => displaySubject(r), undefined, {
        conversationId: (r) => r.intercom_conversation_id,
        subjectRow: (r) => r,
        onSaved: (r, next) =>
          setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, subject_override: next } : x))),
      }),
      contactColumn<Ticket>(
        (r) => r.contact_name,
        (r) => r.contact_email,
      ),
      customerColumn<Ticket>((r) => r.customer_key, accountLabel),
      ownerColumn<Ticket>((r) => r.owner),
      {
        key: "product_area",
        header: "Product area",
        width: "w-[140px]",
        cellClassName: "text-xs",
        sortValue: (r) => r.product_area,
        cell: (r) => r.product_area || "—",
      },
      {
        key: "category",
        header: "Failure category",
        width: "w-[180px]",
        cellClassName: "text-xs",
        sortValue: (r) => reviews[r.intercom_conversation_id]?.failure_category,
        cell: (r) => reviews[r.intercom_conversation_id]?.failure_category || "—",
      },
      {
        key: "lifecycle",
        header: "Lifecycle",
        width: "w-[140px]",
        cellClassName: "text-xs",
        sortValue: (r) => `${r.lifecycle_status ?? ""} ${r.state ?? ""}`.trim(),
        cell: (r) => (
          <>
            {r.lifecycle_status}
            {r.state ? <span className="text-muted-foreground"> · {r.state}</span> : null}
          </>
        ),
      },
      ageColumn<Ticket>((r) => (r.intercom_created_at ? new Date(r.intercom_created_at).getTime() : null)),
    ],
    [accountLabel, reviews],
  );

  const exportCsv = () => {
    const header = [
      "conversation_id",
      "subject",
      "contact_email",
      "contact_domain",
      "customer",
      "owner",
      "product_area",
      "classification",
      "lifecycle_status",
      "tags",
      "failure_category",
      "review_note",
      "reviewed_by",
      "created_at",
      "closed_at",
    ];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const rev = reviews[r.intercom_conversation_id];
      lines.push(
        [
          r.intercom_conversation_id,
          displaySubject(r),
          r.contact_email,
          r.contact_domain,
          accountLabel(r.customer_key),
          r.owner,
          r.product_area,
          r.classification,
          r.lifecycle_status,
          (r.tags || []).join(" | "),
          rev?.failure_category,
          rev?.review_note,
          rev?.reviewed_by,
          r.intercom_created_at,
          r.intercom_closed_at,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sam-review-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sam review</h1>
            <p className="text-sm text-muted-foreground">
              Tickets tagged <code className="text-xs">enterprise-sam-wrong</code> in Intercom, with a Hub-only failure
              category and review note. Nothing here is written back to Intercom.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={exportCsv} size="sm" variant="outline" disabled={!filtered.length}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
            <Button onClick={load} size="sm" variant="outline" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Intercom tags populate on a full fetch, which runs as tickets close. A freshly tagged open ticket may not
            appear here until its next full sync.
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Tagged tickets" value={filtered.length} />
          <StatCard label="Open" value={openCount} />
          <StatCard label="Closed" value={filtered.length - openCount} />
          <StatCard label="Categorised" value={reviewedCount} />
        </div>

        {categoryMix.length > 0 && (
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-medium mb-2">Failure categories</div>
            <div className="flex flex-wrap gap-2">
              {categoryMix.map(([c, n]) => (
                <span key={c} className="rounded border bg-muted/40 px-2 py-1 text-xs">
                  {c} <span className="text-muted-foreground">· {n}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search subject, contact, note, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[280px] text-xs"
          />
          <Select value={tagScope} onValueChange={(v) => setTagScope(v as typeof tagScope)}>
            <SelectTrigger className="h-9 w-[240px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wrong">Tag: enterprise-sam-wrong</SelectItem>
              <SelectItem value="avoid">Tag: Sam - Avoid</SelectItem>
              <SelectItem value="both">Tag: both</SelectItem>
            </SelectContent>
          </Select>
          <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as typeof lifecycle)}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Lifecycle: all</SelectItem>
              <SelectItem value="open">Open only</SelectItem>
              <SelectItem value="finalized">Closed-side only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Category: any</SelectItem>
              <SelectItem value="__uncategorised__">Not categorised</SelectItem>
              {SAM_FAILURE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-2">
            {filtered.length} of {rows.length}
          </span>
        </div>

        <IssueTable<Ticket>
          rows={filtered}
          columns={columns}
          getRowKey={(r) => r.id}
          loading={loading}
          emptyMessage="No Sam-tagged tickets match these filters."
          onRowClick={(r) => setSelected(r)}
        />
      </div>

      <IssueDetailSheet
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={displaySubject(selected)}
        conversationId={selected?.intercom_conversation_id ?? null}
      >
        {selected && (
          <>
            <IssueField label="Intercom ID" value={selected.intercom_conversation_id} mono />
            <IssueField label="Lifecycle" value={selected.lifecycle_status} />
            <IssueField label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
            <IssueField label="Customer" value={accountLabel(selected.customer_key)} />
            <IssueField label="Owner" value={selected.owner} />
            <IssueField label="Product area" value={selected.product_area} />
            <IssueField label="Classification" value={selected.classification} />
            <IssueField label="Tags" value={(selected.tags || []).join(", ") || "—"} />
            <IssueField label="Created" value={fmtDate(selected.intercom_created_at)} />
            <IssueField label="Closed" value={fmtDate(selected.intercom_closed_at)} />
            <div className="pt-2">
              <SamReviewCard
                conversationId={selected.intercom_conversation_id}
                review={reviews[selected.intercom_conversation_id] ?? null}
                onSaved={(row) => setReviews((prev) => ({ ...prev, [row.conversation_id]: row }))}
                onDeleted={(cid) =>
                  setReviews((prev) => {
                    const next = { ...prev };
                    delete next[cid];
                    return next;
                  })
                }
              />
            </div>
          </>
        )}
      </IssueDetailSheet>
    </AppLayout>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
