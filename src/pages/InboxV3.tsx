import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, RefreshCw, ExternalLink, Beaker, Info, CheckCircle2 } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";
import { effectiveRsa } from "@/pages/inbox-v3/rsa";
import { toast } from "@/hooks/use-toast";

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
  rsa_override: boolean | null;
  csat_rating: number | null;
  csat_remark: string | null;
  time_to_resolve_s: number | null;
  intercom_created_at: string | null;
  intercom_updated_at: string | null;
  intercom_closed_at: string | null;
  finalized_at: string | null;
  reopen_count: number;
  silent_update_count: number | null;
  last_silent_change: any;
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

function intercomUrl(id: string) {
  return `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;
}

export default function InboxV3() {
  const [tab, setTab] = useState<"finalized" | "active">("active");

  // Finalized tab state
  const [finalizedRows, setFinalizedRows] = useState<Ticket[]>([]);
  const [finalizedLoading, setFinalizedLoading] = useState(true);
  const [lifecycle, setLifecycle] = useState<"finalized" | "reopened" | "all">("finalized");

  // Active tab state
  const [activeRows, setActiveRows] = useState<Ticket[]>([]);
  const [activeLoading, setActiveLoading] = useState(true);

  // Shared filters
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState<string>(ANY);
  const [pa, setPa] = useState<string>(ANY);
  const [rsaFilter, setRsaFilter] = useState<"all" | "required" | "not_required">("all");
  const [selected, setSelected] = useState<Ticket | null>(null);

  // Cycle a ticket's RSA: derived → required → not_required → derived.
  // Writes rsa_override on intercom_tickets_v3 and updates local state optimistically.
  const cycleRsa = async (t: Ticket) => {
    const next: boolean | null =
      t.rsa_override === null ? true :
      t.rsa_override === true ? false :
      null;
    const prev = t.rsa_override;
    const apply = (rows: Ticket[]) =>
      rows.map((r) => (r.id === t.id ? { ...r, rsa_override: next } : r));
    setFinalizedRows(apply);
    setActiveRows(apply);
    setSelected((s) => (s && s.id === t.id ? { ...s, rsa_override: next } : s));
    const { error } = await supabase
      .from("intercom_tickets_v3")
      .update({ rsa_override: next })
      .eq("id", t.id);
    if (error) {
      const revert = (rows: Ticket[]) =>
        rows.map((r) => (r.id === t.id ? { ...r, rsa_override: prev } : r));
      setFinalizedRows(revert);
      setActiveRows(revert);
      setSelected((s) => (s && s.id === t.id ? { ...s, rsa_override: prev } : s));
      toast({ title: "Couldn't update RSA", description: error.message, variant: "destructive" });
    }
  };

  // Manually clear lifecycle_status='reopened_after_finalize' back to 'finalized'.
  // reopen_count / last_reopened_at are preserved as an audit trail. The next sync
  // may flip it back if Intercom shows newer activity — accepted tradeoff.
  const markAsFinalized = async (t: Ticket) => {
    if (t.lifecycle_status !== "reopened_after_finalize") return;
    const apply = (rows: Ticket[]) =>
      rows.map((r) => (r.id === t.id ? { ...r, lifecycle_status: "finalized" } : r));
    const prevActive = activeRows;
    const prevFinalized = finalizedRows;
    // Finalized rows don't belong in the Active tab — remove instead of relabel.
    setActiveRows((rows) => rows.filter((r) => r.id !== t.id));
    setFinalizedRows(apply);
    setSelected((s) => (s && s.id === t.id ? { ...s, lifecycle_status: "finalized" } : s));
    const { error } = await supabase
      .from("intercom_tickets_v3")
      .update({ lifecycle_status: "finalized" })
      .eq("id", t.id)
      .eq("lifecycle_status", "reopened_after_finalize");
    if (error) {
      setActiveRows(prevActive);
      setFinalizedRows(prevFinalized);
      setSelected((s) => (s && s.id === t.id ? { ...s, lifecycle_status: "reopened_after_finalize" } : s));
      toast({ title: "Couldn't mark as finalized", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Marked as finalized", description: `Reopen count preserved (${t.reopen_count}).` });
    }
  };

  const loadFinalized = async () => {
    setFinalizedLoading(true);
    let q = supabase
      .from("intercom_tickets_v3")
      .select("*")
      .order("intercom_updated_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (lifecycle === "finalized") q = q.eq("lifecycle_status", "finalized");
    else if (lifecycle === "reopened") q = q.eq("lifecycle_status", "reopened_after_finalize");
    else q = q.neq("lifecycle_status", "open"); // "all" closed-side = finalized + reopened
    const { data, error } = await q;
    if (!error) setFinalizedRows((data ?? []) as Ticket[]);
    setFinalizedLoading(false);
  };

  const loadActive = async () => {
    setActiveLoading(true);
    const { data, error } = await supabase
      .from("intercom_tickets_v3")
      .select("*")
      .in("lifecycle_status", ["open", "reopened_after_finalize"])
      .order("intercom_created_at", { ascending: true, nullsFirst: false })
      .limit(1000);
    if (!error) setActiveRows((data ?? []) as Ticket[]);
    setActiveLoading(false);
  };

  useEffect(() => { loadFinalized(); }, [lifecycle]);
  useEffect(() => { loadActive(); }, []);

  const currentRows = tab === "finalized" ? finalizedRows : activeRows;
  const currentLoading = tab === "finalized" ? finalizedLoading : activeLoading;
  const reload = tab === "finalized" ? loadFinalized : loadActive;

  const ownerOpts = useMemo(
    () => Array.from(new Set(currentRows.map((r) => r.owner).filter(Boolean))).sort() as string[],
    [currentRows],
  );
  const paOpts = useMemo(
    () => Array.from(new Set(currentRows.map((r) => r.product_area).filter(Boolean))).sort() as string[],
    [currentRows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currentRows.filter((r) => {
      if (owner !== ANY && r.owner !== owner) return false;
      if (tab === "finalized" && pa !== ANY && r.product_area !== pa) return false;
      if (rsaFilter !== "all") {
        const v = effectiveRsa(r).value;
        if (rsaFilter === "required" && v !== "required") return false;
        if (rsaFilter === "not_required" && v !== "not_required") return false;
      }
      if (q) {
        const hay = [r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id, ...(r.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [currentRows, search, owner, pa, tab, rsaFilter]);

  const lastSync = useMemo(() => {
    const ts = currentRows.map((r) => r.last_synced_at).filter(Boolean).sort().pop();
    return ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : "never";
  }, [currentRows]);

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
            <span className="text-xs text-muted-foreground">Last synced: {lastSync} · {currentRows.length} rows</span>
            <Button onClick={reload} disabled={currentLoading} size="sm" variant="outline">
              {currentLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Reload
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "finalized" | "active")}>
          <TabsList>
            <TabsTrigger value="active">Active ({activeRows.length})</TabsTrigger>
            <TabsTrigger value="finalized">Finalized ({finalizedRows.length})</TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Input
              placeholder="Search subject, contact, Intercom ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm h-9"
            />
            {tab === "finalized" && (
              <>
                <Select value={lifecycle} onValueChange={(v) => setLifecycle(v as any)}>
                  <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finalized">Finalized only</SelectItem>
                    <SelectItem value="reopened">Reopened after finalize</SelectItem>
                    <SelectItem value="all">All closed-side</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={pa} onValueChange={setPa}>
                  <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Product area" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Product area: any</SelectItem>
                    {paOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            )}
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue placeholder="Owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Owner: any</SelectItem>
                {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={rsaFilter} onValueChange={(v) => setRsaFilter(v as any)}>
              <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">RSA: all</SelectItem>
                <SelectItem value="required">RSA: required only</SelectItem>
                <SelectItem value="not_required">RSA: not required only</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-2">{filtered.length} of {currentRows.length}</span>
          </div>

          <TabsContent value="finalized" className="mt-4">
            <FinalizedTable rows={filtered} loading={currentLoading} onSelect={setSelected} onCycleRsa={cycleRsa} onMarkFinalized={markAsFinalized} />
          </TabsContent>

          <TabsContent value="active" className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Open tickets show search-payload fields only. Product area, classification, tags, CSAT, and resolve time are
                populated at close. Sorted oldest-first to surface stale backlog.
              </span>
            </div>
            <ActiveTable rows={filtered} loading={currentLoading} onSelect={setSelected} onCycleRsa={cycleRsa} onMarkFinalized={markAsFinalized} />
          </TabsContent>
        </Tabs>
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
                <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
                  <dt className="text-xs text-muted-foreground">Lifecycle</dt>
                  <dd className="text-sm flex items-center gap-2">
                    <span>{selected.lifecycle_status}{selected.lifecycle_status === "reopened_after_finalize" ? ` (${selected.reopen_count})` : ""}</span>
                    {selected.lifecycle_status === "reopened_after_finalize" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => markAsFinalized(selected)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Mark as finalized
                      </Button>
                    )}
                  </dd>
                </div>
                <Field label="State" value={selected.state} />
                <Field label="Owner" value={selected.owner} />
                <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
                  <dt className="text-xs text-muted-foreground">RSA</dt>
                  <dd className="text-sm flex items-center gap-2">
                    <RsaBadge t={selected} onCycle={cycleRsa} />
                    <span className="text-xs text-muted-foreground">
                      {(() => {
                        const { source } = effectiveRsa(selected);
                        if (source === "manual") return "Manual override";
                        if (source === "tag") return "From tag";
                        return "Default";
                      })()}
                    </span>
                  </dd>
                </div>
                {selected.lifecycle_status === "finalized" || selected.lifecycle_status === "reopened_after_finalize" ? (
                  <>
                    <Field label="Product area" value={selected.product_area} />
                    <Field label="Classification" value={selected.classification} />
                    <Field label="Tags" value={(selected.tags || []).join(", ") || "—"} />
                    <Field label="CSAT" value={selected.csat_rating ? `${CSAT_EMOJI[selected.csat_rating]} ${selected.csat_rating} — ${selected.csat_remark || ""}` : "—"} />
                    <Field label="Time to resolve" value={formatDuration(selected.time_to_resolve_s)} />
                  </>
                ) : null}
                <Field label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
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

function RsaBadge({ t, onCycle }: { t: Ticket; onCycle: (t: Ticket) => void }) {
  const { value, source } = effectiveRsa(t);
  const required = value === "required";
  const tip =
    source === "manual" ? "Manual override — click to cycle" :
    source === "tag" ? "Derived from tag (enterprise-fyi / enterprise-duplicate) — click to override" :
    "Default — click to override";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onCycle(t); }}
      title={tip}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] border ${
        required
          ? "border-border bg-secondary text-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      } ${source === "manual" ? "ring-1 ring-primary/50" : ""} hover:bg-muted/70`}
    >
      {required ? "RSA" : "no-RSA"}
      {source === "manual" && <span className="text-[9px] opacity-70">·M</span>}
    </button>
  );
}

