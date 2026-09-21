import { useEffect, useMemo, useState } from "react";
import ReadOnlyBanner from "@/components/ReadOnlyBanner";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, RefreshCw, ExternalLink, Beaker, Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";
import { effectiveRsa } from "@/pages/inbox-v3/rsa";
import { toast } from "@/hooks/use-toast";
import { displaySubject } from "@/lib/subjectDisplay";
import { EditableSubject } from "@/components/issues/EditableSubject";
import { intercomUrl } from "@/lib/intercom";
import { IntercomIdChip } from "@/components/issues/IssueTable";
import { useTableSort, SortableHead } from "@/components/issues/useTableSort";
import { TicketFieldsPanel } from "@/components/issues/TicketFieldsPanel";
import { SeverityProposalCard } from "@/components/issues/SeverityProposalCard";
import { PaxInvestigateControl } from "@/components/issues/PaxInvestigateControl";
import { useInitialQ } from "@/hooks/useInitialQ";
import { useCsatOverrides } from "@/lib/csat";
import { CsatOverrideDialog } from "@/components/csat/CsatOverrideDialog";
import { useIntercomTeams } from "@/hooks/useIntercomTeams";
import { PlanBadge } from "@/components/PlanScopeSelect";
import { PLAN_LABEL, planTierOf, inPlanScope, type PlanScope } from "@/lib/planTier";

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
  csat_rater_name: string | null;
  csat_rater_email: string | null;
  csat_rater_is_internal: boolean | null;
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
  customer_key: string | null;
  customer_kind: string | null;
  customer_source: string | null;
  customer_override_key: string | null;
  customer_override_reason: string | null;
  transferred_at: string | null;
  reassigned_team_id: string | null;
  custom_attributes: Record<string, unknown> | null;
  /** 'enterprise' (default) or 'sse' — set at ingest from the Intercom inbox. */
  plan_tier: string | null;
};

/** Linear-bearing Intercom custom attributes, searchable in the Inbox v3 filter. */
const LINEAR_ATTR_KEYS = ["Escalated Issue", "Linear Issue"];

function linearRefs(row: { custom_attributes?: Record<string, unknown> | null }): string[] {
  const ca = row.custom_attributes ?? {};
  return LINEAR_ATTR_KEYS.map((k) => ca[k]).filter((v) => typeof v === "string" && v.trim()) as string[];
}


type AccountOpt = { account_key: string; label: string };

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


/** Optional ?tab= deep link so other pages can land on the right list. */
function initialTab(): "finalized" | "active" | "transferred" {
  const t = new URLSearchParams(window.location.search).get("tab");
  return t === "finalized" || t === "transferred" ? t : "active";
}

