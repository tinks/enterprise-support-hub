import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Beaker, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  evaluateCompliance,
  formatBusinessDuration,
  formatDuration,
  parseSeverity,
  type Severity,
  type SlaCompliance,
} from "@/lib/slaMetrics";
import { useSlaBatch, type SlaBatchEnriched } from "@/hooks/useSlaBatch";
import { rowClosedAtMs } from "@/lib/slaWindow";
import { cn } from "@/lib/utils";

// ---- Date range presets (local to this prototype) --------------------------
type RangeKey = "month" | "last_month" | "30d" | "90d";

const RANGE_LABELS: Record<RangeKey, string> = {
  month: "This month",
  last_month: "Last month",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

function rangeBounds(key: RangeKey, now: Date): { startMs: number; endMs: number } {
  if (key === "month") {
    return { startMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), endMs: Infinity };
  }
  if (key === "last_month") {
    return {
      startMs: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      endMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    };
  }
  const days = key === "30d" ? 30 : 90;
  return { startMs: now.getTime() - days * 86400_000, endMs: Infinity };
}

type Account = { account_key: string; label: string };

type OpenTicket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  intercom_created_at: string | null;
  lifecycle_status: string | null;
  raw_payload: any;
};

function fmt(sec: number | null, clock: "business" | "calendar") {
  return (clock === "business" ? formatBusinessDuration : formatDuration)(sec);
}