function FinalizedTable({ rows, loading, onSelect, onCycleRsa, onMarkFinalized }: { rows: Ticket[]; loading: boolean; onSelect: (t: Ticket) => void; onCycleRsa: (t: Ticket) => void; onMarkFinalized: (t: Ticket) => void }) {
  return (
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
            <TableHead className="w-[90px]">RSA</TableHead>
            <TableHead className="w-[120px]">CSAT</TableHead>
            <TableHead className="w-[120px]">Resolve</TableHead>
            <TableHead className="w-[140px]">Closed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow><TableCell colSpan={11} className="text-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
            </TableCell></TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow><TableCell colSpan={11} className="text-center py-6 text-muted-foreground">
              No rows match the current filters.
            </TableCell></TableRow>
          )}
          {!loading && rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r)}>
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
                <div className="flex items-center gap-1">
                  <Badge variant={
                    r.lifecycle_status === "finalized" ? "secondary" :
                    r.lifecycle_status === "reopened_after_finalize" ? "destructive" : "outline"
                  } className="text-[10px]">
                    {r.lifecycle_status === "reopened_after_finalize" ? `reopened (${r.reopen_count})` : r.lifecycle_status}
                  </Badge>
                  {r.lifecycle_status === "reopened_after_finalize" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMarkFinalized(r); }}
                      title="Mark as finalized (clear reopened status)"
                      className="inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </TableCell>
              <TableCell><RsaBadge t={r} onCycle={onCycleRsa} /></TableCell>
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
  );
}

