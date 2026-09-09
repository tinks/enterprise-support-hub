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
import { idColumn, subjectColumn, contactColumn, customerColumn, ownerColumn, ageColumn } from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";

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
const TAG_PROSPECT = "enterprise-prospect";
const TAG_PERSONAL = "enterprise-prospect-personal-acct";

function fmtDate(v: string | null) {
  return v ? format(new Date(v), "d MMM yyyy") : "—";
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Prospects() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagScope, setTagScope] = useState<"prospect" | "personal" | "both">("prospect");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(ANY);
  const [pa, setPa] = useState(ANY);
  const [lifecycle, setLifecycle] = useState<"all" | "open" | "finalized">("all");
  const [selected, setSelected] = useState<Ticket | null>(null);

  const { accountLabel } = useCustomerLabels();

  const load = async () => {
    setLoading(true);
    const tags = tagScope === "prospect" ? [TAG_PROSPECT] : tagScope === "personal" ? [TAG_PERSONAL] : [TAG_PROSPECT, TAG_PERSONAL];
    const { data, error } = await supabase
      .from("intercom_tickets_v3")
      .select(
        "id,intercom_conversation_id,subject,subject_override,subject_ai,contact_name,contact_email,contact_domain,owner,product_area,classification,state,lifecycle_status,tags,customer_key,customer_source,intercom_created_at,intercom_closed_at",
      )
      .overlaps("tags", tags)
      .order("intercom_created_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (!error) setRows((data ?? []) as Ticket[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tagScope]);

  const ownerOpts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.owner).filter(Boolean))).sort() as string[],
    [rows],
  );
  const paOpts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.product_area).filter(Boolean))).sort() as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (owner !== ANY && r.owner !== owner) return false;
      if (pa !== ANY && r.product_area !== pa) return false;
      if (lifecycle === "open" && r.lifecycle_status !== "open") return false;
      if (lifecycle === "finalized" && r.lifecycle_status === "open") return false;
      if (q) {
        const hay = [displaySubject(r), r.subject, r.contact_name, r.contact_email, r.contact_domain, r.intercom_conversation_id, ...(r.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, owner, pa, lifecycle]);

  const columns: IssueColumn<Ticket>[] = useMemo(() => [
    idColumn<Ticket>((r) => r.intercom_conversation_id),
    subjectColumn<Ticket>((r) => displaySubject(r), undefined, {
      conversationId: (r) => r.intercom_conversation_id,
      subjectRow: (r) => r,
      onSaved: (r, next) =>
        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, subject_override: next } : x))),
    }),
    contactColumn<Ticket>((r) => r.contact_name, (r) => r.contact_email),
    customerColumn<Ticket>((r) => r.customer_key, accountLabel),
    ownerColumn<Ticket>((r) => r.owner),
    { key: "domain", header: "Domain", width: "w-[160px]", cellClassName: "text-xs truncate", sortValue: (r) => r.contact_domain, cell: (r) => r.contact_domain || "—" },
    { key: "product_area", header: "Product area", width: "w-[140px]", cellClassName: "text-xs", sortValue: (r) => r.product_area, cell: (r) => r.product_area || "—" },
    {
      key: "status",
      header: "Status",
      width: "w-[120px]",
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
  ], [accountLabel]);

  const exportCsv = () => {
    const header = ["conversation_id", "subject", "intercom_subject", "contact_name", "contact_email", "contact_domain", "customer", "owner", "product_area", "classification", "state", "lifecycle_status", "tags", "created_at", "closed_at"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push([
        r.intercom_conversation_id, displaySubject(r), r.subject, r.contact_name, r.contact_email, r.contact_domain,
        accountLabel(r.customer_key), r.owner, r.product_area, r.classification, r.state, r.lifecycle_status,
        (r.tags || []).join(" | "), r.intercom_created_at, r.intercom_closed_at,
      ].map(csvCell).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `prospect-tickets-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Prospects</h1>
            <p className="text-sm text-muted-foreground">
              Tickets carrying the <code className="text-xs">enterprise-prospect</code> conversation tag in Intercom.
              Read-only view of <code className="text-xs">intercom_tickets_v3</code>.
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
            Intercom tags/labels only populate on a full fetch, which runs as tickets close. Open tickets are tag-blind —
            a prospect-tagged ticket may not appear here until it closes.
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search subject, contact, domain, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[280px] text-xs"
          />
          <Select value={tagScope} onValueChange={(v) => setTagScope(v as any)}>
            <SelectTrigger className="h-9 w-[240px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prospect">Tag: enterprise-prospect</SelectItem>
              <SelectItem value="personal">Tag: prospect (personal acct)</SelectItem>
              <SelectItem value="both">Tag: both prospect tags</SelectItem>
            </SelectContent>
          </Select>
          <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as any)}>
            <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Lifecycle: all</SelectItem>
              <SelectItem value="open">Open only</SelectItem>
              <SelectItem value="finalized">Closed-side only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Owner: any</SelectItem>
              {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={pa} onValueChange={setPa}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Product area: any</SelectItem>
              {paOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-2">{filtered.length} of {rows.length}</span>
        </div>

        <IssueTable<Ticket>
          rows={filtered}
          columns={columns}
          getRowKey={(r) => r.id}
          loading={loading}
          emptyMessage="No prospect-tagged tickets match these filters."
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
            <IssueField label="State" value={selected.state} />
            <IssueField label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
            <IssueField label="Domain" value={selected.contact_domain} />
            <IssueField label="Customer" value={`${accountLabel(selected.customer_key)} (${selected.customer_source ?? "—"})`} />
            <IssueField label="Owner" value={selected.owner} />
            <IssueField label="Product area" value={selected.product_area} />
            <IssueField label="Classification" value={selected.classification} />
            <IssueField label="Tags" value={(selected.tags || []).join(", ") || "—"} />
            <IssueField label="Created" value={fmtDate(selected.intercom_created_at)} />
            <IssueField label="Closed" value={fmtDate(selected.intercom_closed_at)} />
          </>
        )}
      </IssueDetailSheet>
    </AppLayout>
  );
}