export default function InboxV3() {
  const [tab, setTab] = useState<"finalized" | "active" | "transferred">(initialTab);

  // Team Reassignment tab state (lifecycle_status = 'transferred_out')
  const [transferredRows, setTransferredRows] = useState<Ticket[]>([]);
  const [transferredLoading, setTransferredLoading] = useState(true);


  // Finalized tab state
  const [finalizedRows, setFinalizedRows] = useState<Ticket[]>([]);
  const [finalizedLoading, setFinalizedLoading] = useState(true);
  const [lifecycle, setLifecycle] = useState<"finalized" | "reopened" | "all">("finalized");

  // Active tab state
  const [activeRows, setActiveRows] = useState<Ticket[]>([]);
  const [activeLoading, setActiveLoading] = useState(true);

  // Customer accounts (for override picker + label lookup)
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
      if (key === "domain:_personal") return "Personal email";
      if (key.startsWith("domain:")) return key.slice(7);
      return m.get(key) ?? key;
    };
  }, [accounts]);

  // Shared filters
  const [search, setSearch] = useState(useInitialQ());
  const [owner, setOwner] = useState<string>(ANY);
  const [pa, setPa] = useState<string>(ANY);
  const [rsaFilter, setRsaFilter] = useState<"all" | "required" | "not_required">("all");
  const [customerFilter, setCustomerFilter] = useState<string>(ANY);
  const [planScope, setPlanScope] = useState<PlanScope>("all");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const { overrides: csatOverrides, refresh: refreshCsatOverrides } = useCsatOverrides();

  // Override picker state (inside the sheet)
  const [overrideDraft, setOverrideDraft] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");
  const [savingOverride, setSavingOverride] = useState(false);
  const [savingTest, setSavingTest] = useState(false);

  useEffect(() => {
    setOverrideDraft(selected?.customer_override_key ?? "");
    setOverrideReason(selected?.customer_override_reason ?? "");
  }, [selected?.id]);

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

  // Terminal state: the ticket left our scope when another team took it over.
  const loadTransferred = async () => {
    setTransferredLoading(true);
    const { data, error } = await supabase
      .from("intercom_tickets_v3")
      .select("*")
      .eq("lifecycle_status", "transferred_out")
      .order("transferred_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (!error) setTransferredRows((data ?? []) as Ticket[]);
    setTransferredLoading(false);
  };

  useEffect(() => { loadFinalized(); }, [lifecycle]);
  useEffect(() => { loadActive(); }, []);
  useEffect(() => { loadTransferred(); }, []);


  // Deep-link support: /inbox-v3?customer=<key>
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("customer");
    if (p) setCustomerFilter(p);
  }, []);

  // Save/reset per-ticket customer override. Not admin-gated by design.
  const saveOverride = async () => {
    if (!selected) return;
    setSavingOverride(true);
    const key = overrideDraft.trim() || null;
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("intercom_tickets_v3")
      .update({
        customer_override_key: key,
        customer_override_reason: overrideReason.trim() || null,
        customer_override_by: key ? (session?.user?.id ?? null) : null,
        customer_override_at: key ? new Date().toISOString() : null,
      })
      .eq("id", selected.id);
    setSavingOverride(false);
    if (error) { toast({ title: "Couldn't save override", description: error.message, variant: "destructive" }); return; }
    // Refetch the row so we pick up the trigger-recomputed customer_* columns.
    const { data: fresh } = await supabase
      .from("intercom_tickets_v3").select("*").eq("id", selected.id).single();
    if (fresh) {
      const apply = (rows: Ticket[]) => rows.map((r) => r.id === fresh.id ? (fresh as Ticket) : r);
      setFinalizedRows(apply);
      setActiveRows(apply);
      setSelected(fresh as Ticket);
    }
    toast({ title: key ? "Override saved" : "Override cleared" });
  };
  const resetOverride = async () => {
    setOverrideDraft("");
    setOverrideReason("");
    // Save with empty draft (clears override, trigger re-derives).
    if (!selected) return;
    setSavingOverride(true);
    const { error } = await supabase
      .from("intercom_tickets_v3")
      .update({
        customer_override_key: null,
        customer_override_reason: null,
        customer_override_by: null,
        customer_override_at: null,
      })
      .eq("id", selected.id);
    setSavingOverride(false);
    if (error) { toast({ title: "Couldn't reset", description: error.message, variant: "destructive" }); return; }
    const { data: fresh } = await supabase
      .from("intercom_tickets_v3").select("*").eq("id", selected.id).single();
    if (fresh) {
      const apply = (rows: Ticket[]) => rows.map((r) => r.id === fresh.id ? (fresh as Ticket) : r);
      setFinalizedRows(apply);
      setActiveRows(apply);
      setSelected(fresh as Ticket);
    }
    toast({ title: "Reset to auto-derived" });
  };

  const toggleTestTicket = async (t: Ticket) => {
    const next = !(t as any).is_test_ticket;
    setSavingTest(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("intercom_tickets_v3")
      .update({
        is_test_ticket: next,
        test_marked_by: next ? (session?.user?.id ?? null) : null,
        test_marked_at: next ? new Date().toISOString() : null,
      })
      .eq("id", t.id);
    setSavingTest(false);
    if (error) {
      toast({ title: "Couldn't update test flag", description: error.message, variant: "destructive" });
      return;
    }
    const apply = (rows: Ticket[]) =>
      rows.map((r) => (r.id === t.id ? ({ ...r, is_test_ticket: next } as Ticket) : r));
    setFinalizedRows(apply);
    setActiveRows(apply);
    setTransferredRows(apply);
    setSelected((cur) => (cur && cur.id === t.id ? ({ ...cur, is_test_ticket: next } as Ticket) : cur));
    toast({ title: next ? "Marked as test ticket" : "Test flag cleared" });
  };

  const patchSubject = (t: Ticket, next: string | null) => {
    const apply = (rows: Ticket[]) =>
      rows.map((r) => (r.id === t.id ? ({ ...r, subject_override: next } as Ticket) : r));
    setFinalizedRows(apply);
    setActiveRows(apply);
    setTransferredRows(apply);
    setSelected((cur) => (cur && cur.id === t.id ? ({ ...cur, subject_override: next } as Ticket) : cur));
  };

  const currentRows = tab === "finalized" ? finalizedRows : tab === "transferred" ? transferredRows : activeRows;
  const currentLoading = tab === "finalized" ? finalizedLoading : tab === "transferred" ? transferredLoading : activeLoading;
  const reload = tab === "finalized" ? loadFinalized : tab === "transferred" ? loadTransferred : loadActive;

  const ownerOpts = useMemo(
    () => Array.from(new Set(currentRows.map((r) => r.owner).filter(Boolean))).sort() as string[],
    [currentRows],
  );
  const paOpts = useMemo(
    () => Array.from(new Set(currentRows.map((r) => r.product_area).filter(Boolean))).sort() as string[],
    [currentRows],
  );

  const customerOpts = useMemo(() => {
    const keys = new Set<string>();
    for (const r of currentRows) if (r.customer_key) keys.add(r.customer_key);
    return Array.from(keys).sort();
  }, [currentRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currentRows.filter((r) => {
      if (owner !== ANY && r.owner !== owner) return false;
      if (tab === "finalized" && pa !== ANY && r.product_area !== pa) return false;
      if (customerFilter !== ANY && r.customer_key !== customerFilter) return false;
      if (!inPlanScope(r.plan_tier, planScope)) return false;
      if (rsaFilter !== "all") {
        const v = effectiveRsa(r).value;
        if (rsaFilter === "required" && v !== "required") return false;
        if (rsaFilter === "not_required" && v !== "not_required") return false;
      }
      if (q) {
        const hay = [displaySubject(r), r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id, ...(r.tags || []), ...linearRefs(r)]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [currentRows, search, owner, pa, tab, rsaFilter, customerFilter, planScope]);

  const lastSync = useMemo(() => {
    const ts = currentRows.map((r) => r.last_synced_at).filter(Boolean).sort().pop();
    return ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : "never";
  }, [currentRows]);

  // "Needs attention" counts surfaced as red badges on each tab.
  //  - Active: genuine anomalies only — Intercom state drifted to 'closed' while the row is still
  //    active locally, or the row has dropped out of sync entirely (>24h, i.e. missed both
  //    twice-daily 30-day wide sweeps). Routine cadence gaps (the 5-min incremental sync only
  //    revisits tickets with recent Intercom activity) are NOT anomalies and stay silent.
  //  - Finalized: rows where Intercom state drifted away from 'closed' (pending reopen detection).
  const DROPOUT_MS = 24 * 60 * 60 * 1000;
  const activeAttention = useMemo(() => {
    const cutoff = Date.now() - DROPOUT_MS;
    return activeRows.filter(
      (r) =>
        r.state === "closed" ||
        !r.last_synced_at ||
        new Date(r.last_synced_at).getTime() < cutoff,
    ).length;
  }, [activeRows]);
  const finalizedAttention = useMemo(
    () => finalizedRows.filter(
      (r) => r.lifecycle_status === "finalized" && r.state && r.state !== "closed",
    ).length,
    [finalizedRows],
  );

  return (
    <AppLayout>
      <div className="px-6 pt-4"><ReadOnlyBanner /></div>
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

        <Tabs value={tab} onValueChange={(v) => setTab(v as "finalized" | "active" | "transferred")}>
          <TabsList>
            <TabsTrigger value="active" className="gap-2">
              Active ({activeRows.length})
              {activeAttention > 0 && (
                <span
                  title={`${activeAttention} active row(s) with a real anomaly: closed in Intercom while still active here, or not synced in over 24h`}
                  className="inline-flex items-center gap-0.5 rounded-full bg-destructive/15 text-destructive px-1.5 py-0.5 text-[10px] font-medium"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {activeAttention}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="finalized" className="gap-2">
              Finalized ({finalizedRows.length})
              {finalizedAttention > 0 && (
                <span
                  title={`${finalizedAttention} finalized row(s) where Intercom state ≠ closed (pending reopen detection)`}
                  className="inline-flex items-center gap-0.5 rounded-full bg-destructive/15 text-destructive px-1.5 py-0.5 text-[10px] font-medium"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {finalizedAttention}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="transferred" className="gap-2">
              Team Reassignment
              <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {transferredRows.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <Input
              placeholder="Search subject, contact, Intercom ID, Linear issue…"
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
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue placeholder="Customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Customer: any</SelectItem>
                {customerOpts.map((k) => (
                  <SelectItem key={k} value={k}>{accountLabel(k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={planScope} onValueChange={(v) => setPlanScope(v as PlanScope)}>
              <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Plan: any</SelectItem>
                <SelectItem value="enterprise">{PLAN_LABEL.enterprise}</SelectItem>
                <SelectItem value="sse">{PLAN_LABEL.sse}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-2">{filtered.length} of {currentRows.length}</span>
          </div>

          <TabsContent value="finalized" className="mt-4">
            <FinalizedTable rows={filtered} loading={currentLoading} onSelect={setSelected} onSubjectSaved={patchSubject} onCycleRsa={cycleRsa} onMarkFinalized={markAsFinalized} accountLabel={accountLabel} />
          </TabsContent>

          <TabsContent value="active" className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Open tickets show search-payload fields only. Product area, classification, tags, CSAT, and resolve time are
                populated at close. Sorted oldest-first to surface stale backlog.
              </span>
            </div>
            <ActiveTable rows={filtered} loading={currentLoading} onSelect={setSelected} onSubjectSaved={patchSubject} onCycleRsa={cycleRsa} onMarkFinalized={markAsFinalized} accountLabel={accountLabel} />
          </TabsContent>

          <TabsContent value="transferred" className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Tickets reassigned away from the Enterprise inbox. Terminal state — excluded from the Active queue and from
                active/open analytics. "Time in inbox" is a proxy (transferred − created).
              </span>
            </div>
            <TransferredTable rows={filtered} loading={currentLoading} onSelect={setSelected} onSubjectSaved={patchSubject} accountLabel={accountLabel} />
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:w-[560px] sm:max-w-[560px] lg:w-[720px] lg:max-w-[720px] xl:w-[880px] xl:max-w-[880px] 2xl:w-[1100px] 2xl:max-w-[1100px] overflow-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="truncate">{displaySubject(selected)}</SheetTitle>
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
                <Field
                  label="Plan"
                  value={planTierOf(selected.plan_tier) === "sse" ? "Self-serve Enterprise (no first-response SLA, 1h triage)" : "Enterprise"}
                />
                <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
                  <dt className="text-xs text-muted-foreground">Test ticket</dt>
                  <dd className="text-sm flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={(selected as any).is_test_ticket ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      disabled={savingTest}
                      onClick={() => toggleTestTicket(selected)}
                    >
                      {(selected as any).is_test_ticket ? "Marked as test" : "Mark as test"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Hub-only. Hidden from reporting and Action Center unless "Show test data" is on.
                    </span>
                  </dd>
                </div>

                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                  <dt className="text-xs text-muted-foreground">Investigation</dt>
                  <dd>
                    <PaxInvestigateControl conversationId={selected.intercom_conversation_id} />
                  </dd>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                  <dt className="text-xs text-muted-foreground">Severity AI</dt>
                  <dd>
                    <SeverityProposalCard conversationId={selected.intercom_conversation_id} />
                  </dd>
                </div>
                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                  <dt className="text-xs text-muted-foreground">Update fields</dt>
                  <dd>
                    <TicketFieldsPanel
                      conversationId={selected.intercom_conversation_id}
                      showSubject
                      onSubjectSaved={(next) => patchSubject(selected, next)}
                      currentSeverity={null}
                      currentOwner={selected.owner}
                      currentProductArea={selected.product_area}
                      currentTicketType={selected.classification}
                      onWritten={(field, value) => {
                        setSelected((s) => {
                          if (!s) return s;
                          if (field === "owner") return { ...s, owner: value };
                          if (field === "product_area") return { ...s, product_area: value };
                          if (field === "ticket_type") return { ...s, classification: value };
                          return s;
                        });
                      }}
                    />
                  </dd>
                </div>


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
                    <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                      <dt className="text-xs text-muted-foreground">CSAT</dt>
                      <dd className="text-sm space-y-2">
                        {selected.csat_rating ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={csatOverrides.has(selected.id) ? "line-through text-muted-foreground" : ""}>
                                {CSAT_EMOJI[selected.csat_rating]} {selected.csat_rating}
                                {selected.csat_remark ? ` — ${selected.csat_remark}` : ""}
                              </span>
                              {selected.csat_rater_is_internal ? (
                                <Badge variant="secondary" className="text-[10px]">Internal rater</Badge>
                              ) : null}
                              {csatOverrides.has(selected.id) ? (
                                <Badge variant="outline" className="text-[10px]">Excluded</Badge>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Rated by {selected.csat_rater_name ?? selected.contact_name ?? "—"}
                              {selected.csat_rater_email ? ` · ${selected.csat_rater_email}` : ""}
                            </div>
                            {csatOverrides.has(selected.id) ? (
                              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs space-y-1">
                                <div>{csatOverrides.get(selected.id)!.reason}</div>
                                <div className="text-muted-foreground">
                                  {csatOverrides.get(selected.id)!.created_by_email ?? "unknown"} ·{" "}
                                  {format(new Date(csatOverrides.get(selected.id)!.created_at), "MMM d, yyyy")}
                                </div>
                              </div>
                            ) : null}
                            <CsatOverrideDialog
                              ticketId={selected.id}
                              conversationId={selected.intercom_conversation_id}
                              rating={selected.csat_rating}
                              existing={csatOverrides.get(selected.id) ?? null}
                              onSaved={refreshCsatOverrides}
                            />
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </dd>
                    </div>
                    <Field label="Time to resolve" value={formatDuration(selected.time_to_resolve_s)} />
                  </>
                ) : null}
                <Field label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
                <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
                  <dt className="text-xs text-muted-foreground">Customer</dt>
                  <dd className="text-sm space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">{accountLabel(selected.customer_key)}</Badge>
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {selected.customer_source ?? "—"}
                      </span>
                    </div>
                    <div className="space-y-1.5 rounded-md border border-border p-2 bg-muted/20">
                      <div className="text-[11px] text-muted-foreground">Override</div>
                      <Select value={overrideDraft || "__none__"} onValueChange={(v) => setOverrideDraft(v === "__none__" ? "" : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="No override" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No override (auto-derive)</SelectItem>
                          <SelectItem value="unknown">Unknown</SelectItem>
                          <SelectItem value="domain:_personal">Personal email</SelectItem>
                          {accounts.map((a) => (
                            <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Reason (optional)"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="h-7 text-xs" onClick={saveOverride} disabled={savingOverride}>
                          Save override
                        </Button>
                        {selected.customer_override_key && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={resetOverride} disabled={savingOverride}>
                            Reset to auto
                          </Button>
                        )}
                      </div>
                    </div>
                  </dd>
                </div>
                <Field label="Created" value={selected.intercom_created_at ? format(new Date(selected.intercom_created_at), "PPpp") : "—"} />
                <Field label="Closed" value={selected.intercom_closed_at ? format(new Date(selected.intercom_closed_at), "PPpp") : "—"} />
                <Field label="Finalized" value={selected.finalized_at ? format(new Date(selected.finalized_at), "PPpp") : "—"} />
                <Field label="Reopens" value={String(selected.reopen_count)} />
                {(selected.silent_update_count ?? 0) > 0 && (
                  <div className="grid grid-cols-[140px_1fr] gap-3">
                    <dt className="text-xs text-muted-foreground">Last change</dt>
                    <dd className="text-xs">
                      <SilentChange change={selected.last_silent_change} count={selected.silent_update_count ?? 0} />
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}

function SilentChange({ change, count }: { change: any; count: number }) {
  if (!change) {
    return <span className="text-muted-foreground">{count} silent update{count === 1 ? "" : "s"} (no diff captured)</span>;
  }
  const at = change.at ? formatDistanceToNow(new Date(change.at), { addSuffix: true }) : "";
  const fields: string[] = Array.isArray(change.fields) ? change.fields : [];
  const details = change.details || {};
  const lines: string[] = [];
  if (fields.includes("csat") && details.csat) {
    lines.push(`CSAT ${details.csat.from ?? "—"} → ${details.csat.to ?? "—"}${details.csat.remark ? ` ("${String(details.csat.remark).slice(0, 60)}")` : ""}`);
  }
  if (fields.includes("tags") && details.tags) {
    const a = (details.tags.added || []).map((t: string) => `+${t}`);
    const r = (details.tags.removed || []).map((t: string) => `−${t}`);
    if (a.length || r.length) lines.push(`Tags: ${[...a, ...r].join(", ")}`);
  }
  if (fields.includes("custom_attributes") && details.custom_attributes) {
    for (const [k, v] of Object.entries<any>(details.custom_attributes)) {
      lines.push(`${k}: ${JSON.stringify(v.from) ?? "—"} → ${JSON.stringify(v.to) ?? "—"}`);
    }
  }
  if (fields.includes("admin_assignee") && details.admin_assignee) {
    lines.push(`Assignee: ${details.admin_assignee.from ?? "—"} → ${details.admin_assignee.to ?? "—"}`);
  }
  if (fields.includes("conversation_parts") && details.conversation_parts) {
    const d = details.conversation_parts;
    lines.push(`Conversation parts: ${d.from} → ${d.to} (note or reply added)`);
  }
  if (!lines.length) lines.push("Unknown change (no allowlisted field differed)");
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">{at} · {count} total</div>
      {lines.map((l, i) => <div key={i} className="font-mono text-[11px] break-all">{l}</div>)}
    </div>
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

function FinalizedTable({ rows, loading, onSelect, onCycleRsa, onMarkFinalized, accountLabel, onSubjectSaved }: { rows: Ticket[]; loading: boolean; onSubjectSaved: (t: Ticket, next: string | null) => void; onSelect: (t: Ticket) => void; onCycleRsa: (t: Ticket) => void; onMarkFinalized: (t: Ticket) => void; accountLabel: (key: string | null) => string }) {
  const { sorted, sort, toggle } = useTableSort<Ticket>(rows, {
    intercom_id: (r) => r.intercom_conversation_id,
    subject: (r) => displaySubject(r).toLowerCase(),
    contact: (r) => (r.contact_name || r.contact_email || "").toLowerCase(),
    customer: (r) => accountLabel(r.customer_key).toLowerCase(),
    owner: (r) => (r.owner || "").toLowerCase(),
    plan: (r) => planTierOf(r.plan_tier),
    product_area: (r) => r.product_area || "",
    classification: (r) => r.classification || "",
    state: (r) => r.state || "",
    lifecycle: (r) => r.lifecycle_status || "",
    rsa: (r) => effectiveRsa(r).value,
    csat: (r) => r.csat_rating ?? null,
    resolve: (r) => r.time_to_resolve_s ?? null,
  });
  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead sortKey="intercom_id" sort={sort} onToggle={toggle} className="w-[140px]">Intercom ID</SortableHead>
            <SortableHead sortKey="subject" sort={sort} onToggle={toggle} className="w-[320px]">Subject</SortableHead>
            <SortableHead sortKey="contact" sort={sort} onToggle={toggle} className="w-[180px]">Contact</SortableHead>
            <SortableHead sortKey="customer" sort={sort} onToggle={toggle} className="w-[140px]">Customer</SortableHead>
            <SortableHead sortKey="owner" sort={sort} onToggle={toggle} className="w-[120px]">Owner</SortableHead>
            <SortableHead sortKey="plan" sort={sort} onToggle={toggle} className="w-[100px]">Plan</SortableHead>
            <SortableHead sortKey="product_area" sort={sort} onToggle={toggle} className="w-[160px]">Product area</SortableHead>
            <SortableHead sortKey="classification" sort={sort} onToggle={toggle} className="w-[140px]">Classification</SortableHead>
            <SortableHead sortKey="state" sort={sort} onToggle={toggle} className="w-[100px]">State</SortableHead>
            <SortableHead sortKey="lifecycle" sort={sort} onToggle={toggle} className="w-[120px]">Lifecycle</SortableHead>
            <SortableHead sortKey="rsa" sort={sort} onToggle={toggle} className="w-[90px]">RSA</SortableHead>
            <SortableHead sortKey="csat" sort={sort} onToggle={toggle} className="w-[120px]">CSAT</SortableHead>
            <SortableHead sortKey="resolve" sort={sort} onToggle={toggle} className="w-[120px]">Resolve</SortableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading && (
            <TableRow><TableCell colSpan={13} className="text-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
            </TableCell></TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow><TableCell colSpan={13} className="text-center py-6 text-muted-foreground">
              No rows match the current filters.
            </TableCell></TableRow>
          )}
          {!loading && sorted.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r)}>
              <TableCell><IntercomIdChip id={r.intercom_conversation_id} /></TableCell>
              <TableCell className="max-w-[320px]" onClick={(e) => e.stopPropagation()}>
                <EditableSubject conversationId={r.intercom_conversation_id} row={r} onSaved={(next) => onSubjectSaved(r, next)} />
              </TableCell>
              <TableCell className="truncate max-w-[180px]">
                <div className="text-sm">{r.contact_name || "—"}</div>
                <div className="text-xs text-muted-foreground truncate">{r.contact_email || ""}</div>
              </TableCell>
              <TableCell className="truncate max-w-[140px]">
                <Badge variant="secondary" className="text-xs">{accountLabel(r.customer_key)}</Badge>
              </TableCell>
              <TableCell>{r.owner || "—"}</TableCell>
              <TableCell><PlanBadge value={r.plan_tier} /></TableCell>
              <TableCell>{r.product_area || "—"}</TableCell>
              <TableCell>{r.classification || "—"}</TableCell>
              <TableCell className="text-xs">
                {(() => {
                  const drift = r.state && r.state !== "closed";
                  return (
                    <span
                      className={drift ? "text-destructive font-medium" : "text-muted-foreground"}
                      title={drift ? "Intercom state is not 'closed' — pending reopen detection" : undefined}
                    >
                      {r.state || "—"}
                    </span>
                  );
                })()}
              </TableCell>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ActiveTable({ rows, loading, onSelect, onCycleRsa, onMarkFinalized, accountLabel, onSubjectSaved }: { rows: Ticket[]; loading: boolean; onSubjectSaved: (t: Ticket, next: string | null) => void; onSelect: (t: Ticket) => void; onCycleRsa: (t: Ticket) => void; onMarkFinalized: (t: Ticket) => void; accountLabel: (key: string | null) => string }) {
  const now = Date.now();
  const { sorted, sort, toggle } = useTableSort<Ticket>(rows, {
    intercom_id: (r) => r.intercom_conversation_id,
    subject: (r) => displaySubject(r).toLowerCase(),
    contact: (r) => (r.contact_name || r.contact_email || "").toLowerCase(),
    customer: (r) => accountLabel(r.customer_key).toLowerCase(),
    owner: (r) => (r.owner || "").toLowerCase(),
    plan: (r) => planTierOf(r.plan_tier),
    state: (r) => r.state || "",
    lifecycle: (r) => r.lifecycle_status || "",
    rsa: (r) => effectiveRsa(r).value,
    last_update: (r) => (r.intercom_updated_at ? new Date(r.intercom_updated_at).getTime() : null),
    age: (r) => (r.intercom_created_at ? now - new Date(r.intercom_created_at).getTime() : null),
  });
  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead sortKey="intercom_id" sort={sort} onToggle={toggle} className="w-[140px]">Intercom ID</SortableHead>
            <SortableHead sortKey="subject" sort={sort} onToggle={toggle} className="w-[360px]">Subject</SortableHead>
            <SortableHead sortKey="contact" sort={sort} onToggle={toggle} className="w-[200px]">Contact</SortableHead>
            <SortableHead sortKey="customer" sort={sort} onToggle={toggle} className="w-[140px]">Customer</SortableHead>
            <SortableHead sortKey="owner" sort={sort} onToggle={toggle} className="w-[120px]">Owner</SortableHead>
            <SortableHead sortKey="plan" sort={sort} onToggle={toggle} className="w-[100px]">Plan</SortableHead>
            <SortableHead sortKey="state" sort={sort} onToggle={toggle} className="w-[100px]">State</SortableHead>
            <SortableHead sortKey="lifecycle" sort={sort} onToggle={toggle} className="w-[140px]">Lifecycle</SortableHead>
            <SortableHead sortKey="rsa" sort={sort} onToggle={toggle} className="w-[90px]">RSA</SortableHead>
            <SortableHead sortKey="last_update" sort={sort} onToggle={toggle} className="w-[120px]">Last update</SortableHead>
            <SortableHead sortKey="age" sort={sort} onToggle={toggle} className="w-[80px]">Age</SortableHead>
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
              No active tickets match the current filters.
            </TableCell></TableRow>
          )}
          {!loading && sorted.map((r) => {
            const ageDays = r.intercom_created_at
              ? differenceInDays(now, new Date(r.intercom_created_at).getTime())
              : null;
            return (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r)}>
                <TableCell><IntercomIdChip id={r.intercom_conversation_id} /></TableCell>
                <TableCell className="max-w-[360px]" onClick={(e) => e.stopPropagation()}>
                <EditableSubject conversationId={r.intercom_conversation_id} row={r} onSaved={(next) => onSubjectSaved(r, next)} />
              </TableCell>
                <TableCell className="truncate max-w-[200px]">
                  <div className="text-sm">{r.contact_name || "—"}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.contact_email || ""}</div>
                </TableCell>
                <TableCell className="truncate max-w-[140px]">
                  <Badge variant="secondary" className="text-xs">{accountLabel(r.customer_key)}</Badge>
                </TableCell>
                <TableCell>{r.owner || "—"}</TableCell>
                <TableCell><PlanBadge value={r.plan_tier} /></TableCell>
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

function TransferredTable({ rows, loading, onSelect, accountLabel, onSubjectSaved }: { rows: Ticket[]; loading: boolean; onSubjectSaved: (t: Ticket, next: string | null) => void; onSelect: (t: Ticket) => void; accountLabel: (key: string | null) => string }) {
  const { teamLabel } = useIntercomTeams();
  const { sorted, sort, toggle } = useTableSort<Ticket>(rows, {
    intercom_id: (r) => r.intercom_conversation_id,
    subject: (r) => displaySubject(r).toLowerCase(),
    customer: (r) => (r.customer_key ? accountLabel(r.customer_key) : r.contact_domain || "").toLowerCase(),
    time_in_inbox: (r) =>
      r.transferred_at && r.intercom_created_at
        ? Math.max(0, (new Date(r.transferred_at).getTime() - new Date(r.intercom_created_at).getTime()) / 1000)
        : null,
    reassigned_to: (r) => (r.reassigned_team_id ? teamLabel(r.reassigned_team_id).toLowerCase() : ""),
    transferred: (r) => (r.transferred_at ? new Date(r.transferred_at).getTime() : null),
  });
  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead sortKey="intercom_id" sort={sort} onToggle={toggle} className="w-[150px]">Intercom ID</SortableHead>
            <SortableHead sortKey="subject" sort={sort} onToggle={toggle} className="w-[320px]">Subject</SortableHead>
            <SortableHead sortKey="customer" sort={sort} onToggle={toggle} className="w-[160px]">Customer</SortableHead>
            <SortableHead sortKey="time_in_inbox" sort={sort} onToggle={toggle} className="w-[140px]">Time in inbox</SortableHead>
            <SortableHead sortKey="reassigned_to" sort={sort} onToggle={toggle} className="w-[160px]">Reassigned to</SortableHead>
            <SortableHead sortKey="transferred" sort={sort} onToggle={toggle} className="w-[140px]">Transferred</SortableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {loading && (
            <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
            </TableCell></TableRow>
          )}
          {!loading && rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
              No reassigned tickets.
            </TableCell></TableRow>
          )}
          {!loading && sorted.map((r) => {
            // Proxy: we don't yet record inbox-entry time, so measure from conversation creation.
            const inboxS =
              r.transferred_at && r.intercom_created_at
                ? Math.max(0, (new Date(r.transferred_at).getTime() - new Date(r.intercom_created_at).getTime()) / 1000)
                : null;
            return (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelect(r)}>
                <TableCell><IntercomIdChip id={r.intercom_conversation_id} /></TableCell>
                <TableCell className="max-w-[320px]" onClick={(e) => e.stopPropagation()}>
                <EditableSubject conversationId={r.intercom_conversation_id} row={r} onSaved={(next) => onSubjectSaved(r, next)} />
              </TableCell>
                <TableCell className="truncate max-w-[160px]">
                  <Badge variant="secondary" className="text-xs">
                    {r.customer_key ? accountLabel(r.customer_key) : (r.contact_domain || "—")}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums text-xs">{formatDuration(inboxS)}</TableCell>
                <TableCell className="text-xs" title={r.reassigned_team_id || undefined}>
                  {teamLabel(r.reassigned_team_id)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.transferred_at ? format(new Date(r.transferred_at), "MMM d, yyyy") : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
