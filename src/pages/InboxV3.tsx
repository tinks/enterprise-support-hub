import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, ExternalLink, Beaker } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";

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
  csat_rating: number | null;
  csat_remark: string | null;
  time_to_resolve_s: number | null;
  intercom_created_at: string | null;
  intercom_updated_at: string | null;
  intercom_closed_at: string | null;
  finalized_at: string | null;
  reopen_count: number;
  last_synced_at: string | null;
  raw_payload: any;
};

const ANY = "__any__";
const CSAT_EMOJI: Record<number, string> = { 1: "😠", 2: "🙁", 3: "😐", 4: "😀", 5: "🤩" };

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function InboxV3() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState<"finalized" | "open" | "reopened" | "all">("finalized");
  const [owner, setOwner] = useState<string>(ANY);
  const [pa, setPa] = useState<string>(ANY);
  const [selected, setSelected] = useState<Ticket | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("intercom_tickets_v3")
      .select("*")
      .order("intercom_updated_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (lifecycle === "finalized") q = q.eq("lifecycle_status", "finalized");
    else if (lifecycle === "open") q = q.eq("lifecycle_status", "open");
    else if (lifecycle === "reopened") q = q.eq("lifecycle_status", "reopened_after_finalize");
    const { data, error } = await q;
    if (!error) setRows((data ?? []) as Ticket[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [lifecycle]);

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
      if (q) {
        const hay = [r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id, ...(r.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, owner, pa]);

  const intercomUrl = (id: string) =>
    `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;

  const lastSync = useMemo(() => {
    const ts = rows.map((r) => r.last_synced_at).filter(Boolean).sort().pop();
    return ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : "never";
  }, [rows]);

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Beaker className="h-3.5 w-3.5" /> Sandbox · v3
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1 flex items-center gap-2">
              Inbox v3 <Badge variant="secondary" className="text-[10px]">Beta</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              Read-only view of <code className="text-xs">intercom_tickets_v3</code>. Closed tickets are frozen at
              finalize. Data from {CLEAN_DATA_START_LABEL} onward.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Last synced: {lastSync} · {rows.length} rows</span>
            <Button onClick={load} disabled={loading} size="sm" variant="outline">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reload
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search subject, contact, Intercom ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm h-9"
          />
          <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as any)}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="finalized">Finalized only</SelectItem>
              <SelectItem value="open">Open only</SelectItem>
              <SelectItem value="reopened">Reopened after finalize</SelectItem>
              <SelectItem value="all">All lifecycle</SelectItem>
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Owner: any</SelectItem>
              {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={pa} onValueChange={setPa}>
            <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Product area" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Product area: any</SelectItem>
              {paOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-2">{filtered.length} of {rows.length}</span>
        </div>

        <div className="rounded-md border border-border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Intercom ID</TableHead>
                <TableHead className="w-[360px]">Subject</TableHead>
                <TableHead className="w-[180px]">Contact</TableHead>
                <TableHead className="w-[120px]">Owner</TableHead>
                <TableHead className="w-[160px]">Product area</TableHead>
                <TableHead className="w-[140px]">Classification</TableHead>
                <TableHead className="w-[120px]">Lifecycle</TableHead>
                <TableHead className="w-[120px]">CSAT</TableHead>
                <TableHead className="w-[120px]">Resolve</TableHead>
                <TableHead className="w-[140px]">Closed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                </TableCell></TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                  No rows match the current filters.
                </TableCell></TableRow>
              )}
              {!loading && filtered.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TableCell className="font-mono text-xs">
                    <a
                      href={intercomUrl(r.intercom_conversation_id)} target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {r.intercom_conversation_id}<ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell className="truncate max-w-[360px]">{r.subject || "—"}</TableCell>
                  <TableCell className="truncate max-w-[180px]">
                    <div className="text-sm">{r.contact_name || "—"}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.contact_email || ""}</div>
                  </TableCell>
                  <TableCell>{r.owner || "—"}</TableCell>
                  <TableCell>{r.product_area || "—"}</TableCell>
                  <TableCell>{r.classification || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={
                      r.lifecycle_status === "finalized" ? "secondary" :
                      r.lifecycle_status === "reopened_after_finalize" ? "destructive" : "outline"
                    } className="text-[10px]">
                      {r.lifecycle_status === "reopened_after_finalize" ? `reopened (${r.reopen_count})` : r.lifecycle_status}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.csat_rating ? `${CSAT_EMOJI[r.csat_rating]} ${r.csat_rating}` : "—"}</TableCell>
                  <TableCell className="tabular-nums text-xs">{formatDuration(r.time_to_resolve_s)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.intercom_closed_at ? format(new Date(r.intercom_closed_at), "MMM d, yyyy") : "—"}
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
                <Field label="Owner" value={selected.owner} />
                <Field label="Product area" value={selected.product_area} />
                <Field label="Classification" value={selected.classification} />
                <Field label="Tags" value={(selected.tags || []).join(", ") || "—"} />
                <Field label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
                <Field label="CSAT" value={selected.csat_rating ? `${CSAT_EMOJI[selected.csat_rating]} ${selected.csat_rating} — ${selected.csat_remark || ""}` : "—"} />
                <Field label="Time to resolve" value={formatDuration(selected.time_to_resolve_s)} />
                <Field label="Created" value={selected.intercom_created_at ? format(new Date(selected.intercom_created_at), "PPpp") : "—"} />
                <Field label="Closed" value={selected.intercom_closed_at ? format(new Date(selected.intercom_closed_at), "PPpp") : "—"} />
                <Field label="Finalized" value={selected.finalized_at ? format(new Date(selected.finalized_at), "PPpp") : "—"} />
                <Field label="Reopens" value={String(selected.reopen_count)} />
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
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
