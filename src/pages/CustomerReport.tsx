import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { displaySubject } from "@/lib/subjectDisplay";
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
import { summarizeCsat, csatExclusionNote, useCsatFilters, useCsatOverrides } from "@/lib/csat";
import { CsatFilterMenu } from "@/components/csat/CsatFilterMenu";

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
  subject_override?: string | null;
  intercom_created_at: string | null;
  intercom_updated_at: string | null;
  lifecycle_status: string | null;
  raw_payload: any;
};

function fmt(sec: number | null, clock: "business" | "calendar") {
  return (clock === "business" ? formatBusinessDuration : formatDuration)(sec);
}

function isEscalated(ca: any): boolean {
  const tt = String(ca?.["Ticket type"] ?? "").toLowerCase();
  const esc = String(ca?.["Escalated to Engineering"] ?? "").toLowerCase() === "yes";
  return esc || tt === "bug" || tt === "incident";
}

function linearIssueId(url: string): string | null {
  const m = url.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  return m ? m[1] : null;
}

function escalatedIssueUrl(ca: any): string | null {
  const v = ca?.["Escalated Issue"] ?? ca?.["Linear Issue"];
  const s = v == null ? "" : String(v).trim();
  return s || null;
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
  const [csatFilters, setCsatFilters] = useCsatFilters();
  const { overrides: csatOverrides } = useCsatOverrides();
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
        .select("id,intercom_conversation_id,subject,subject_override,subject_ai,intercom_created_at,intercom_updated_at,lifecycle_status,csat_rating,csat_rater_is_internal,raw_payload")
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

  const csat = useMemo(
    () => summarizeCsat(
      scored.map(({ row }) => ({
        id: row.id,
        csat_rating: typeof (row as any).csat_rating === "number"
          ? (row as any).csat_rating
          : Number.isFinite(Number(row.raw_payload?.conversation_rating?.rating))
            ? Number(row.raw_payload?.conversation_rating?.rating)
            : null,
        csat_rater_is_internal: (row as any).csat_rater_is_internal ?? null,
      })),
      csatOverrides,
      csatFilters,
    ),
    [scored, csatOverrides, csatFilters],
  );

  const escalated = useMemo(() => {
    type Row = {
      id: string;
      subject: string | null;
      subject_override?: string | null;
      intercom_conversation_id: string;
      severity: Severity | null;
      ticketType: string;
      escalatedToEng: boolean;
      linkedIssue: string | null;
      state: "Open" | "Reopened" | "Closed";
      created: string | number | null;
    };
    const rows: Row[] = [];
    for (const t of openTickets) {
      const ca = t.raw_payload?.custom_attributes;
      if (!isEscalated(ca)) continue;
      rows.push({
        id: t.id,
        subject: t.subject,
        subject_override: (t as any).subject_override ?? null,
        intercom_conversation_id: t.intercom_conversation_id,
        severity: parseSeverity(ca?.Severity),
        ticketType: ca?.["Ticket type"] || "—",
        escalatedToEng: ca?.["Escalated to Engineering"] === "Yes",
        linkedIssue: escalatedIssueUrl(ca),
        state: t.lifecycle_status === "reopened_after_finalize" ? "Reopened" : "Open",
        created: t.intercom_created_at,
      });
    }
    for (const { row } of scored) {
      const ca = row.raw_payload?.custom_attributes;
      if (!isEscalated(ca)) continue;
      rows.push({
        id: row.id,
        subject: row.subject,
        subject_override: (row as any).subject_override ?? null,
        intercom_conversation_id: row.intercom_conversation_id,
        severity: parseSeverity(ca?.Severity),
        ticketType: ca?.["Ticket type"] || "—",
        escalatedToEng: ca?.["Escalated to Engineering"] === "Yes",
        linkedIssue: escalatedIssueUrl(ca),
        state: "Closed",
        created: row.intercom_created_at,
      });
    }
    return rows;
  }, [openTickets, scored]);

  const openBySev = useMemo(() => {
    const b: Record<Severity | "unclassified", number> = { 1: 0, 2: 0, 3: 0, 4: 0, unclassified: 0 };
    for (const t of openTickets) {
      const s = parseSeverity(t.raw_payload?.custom_attributes?.Severity);
      b[s ?? "unclassified"]++;
    }
    return b;
  }, [openTickets]);

  const customerName = customer ? (customerLabels.get(customer) ?? accounts.find((a) => a.account_key === customer)?.label ?? customer) : null;


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
              <StatCard title="Currently open" desc="Open or reopened right now" value={openLoading ? "…" : String(openTickets.length)} sev={openBySev} />
              <StatCard title="Closed in range" desc={RANGE_LABELS[range]} value={String(closedRows.length)} sev={summary.bySev} unclassifiedIsAnomaly />
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
              <div className="col-span-full flex justify-end">
                <CsatFilterMenu filters={csatFilters} onChange={setCsatFilters} summary={csat} />
              </div>
              <StatCard
                title="CSAT positive"
                desc={csat.n === 0
                  ? "0 counted responses"
                  : `${csat.n} responses · avg ${csat.avg!.toFixed(1)}${csatExclusionNote(csat) ? ` · ${csatExclusionNote(csat)}` : ""}`}
                value={csat.pctPositive == null ? "n/a" : `${csat.pctPositive.toFixed(0)}%`}
              />
            </div>


            {/* Escalated to Dev */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Escalated to Dev</CardTitle>
                <CardDescription className="text-xs">
                  {escalated.length} escalated item(s) — bugs, incidents, or escalated to engineering (open + closed)
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Subject</TableHead>
                      <TableHead className="text-left w-[140px]">Intercom ID</TableHead>
                      <TableHead className="text-left w-[100px]">Severity</TableHead>
                      <TableHead className="text-left w-[110px]">Type</TableHead>
                      <TableHead className="text-left w-[100px]">Esc→Eng</TableHead>
                      <TableHead className="text-left w-[130px]">Linked issue</TableHead>
                      <TableHead className="text-left w-[100px]">State</TableHead>
                      <TableHead className="text-left w-[110px]">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {escalated.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-sm text-muted-foreground py-8 text-center">
                          No escalated items for this customer.
                        </TableCell>
                      </TableRow>
                    )}
                    {escalated.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-left max-w-[320px] truncate">{displaySubject(e, "(no subject)")}</TableCell>
                        <TableCell className="text-left tabular-nums text-xs select-all">{e.intercom_conversation_id}</TableCell>
                        <TableCell className="text-left">{e.severity == null ? "—" : `Sev ${e.severity}`}</TableCell>
                        <TableCell className="text-left">{e.ticketType}</TableCell>
                        <TableCell className="text-left">
                          {e.escalatedToEng
                            ? <Badge variant="outline" className="text-[10px] border-primary/40 bg-primary/10">Yes</Badge>
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left">
                          {e.linkedIssue ? (
                            <a
                              href={e.linkedIssue}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-2 text-xs"
                            >
                              {linearIssueId(e.linkedIssue) ?? "Link"}
                            </a>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-left">
                          <Badge variant="outline" className="text-[10px]">{e.state}</Badge>
                        </TableCell>
                        <TableCell className="text-left tabular-nums">{fmtDate(e.created)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>


            {/* Open issues */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Open issues</CardTitle>
                <CardDescription className="text-xs">{openTickets.length} row(s)</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Subject</TableHead>
                      <TableHead className="text-left w-[140px]">Intercom ID</TableHead>
                      <TableHead className="text-left w-[100px]">Severity</TableHead>
                      <TableHead className="text-left w-[110px]">Created</TableHead>
                      <TableHead className="text-left w-[110px]">Last activity</TableHead>
                      <TableHead className="text-left w-[100px]">State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openTickets.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-sm text-muted-foreground py-8 text-center">
                          No open issues.
                        </TableCell>
                      </TableRow>
                    )}
                    {openTickets.map((t) => {
                      const sev = parseSeverity(t.raw_payload?.custom_attributes?.Severity);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="text-left max-w-[360px] truncate">{displaySubject(t, "(no subject)")}</TableCell>
                          <TableCell className="text-left tabular-nums text-xs select-all">{t.intercom_conversation_id}</TableCell>
                          <TableCell className="text-left">{sev == null ? "—" : `Sev ${sev}`}</TableCell>
                          <TableCell className="text-left tabular-nums">{fmtDate(t.intercom_created_at)}</TableCell>
                          <TableCell className="text-left tabular-nums">{fmtDate(t.intercom_updated_at)}</TableCell>
                          <TableCell className="text-left">
                            <Badge variant="outline" className="text-[10px]">
                              {t.lifecycle_status === "reopened_after_finalize" ? "Reopened" : "Open"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Closed issues */}
            {showClosed && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Closed issues</CardTitle>
                  <CardDescription className="text-xs">{scored.length} row(s) · {RANGE_LABELS[range]}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left">Subject</TableHead>
                        <TableHead className="text-left w-[140px]">Intercom ID</TableHead>
                        <TableHead className="text-left w-[100px]">Severity</TableHead>
                        <TableHead className="text-left w-[110px]">Created</TableHead>
                        <TableHead className="text-left w-[110px]">Resolved</TableHead>
                        <TableHead className="text-left w-[160px]">First response</TableHead>
                        <TableHead className="text-left w-[160px]">Resolution</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scored.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-sm text-muted-foreground py-8 text-center">
                            No closed issues in range.
                          </TableCell>
                        </TableRow>
                      )}
                      {scored.map(({ row, sev, compliance }) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-left max-w-[360px] truncate">{displaySubject(row, "(no subject)")}</TableCell>
                          <TableCell className="text-left tabular-nums text-xs select-all">{row.intercom_conversation_id}</TableCell>
                          <TableCell className="text-left">{sev == null ? "—" : `Sev ${sev}`}</TableCell>
                          <TableCell className="text-left tabular-nums">{fmtDate(row.intercom_created_at)}</TableCell>
                          <TableCell className="text-left tabular-nums">{fmtDate(rowClosedAtMs(row))}</TableCell>
                          <TableCell className="text-left">
                            {compliance ? (
                              <span className="flex items-center gap-2">
                                <span className="tabular-nums text-xs">{fmt(compliance.firstResponse.value, compliance.firstResponse.clock)}</span>
                                <MetBadge met={compliance.firstResponse.met} />
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-left">
                            {compliance ? (
                              <span className="flex items-center gap-2">
                                <span className="tabular-nums text-xs">{fmt(compliance.resolution.value, compliance.resolution.clock)}</span>
                                <MetBadge met={compliance.resolution.met} />
                              </span>
                            ) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

          </>
        )}
      </div>
    </AppLayout>
  );
}

function StatCard({ title, desc, value, emphasize, sev, unclassifiedIsAnomaly }: {
  title: string; desc: string; value: string; emphasize?: boolean;
  sev?: Record<Severity | "unclassified", number>;
  unclassifiedIsAnomaly?: boolean;
}) {
  return (
    <Card className={emphasize ? "ring-1 ring-primary/40" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sev && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
            {([1, 2, 3, 4] as const).map((s) => (
              <span key={s} className="whitespace-nowrap">Sev {s}: <span className="font-semibold text-foreground">{sev[s]}</span></span>
            ))}
            {sev.unclassified > 0 && (
              <span className={cn("whitespace-nowrap", unclassifiedIsAnomaly && "text-destructive")}>Uncl: <span className="font-semibold">{sev.unclassified}</span></span>
            )}
          </div>

        )}
      </CardContent>
    </Card>
  );
}
