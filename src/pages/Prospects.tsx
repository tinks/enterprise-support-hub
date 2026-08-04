import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, ExternalLink, Info, Download } from "lucide-react";
import { format } from "date-fns";

type Ticket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
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

type AccountOpt = { account_key: string; label: string };

const ANY = "__any__";
const TAG_PROSPECT = "enterprise-prospect";
const TAG_PERSONAL = "enterprise-prospect-personal-acct";

function intercomUrl(id: string) {
  return `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;
}

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

  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  useEffect(() => {
    supabase
      .from("v3_customer_accounts")
      .select("account_key,label")
      .order("label")
      .then(({ data }) => setAccounts((data ?? []) as AccountOpt[]));
  }, []);
  const accountLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.account_key, a.label);
    return (key: string | null) => {
      if (!key) return "—";
      if (key === "unknown") return "Unknown";
      if (key === "prospect_unmapped") return "Prospect (unmapped)";
      if (key === "prospect_personal") return "Prospect (personal)";
      if (key === "domain:_personal") return "Personal email";
      if (key.startsWith("domain:")) return key.slice(7);
      return m.get(key) ?? key;
    };
  }, [accounts]);

  const load = async () => {
    setLoading(true);
    const tags = tagScope === "prospect" ? [TAG_PROSPECT] : tagScope === "personal" ? [TAG_PERSONAL] : [TAG_PROSPECT, TAG_PERSONAL];
    const { data, error } = await supabase
      .from("intercom_tickets_v3")
      .select(
        "id,intercom_conversation_id,subject,contact_name,contact_email,contact_domain,owner,product_area,classification,state,lifecycle_status,tags,customer_key,customer_source,intercom_created_at,intercom_closed_at",
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
        const hay = [r.subject, r.contact_name, r.contact_email, r.contact_domain, r.intercom_conversation_id, ...(r.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, owner, pa, lifecycle]);

  const exportCsv = () => {
    const header = ["conversation_id", "subject", "contact_name", "contact_email", "contact_domain", "customer", "owner", "product_area", "classification", "state", "lifecycle_status", "tags", "created_at", "closed_at"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push([
        r.intercom_conversation_id, r.subject, r.contact_name, r.contact_email, r.contact_domain,
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

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">Subject</TableHead>
                <TableHead className="text-left w-[200px]">Contact</TableHead>
                <TableHead className="text-left w-[160px]">Domain</TableHead>
                <TableHead className="text-left w-[170px]">Customer</TableHead>
                <TableHead className="text-left w-[110px]">Owner</TableHead>
                <TableHead className="text-left w-[140px]">Product area</TableHead>
                <TableHead className="text-left w-[120px]">Status</TableHead>
                <TableHead className="text-left w-[110px]">Created</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">
                  No prospect-tagged tickets match these filters.
                </TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="text-left max-w-[360px] truncate">{r.subject || "Untitled"}</TableCell>
                  <TableCell className="text-left text-xs">
                    <div className="truncate">{r.contact_name || "—"}</div>
                    <div className="text-muted-foreground truncate">{r.contact_email || "—"}</div>
                  </TableCell>
                  <TableCell className="text-left text-xs truncate">{r.contact_domain || "—"}</TableCell>
                  <TableCell className="text-left">
                    <Badge variant="secondary" className="text-[10px]">{accountLabel(r.customer_key)}</Badge>
                  </TableCell>
                  <TableCell className="text-left text-xs">{r.owner || "—"}</TableCell>
                  <TableCell className="text-left text-xs">{r.product_area || "—"}</TableCell>
                  <TableCell className="text-left text-xs">
                    {r.lifecycle_status}
                    {r.state ? <span className="text-muted-foreground"> · {r.state}</span> : null}
                  </TableCell>
                  <TableCell className="text-left text-xs">{fmtDate(r.intercom_created_at)}</TableCell>
                  <TableCell>
                    <a
                      href={intercomUrl(r.intercom_conversation_id)} target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="truncate">{selected.subject || "Untitled"}</SheetTitle>
                <SheetDescription>
                  <a
                    href={intercomUrl(selected.intercom_conversation_id)} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    Open in Intercom <ExternalLink className="h-3 w-3" />
                  </a>
                </SheetDescription>
              </SheetHeader>
              <dl className="mt-6 space-y-3 text-sm">
                <Field label="Intercom ID" value={selected.intercom_conversation_id} mono />
                <Field label="Lifecycle" value={selected.lifecycle_status} />
                <Field label="State" value={selected.state} />
                <Field label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
                <Field label="Domain" value={selected.contact_domain} />
                <Field label="Customer" value={`${accountLabel(selected.customer_key)} (${selected.customer_source ?? "—"})`} />
                <Field label="Owner" value={selected.owner} />
                <Field label="Product area" value={selected.product_area} />
                <Field label="Classification" value={selected.classification} />
                <Field label="Tags" value={(selected.tags || []).join(", ") || "—"} />
                <Field label="Created" value={fmtDate(selected.intercom_created_at)} />
                <Field label="Closed" value={fmtDate(selected.intercom_closed_at)} />
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm break-words ${mono ? "font-mono text-xs" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