function ActiveTable({ rows, loading, onSelect, onCycleRsa, onMarkFinalized }: { rows: Ticket[]; loading: boolean; onSelect: (t: Ticket) => void; onCycleRsa: (t: Ticket) => void; onMarkFinalized: (t: Ticket) => void }) {
  const now = Date.now();
  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[140px]">Intercom ID</TableHead>
            <TableHead className="w-[400px]">Subject</TableHead>
            <TableHead className="w-[200px]">Contact</TableHead>
            <TableHead className="w-[120px]">Owner</TableHead>
            <TableHead className="w-[100px]">State</TableHead>
            <TableHead className="w-[140px]">Lifecycle</TableHead>
            <TableHead className="w-[90px]">RSA</TableHead>
            <TableHead className="w-[120px]">Opened</TableHead>
            <TableHead className="w-[120px]">Last update</TableHead>
            <TableHead className="w-[80px]">Age</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
            </TableCell></TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
              No active tickets match the current filters.
            </TableCell></TableRow>
          )}
          {!loading && rows.map((r) => {
            const ageDays = r.intercom_created_at
              ? differenceInDays(now, new Date(r.intercom_created_at).getTime())
              : null;
            return (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r)}>
                <TableCell className="font-mono text-xs">
                  <a
                    href={intercomUrl(r.intercom_conversation_id)} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    {r.intercom_conversation_id}<ExternalLink className="h-3 w-3" />
                  </a>
                </TableCell>
                <TableCell className="truncate max-w-[400px]">{r.subject || "—"}</TableCell>
                <TableCell className="truncate max-w-[200px]">
                  <div className="text-sm">{r.contact_name || "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.contact_email || ""}</div>
                </TableCell>
                <TableCell>{r.owner || "—"}</TableCell>
                <TableCell className="text-xs">{r.state || "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant={r.lifecycle_status === "reopened_after_finalize" ? "destructive" : "outline"} className="text-[10px]">
                      {r.lifecycle_status === "reopened_after_finalize" ? `reopened (${r.reopen_count})` : "open"}
                    </Badge>
                    {r.lifecycle_status === "reopened_after_finalize" && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onMarkFinalized(r); }}
                        title="Mark as finalized (clear reopened status)"
                        className="inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </TableCell>
                <TableCell><RsaBadge t={r} onCycle={onCycleRsa} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.intercom_created_at ? format(new Date(r.intercom_created_at), "MMM d, yyyy") : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.intercom_updated_at ? formatDistanceToNow(new Date(r.intercom_updated_at), { addSuffix: true }) : "—"}
                </TableCell>
                <TableCell className={`tabular-nums text-xs ${ageDays != null && ageDays > 14 ? "text-destructive font-medium" : ""}`}>
                  {ageDays != null ? `${ageDays}d` : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
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