function fmtDate(v: string | number | null | undefined) {
  if (v == null) return "—";
  const d = typeof v === "number" ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function MetBadge({ met }: { met: boolean | null }) {
  if (met == null) return <Badge variant="outline" className="text-[10px]">n/a</Badge>;
  return met
    ? <Badge variant="outline" className="text-[10px] border-primary/40 bg-primary/10">Met</Badge>
    : <Badge variant="destructive" className="text-[10px]">Breach</Badge>;
}

export default function CustomerReport() {
  const { loading, error, inScope, customerLabels } = useSlaBatch();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customer, setCustomer] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("month");
  const [showClosed, setShowClosed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openTickets, setOpenTickets] = useState<OpenTicket[]>([]);
  const [openLoading, setOpenLoading] = useState(false);

  // Customer registry (non-test).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("v3_customer_accounts")
        .select("account_key,label,is_test")
        .or("is_test.is.null,is_test.eq.false")
        .order("label");
      if (cancelled) return;
      setAccounts(((data ?? []) as Array<Account & { is_test: boolean | null }>).map((a) => ({
        account_key: a.account_key,
        label: a.label || a.account_key,
      })));
    })();
    return () => { cancelled = true; };
  }, []);

  // Currently-open tickets for the selected customer (light query, not SLA-scored).
  useEffect(() => {
    if (!customer) { setOpenTickets([]); return; }
    let cancelled = false;
    (async () => {
      setOpenLoading(true);
      const { data } = await supabase
        .from("intercom_tickets_v3")
        .select("id,intercom_conversation_id,subject,intercom_created_at,lifecycle_status,raw_payload")
        .eq("customer_key", customer)
        .in("lifecycle_status", ["open", "reopened_after_finalize"])
        .order("intercom_created_at", { ascending: false });
      if (cancelled) return;
      setOpenTickets((data ?? []) as OpenTicket[]);
      setOpenLoading(false);
    })();
    return () => { cancelled = true; };
  }, [customer]);

  // Closed rows for this customer + range, straight off the shared engine output.
  const closedRows = useMemo(() => {
    if (!customer) return [];
    const { startMs, endMs } = rangeBounds(range, new Date());
    return inScope.filter((r) => {
      if (r.customer_key !== customer) return false;
      const t = rowClosedAtMs(r);
      return t != null && t >= startMs && t < endMs;
    });
  }, [inScope, customer, range]);

  const scored = useMemo(() => {
    return closedRows.map((row) => {
      const sev = parseSeverity(row.raw_payload?.custom_attributes?.Severity);
      const compliance: SlaCompliance | null = sev == null ? null : evaluateCompliance(row.sla, sev);
      return { row, sev, compliance };
    });
  }, [closedRows]);

  const summary = useMemo(() => {
    let frMet = 0, frBreach = 0, resMet = 0, resBreach = 0;
    const bySev: Record<Severity | "unclassified", number> = { 1: 0, 2: 0, 3: 0, 4: 0, unclassified: 0 };
    for (const { row, sev, compliance } of scored) {
      bySev[sev ?? "unclassified"]++;
      if (!compliance) continue;
      // FR is scoped to customer-initiated tickets, consistent with the rest of the app.
      if (row.sla.initiatedBy === "customer") {
        if (compliance.firstResponse.met === true) frMet++;
        else if (compliance.firstResponse.met === false) frBreach++;
      }
      if (compliance.resolution.met === true) resMet++;
      else if (compliance.resolution.met === false) resBreach++;
    }
    const frDenom = frMet + frBreach;
    const resDenom = resMet + resBreach;
    return {
      bySev,
      frPct: frDenom ? (frMet / frDenom) * 100 : null,
      frDenom,
      resPct: resDenom ? (resMet / resDenom) * 100 : null,
      resDenom,
      breaches: frBreach + resBreach,
    };
  }, [scored]);

  const customerName = customer ? (customerLabels.get(customer) ?? accounts.find((a) => a.account_key === customer)?.label ?? customer) : null;

  type DetailRow = {
    key: string;
    subject: string;
    sev: Severity | null;
    created: string | null;
    closed: number | null;
    compliance: SlaCompliance | null;
    state: string;
  };

  const detailRows = useMemo<DetailRow[]>(() => {
    const open: DetailRow[] = openTickets.map((t) => ({
      key: `o-${t.id}`,
      subject: t.subject || "(no subject)",
      sev: parseSeverity(t.raw_payload?.custom_attributes?.Severity),
      created: t.intercom_created_at,
      closed: null,
      compliance: null,
      state: t.lifecycle_status === "reopened_after_finalize" ? "Reopened" : "Open",
    }));
    if (!showClosed) return open;
    const closed: DetailRow[] = scored.map(({ row, sev, compliance }) => ({
      key: `c-${row.id}`,
      subject: row.subject || "(no subject)",
      sev,
      created: row.intercom_created_at,
      closed: rowClosedAtMs(row),
      compliance,
      state: "Closed",
    }));
    return [...open, ...closed];
  }, [openTickets, scored, showClosed]);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Beaker className="h-3.5 w-3.5" /> Experimental prototype
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Customer report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-customer SLA and volume view for CSM consumption. All detail is in-app — no Intercom access required.
          </p>
        </div>

        {error && <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-[280px] justify-between h-9">
                <span className="truncate">{customerName ?? "Select a customer…"}</span>
                <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0 pointer-events-auto" align="start">
              <Command>
                <CommandInput placeholder="Search customers…" />
                <CommandList>
                  <CommandEmpty>No customer found.</CommandEmpty>
                  <CommandGroup>
                    {accounts.map((a) => (
                      <CommandItem
                        key={a.account_key}
                        value={`${a.label} ${a.account_key}`}
                        onSelect={() => { setCustomer(a.account_key); setPickerOpen(false); }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", customer === a.account_key ? "opacity-100" : "opacity-0")} />
                        <span className="truncate">{a.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="h-9 w-[170px] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
                <SelectItem key={k} value={k}>{RANGE_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Switch id="show-closed" checked={showClosed} onCheckedChange={setShowClosed} />
            <Label htmlFor="show-closed" className="text-sm text-muted-foreground">Show closed issues</Label>
          </div>

          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {!customer ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Choose a customer above to see their SLA and volume report.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard title="Total tickets" desc={`Open + closed in ${RANGE_LABELS[range].toLowerCase()}`} value={String(openTickets.length + closedRows.length)} />
              <StatCard title="Currently open" desc="Open or reopened right now" value={openLoading ? "…" : String(openTickets.length)} />
              <StatCard title="Closed in range" desc={RANGE_LABELS[range]} value={String(closedRows.length)} />
              <StatCard
                title="First response met"
                desc={`Customer-initiated only (n=${summary.frDenom})`}
                value={summary.frPct == null ? "n/a" : `${summary.frPct.toFixed(0)}%`}
                emphasize
              />
              <StatCard
                title="Resolution met"
                desc={`Evaluable closed tickets (n=${summary.resDenom})`}
                value={summary.resPct == null ? "n/a" : `${summary.resPct.toFixed(0)}%`}
                emphasize
              />
              <StatCard title="Breaches" desc="First response + resolution" value={String(summary.breaches)} />
            </div>

            {/* Severity breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Closed by severity</CardTitle>
                <CardDescription className="text-xs">Unclassified severity is surfaced, never defaulted.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {([1, 2, 3, 4] as const).map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">Sev {s}: {summary.bySev[s]}</Badge>
                ))}
                <Badge variant="outline" className="text-xs">Unclassified: {summary.bySev.unclassified}</Badge>
              </CardContent>
            </Card>

            {/* Detail */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Issues {showClosed ? "(open + closed)" : "(currently open)"}
                </CardTitle>
                <CardDescription className="text-xs">{detailRows.length} row(s)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Subject</TableHead>
                      <TableHead className="text-left w-[100px]">Severity</TableHead>
                      <TableHead className="text-left w-[110px]">Created</TableHead>
                      <TableHead className="text-left w-[110px]">Resolved</TableHead>
                      <TableHead className="text-left w-[160px]">First response</TableHead>
                      <TableHead className="text-left w-[160px]">Resolution</TableHead>
                      <TableHead className="text-left w-[100px]">State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-sm text-muted-foreground py-8 text-center">
                          No issues to show.
                        </TableCell>
                      </TableRow>
                    )}
                    {detailRows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="text-left max-w-[360px] truncate">{r.subject}</TableCell>
                        <TableCell className="text-left">{r.sev == null ? "—" : `Sev ${r.sev}`}</TableCell>
                        <TableCell className="text-left tabular-nums">{fmtDate(r.created)}</TableCell>
                        <TableCell className="text-left tabular-nums">{fmtDate(r.closed)}</TableCell>
                        <TableCell className="text-left">
                          {r.compliance ? (
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums text-xs">{fmt(r.compliance.firstResponse.value, r.compliance.firstResponse.clock)}</span>
                              <MetBadge met={r.compliance.firstResponse.met} />
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-left">
                          {r.compliance ? (
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums text-xs">{fmt(r.compliance.resolution.value, r.compliance.resolution.clock)}</span>
                              <MetBadge met={r.compliance.resolution.met} />
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-left">
                          <Badge variant="outline" className="text-[10px]">{r.state}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function StatCard({ title, desc, value, emphasize }: { title: string; desc: string; value: string; emphasize?: boolean }) {
  return (
    <Card className={emphasize ? "ring-1 ring-primary/40" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
