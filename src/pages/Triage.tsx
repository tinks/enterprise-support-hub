import { useEffect, useMemo, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Info, Sparkles } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";

import { format } from "date-fns";
import { useSlaPolicy } from "@/hooks/useSlaPolicy";
import { PolicyFallbackBanner } from "@/components/sla/PolicyFallbackBanner";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { IssueDetailSheet, IssueField } from "@/components/issues/IssueDetailSheet";
import { displaySubject } from "@/lib/subjectDisplay";
import { idColumn, subjectColumn, contactColumn, customerColumn, ownerColumn } from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import { SeverityProposalCard } from "@/components/issues/SeverityProposalCard";
import { PaxInvestigateControl } from "@/components/issues/PaxInvestigateControl";

import { TicketFieldsPanel } from "@/components/issues/TicketFieldsPanel";

import { showTestDataNow } from "@/lib/testTickets";
import { useSearchParams } from "react-router-dom";
import {
  inTriageMode,
  assignmentGap,
  ASSIGNMENT_GAP_LABEL,
  hasSeverityValue,
  isTriageMode,
  TRIAGE_MODE_LABEL,
  type TriageQueueMode,
} from "@/lib/triageQueues";

import {
  computeSla,
  businessHoursBetween,
  formatDuration,
  DEFAULT_BUSINESS_HOURS,
  TRIAGE_TARGET_S,
  parsePlanTier,
  type PlanTier,
  type BusinessHoursConfig,
} from "@/lib/slaMetrics";



type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  subject_ai: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  admin_assignee_id: string | null;
  customer_key: string | null;
  custom_attributes: any;
  intercom_created_at: string | null;
  last_synced_at: string | null;
  raw_payload: any;
  plan_tier?: string | null;
};

type Band = "breached" | "at_risk" | "approaching" | "ok";

type TriageRow = Row & {
  anchorS: number | null;
  fromAssignment: boolean;
  businessS: number | null;
  wallS: number | null;
  band: Band;
  planTier: PlanTier;
  /** Triage target applied to THIS row (plan-specific). */
  targetS: number;
};

const ANY = "__any__";

const BAND_META: Record<Band, { label: string; row: string; pill: string }> = {
  breached: {
    label: "Breached",
    row: "bg-destructive/10 hover:bg-destructive/15",
    pill: "bg-destructive/15 text-destructive border-destructive/40",
  },
  at_risk: {
    label: "At risk",
    row: "bg-amber-500/15 hover:bg-amber-500/20",
    pill: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/50",
  },
  approaching: {
    label: "Approaching",
    row: "bg-amber-500/5 hover:bg-amber-500/10",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  ok: { label: "OK", row: "", pill: "bg-muted text-muted-foreground border-border" },
};

function bandFor(elapsedS: number, targetS: number): Band {
  const pct = targetS > 0 ? elapsedS / targetS : 0;
  if (pct > 1) return "breached";
  if (pct >= 0.8) return "at_risk";
  if (pct >= 0.5) return "approaching";
  return "ok";
}



export default function Triage() {
  const { policies, loading: policyLoading, error: policyError, resolveForAnchor } = useSlaPolicy();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(ANY);
  const [customer, setCustomer] = useState(ANY);
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get("mode");
  const mode: TriageQueueMode = isTriageMode(modeParam) ? modeParam : "needs_severity";
  const setMode = (m: TriageQueueMode) => {
    const next = new URLSearchParams(searchParams);
    if (m === "needs_severity") next.delete("mode");
    else next.set("mode", m);
    setSearchParams(next, { replace: true });
  };
  const severityMode = mode === "needs_severity";

  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));

  // Tick every 30s so ages/bands advance without a reload (data itself is not refetched).
  useEffect(() => {
    const t = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const { accountLabel } = useCustomerLabels();
  const [selected, setSelected] = useState<TriageRow | null>(null);
  const { canEdit } = useCanEdit();
  const [proposing, setProposing] = useState(false);
  const [proposeNote, setProposeNote] = useState<string | null>(null);


  const lastFetchRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    lastFetchRef.current = Date.now();
    setLoading(true);
    let q = supabase
      .from("intercom_tickets_v3")
      .select(
        "id,intercom_conversation_id,subject,subject_override,subject_ai,contact_name,contact_email,owner,admin_assignee_id,customer_key,custom_attributes,intercom_created_at,last_synced_at,raw_payload,plan_tier,is_test_ticket",
      )
      .in("lifecycle_status", ["open", "reopened_after_finalize"]);
    if (!showTestDataNow()) q = q.eq("is_test_ticket", false);
    const { data, error } = await q.limit(1000);
    if (!error) setRows((data ?? []) as Row[]);
    setLoading(false);
    setNowS(Math.floor(Date.now() / 1000));
  };

  useEffect(() => { load(); }, []);

  // Lightweight refetch when the tab regains focus/visibility.
  // Debounced 300ms (alt-tab bursts fire both events) and guarded to at most one fetch per 10s.
  useEffect(() => {
    const maybeRefetch = () => {
      if (document.visibilityState !== "visible") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (Date.now() - lastFetchRef.current < 10_000) return;
        load();
      }, 300);
    };
    window.addEventListener("focus", maybeRefetch);
    document.addEventListener("visibilitychange", maybeRefetch);
    return () => {
      window.removeEventListener("focus", maybeRefetch);
      document.removeEventListener("visibilitychange", maybeRefetch);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);


  const configLoaded = policies.length > 0 && !policyError;
  const activePolicy = useMemo(
    () => (configLoaded ? resolveForAnchor(Date.now()) : null),
    [configLoaded, resolveForAnchor],
  );
  const businessHours: BusinessHoursConfig = activePolicy?.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const targetS = activePolicy?.triageTargetS ?? TRIAGE_TARGET_S;
  // Self-serve enterprise carries its own (looser) triage target and no other
  // SLA commitments. Resolved from the SSE policy version; falls back to 1h.
  const ssePolicy = useMemo(
    () => (configLoaded ? resolveForAnchor(Date.now(), "sse") : null),
    [configLoaded, resolveForAnchor],
  );
  const sseTargetS = ssePolicy?.triageTargetS ?? 3600;
  const policyFallback = !configLoaded || activePolicy == null || activePolicy.triageTargetS == null;

  const untriaged = useMemo(() => {
    if (policyLoading) return [];
    return rows
      .filter((r) => inTriageMode(mode, r))
      .map((r) => {
        const sla = computeSla(r.raw_payload, undefined, businessHours);
        const createdS = r.intercom_created_at ? Math.floor(new Date(r.intercom_created_at).getTime() / 1000) : null;
        const anchorS = sla.slaClockStartS ?? sla.createdAtS ?? createdS;
        const fromAssignment = sla.slaClockStartS != null && sla.slaClockStartS !== sla.createdAtS;
        const planTier = parsePlanTier(r.plan_tier);
        const rowTargetS = planTier === "sse" ? sseTargetS : targetS;
        const businessS = anchorS != null ? businessHoursBetween(anchorS, nowS, businessHours) : null;
        const wallS = anchorS != null ? Math.max(0, nowS - anchorS) : null;
        return {
          ...r,
          anchorS,
          fromAssignment,
          businessS,
          wallS,
          planTier,
          targetS: rowTargetS,
          band: bandFor(businessS ?? 0, rowTargetS) as Band,
        };
      })
      .sort((a, b) => (b.businessS ?? -1) - (a.businessS ?? -1));
  }, [rows, nowS, businessHours, targetS, sseTargetS, policyLoading, mode]);

  const ownerOpts = useMemo(
    () => Array.from(new Set(untriaged.map((r) => r.owner).filter(Boolean))).sort() as string[],
    [untriaged],
  );
  const customerOpts = useMemo(
    () => Array.from(new Set(untriaged.map((r) => r.customer_key).filter(Boolean))).sort() as string[],
    [untriaged],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return untriaged.filter((r) => {
      if (owner !== ANY && r.owner !== owner) return false;
      if (customer !== ANY && r.customer_key !== customer) return false;
      if (q) {
        const hay = [displaySubject(r), r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [untriaged, search, owner, customer]);

  // Batch proposal over what the user can actually see. Capped at 25 by the
  // edge function; tickets whose text hasn't changed since their last proposal
  // are skipped there without a model call.
  const proposeVisible = async () => {
    setProposing(true);
    setProposeNote(null);
    try {
      const ids = filtered.slice(0, 25).map((r) => r.intercom_conversation_id);
      const { data, error } = await supabase.functions.invoke("propose-severity", {
        body: { ticketIds: ids, pass: "triage" },
      });
      if (error) {
        setProposeNote(`Failed — ${error.message}`);
        return;
      }
      const results: any[] = (data as any)?.results ?? [];
      const made = results.filter((r) => r.ok && !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      const failed = results.filter((r) => r.ok === false).length;
      setProposeNote(
        `${made} proposed · ${skipped} unchanged (no call) · ${failed} failed · ${(data as any)?.remainingToday ?? "?"} calls left today`,
      );
    } finally {
      setProposing(false);
    }
  };



  const columns: IssueColumn<TriageRow>[] = useMemo(() => [
    idColumn<TriageRow>((r) => r.intercom_conversation_id),
    subjectColumn<TriageRow>((r) => displaySubject(r), undefined, {
      conversationId: (r) => r.intercom_conversation_id,
      subjectRow: (r) => r,
      onSaved: (r, next) =>
        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, subject_override: next } : x))),
    }),
    contactColumn<TriageRow>((r) => r.contact_name, (r) => r.contact_email),
    customerColumn<TriageRow>((r) => r.customer_key, accountLabel),
    ownerColumn<TriageRow>((r) => r.owner),
    {
      key: "plan",
      header: "Plan",
      width: "w-[110px]",
      cellClassName: "text-xs",
      sortValue: (r: TriageRow) => (r.planTier === "sse" ? "SSE" : "Enterprise"),
      cell: (r: TriageRow) =>
        r.planTier === "sse" ? (
          <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium">
            SSE
          </span>
        ) : (
          <span className="text-muted-foreground">Enterprise</span>
        ),
    } as IssueColumn<TriageRow>,
    ...(severityMode
      ? []
      : [{
          key: "missing",
          header: "Missing",
          width: "w-[170px]",
          cellClassName: "text-xs",
          sortValue: (r: TriageRow) => {
            const gap = assignmentGap(r);
            const parts: string[] = [];
            if (gap) parts.push(ASSIGNMENT_GAP_LABEL[gap]);
            if (!hasSeverityValue(r.custom_attributes)) parts.push("no severity");
            return parts.join(" · ");
          },
          cell: (r: TriageRow) => {
            const gap = assignmentGap(r);
            const parts: string[] = [];
            if (gap) parts.push(ASSIGNMENT_GAP_LABEL[gap]);
            if (!hasSeverityValue(r.custom_attributes)) parts.push("no severity");
            return parts.length ? parts.join(" · ") : "—";
          },
        } as IssueColumn<TriageRow>]),
    {
      key: "age_business",
      header: "Age (business)",
      width: "w-[170px]",
      sortValue: (r) => r.businessS,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">{r.businessS == null ? "—" : formatDuration(r.businessS)}</span>
          {severityMode && (
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${BAND_META[r.band].pill}`}>
              {BAND_META[r.band].label}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "age_wall",
      header: "Elapsed (wall)",
      width: "w-[120px]",
      sortValue: (r) => r.wallS,
      cellClassName: "text-xs text-muted-foreground tabular-nums",
      cell: (r) => (r.wallS == null ? "—" : formatDuration(r.wallS)),
    },
    {
      key: "anchor",
      header: "Anchor",
      width: "w-[170px]",
      sortValue: (r) => r.anchorS,
      cellClassName: "text-xs",
      cell: (r) => (
        <div>
          <div>{r.anchorS ? format(new Date(r.anchorS * 1000), "d MMM HH:mm") : "—"}</div>
          <div className="text-muted-foreground text-[10px]">
            {r.fromAssignment ? "inbox assignment" : "ticket created"}
          </div>
        </div>
      ),
    },
  ], [accountLabel, severityMode]);



  const counts = useMemo(() => {
    const c: Record<Band, number> = { breached: 0, at_risk: 0, approaching: 0, ok: 0 };
    for (const r of filtered) c[r.band] += 1;
    return c;
  }, [filtered]);

  const dataAsOf = useMemo(() => {
    let newest: number | null = null;
    for (const r of rows) {
      if (!r.last_synced_at) continue;
      const t = new Date(r.last_synced_at).getTime();
      if (newest == null || t > newest) newest = t;
    }
    return newest;
  }, [rows]);

  return (
    <AppLayout>
      <div className="p-3 sm:p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Triage queue</h1>
              {severityMode && (
                <Badge variant="outline" className="text-[10px]">Severity writes enabled</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {severityMode ? (
                <>
                  Open Enterprise-Inbox tickets with no <code className="text-xs">Severity</code> assigned in Intercom,
                  oldest first. Graded against the triage target ({formatDuration(targetS)}, business hours — provisional).
                </>
              ) : mode === "unassigned" ? (
                <>
                  Open Enterprise-Inbox tickets with no Intercom assignee, or an assignee that isn't mapped to a Hub
                  owner. Oldest first, no target.
                </>
              ) : (
                <>Open Enterprise-Inbox tickets missing a Severity or an owner. Oldest first.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {dataAsOf ? `Data as of ${format(new Date(dataAsOf), "HH:mm")} · syncs every 5 min` : "—"}
            </span>
            <Button onClick={load} size="sm" variant="outline" disabled={loading} className="min-h-11 min-w-11 md:min-h-0 md:min-w-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex w-full sm:inline-flex sm:w-auto rounded-md border border-border p-0.5">
          {(["needs_severity", "unassigned", "either"] as TriageQueueMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 sm:flex-none min-h-11 md:min-h-0 rounded px-3 py-1.5 text-xs transition-colors ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {TRIAGE_MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <PolicyFallbackBanner show={policyFallback} error={policyError} />

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            No live Intercom feed. <code className="text-xs">sync-v3-open</code> runs every 5 minutes over tickets
            changed since the last window, so a ticket that gets {severityMode ? "a severity" : "assigned"} leaves this
            queue within about 5 minutes.
            Age is business-hours elapsed ({businessHours.dayStartHour}:00–{businessHours.dayEndHour}:00 {businessHours.tz},
            work days only), anchored on Enterprise-Inbox assignment where present, else ticket creation.
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {severityMode &&
            (["breached", "at_risk", "approaching", "ok"] as Band[]).map((b) => (
              <div key={b} className={`rounded-md border px-3 py-1.5 text-xs ${BAND_META[b].pill}`}>
                <span className="font-semibold">{counts[b]}</span> {BAND_META[b].label}
              </div>
            ))}
          <div className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
            {mode === "unassigned" ? "unassigned" : "awaiting triage"}
          </div>
        </div>


        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search subject, contact, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 md:h-9 w-full sm:w-[280px] text-base sm:text-xs"
          />
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="h-11 md:h-9 flex-1 sm:flex-none sm:w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Owner: any</SelectItem>
              {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={customer} onValueChange={setCustomer}>
            <SelectTrigger className="h-11 md:h-9 flex-1 sm:flex-none sm:w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Customer: any</SelectItem>
              {customerOpts.map((k) => <SelectItem key={k} value={k as string}>{accountLabel(k)}</SelectItem>)}
            </SelectContent>
          </Select>
          {canEdit && severityMode && (
            <Button
              size="sm"
              variant="outline"
              className="h-11 md:h-9 w-full sm:w-auto text-xs"
              disabled={proposing || filtered.length === 0}
              onClick={proposeVisible}
            >
              {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Propose severity for visible (max 25)
            </Button>
          )}
          {proposeNote && <span className="text-xs text-muted-foreground">{proposeNote}</span>}
        </div>


        <div className="md:hidden space-y-2">
          {loading || policyLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {mode === "unassigned" ? "Everything is assigned." : "Nothing awaiting triage."}
            </div>
          ) : (
            filtered.map((r) => {
              const gap = assignmentGap(r);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r)}
                  className={`w-full text-left rounded-lg border border-border p-3 space-y-1.5 active:bg-muted ${severityMode ? BAND_META[r.band].row : "bg-card"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{accountLabel(r.customer_key)}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {severityMode && (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${BAND_META[r.band].pill}`}>
                          {BAND_META[r.band].label}
                        </span>
                      )}
                      <span className="text-xs font-medium tabular-nums">
                        {r.businessS == null ? "—" : formatDuration(r.businessS)}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm leading-snug line-clamp-2">{displaySubject(r)}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="truncate max-w-[60%]">{r.contact_name ?? r.contact_email ?? "—"}</span>
                    <span>·</span>
                    <span className={gap ? "text-destructive" : ""}>{r.owner ?? "Unassigned"}</span>
                    {r.planTier === "sse" && <span className="rounded-full border px-1.5 text-[10px]">SSE</span>}
                    <span className="ml-auto font-mono text-[10px]">{r.intercom_conversation_id}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="hidden md:block">
        <IssueTable<TriageRow>
          rows={filtered}
          columns={columns}
          getRowKey={(r) => r.id}
          loading={loading || policyLoading}
          emptyMessage={mode === "unassigned" ? "Everything is assigned." : "Nothing awaiting triage."}
          rowClassName={(r) => (severityMode ? BAND_META[r.band].row : "")}

          onRowClick={(r) => setSelected(r)}
        />
        </div>
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
            <IssueField label="Age (business)" value={selected.businessS == null ? "—" : formatDuration(selected.businessS)} />
            <IssueField label="Elapsed (wall)" value={selected.wallS == null ? "—" : formatDuration(selected.wallS)} />
            <IssueField label="Band" value={BAND_META[selected.band].label} />
            <IssueField label="Plan" value={selected.planTier === "sse" ? "Self-serve enterprise" : "Enterprise"} />
            <IssueField label="Target" value={formatDuration(selected.targetS)} />
            <IssueField
              label="Anchor"
              value={
                selected.anchorS
                  ? `${format(new Date(selected.anchorS * 1000), "PPpp")} · ${selected.fromAssignment ? "inbox assignment" : "ticket created"}`
                  : "—"
              }
            />
            <IssueField label="Contact" value={`${selected.contact_name ?? "—"} · ${selected.contact_email ?? "—"}`} />
            <IssueField label="Customer" value={accountLabel(selected.customer_key)} />
            <IssueField label="Owner" value={selected.owner} />
            <IssueField label="Product area" value={selected.custom_attributes?.["Affected Product Area"] ?? null} />
            <IssueField
              label="Created"
              value={selected.intercom_created_at ? format(new Date(selected.intercom_created_at), "PPpp") : "—"}
            />
            <div className="pt-2 border-t border-border space-y-3 max-md:[&_button]:min-h-11">
              <div>
                <div className="text-xs text-muted-foreground mb-2">Investigation</div>
                <PaxInvestigateControl conversationId={selected.intercom_conversation_id} />
              </div>
              <SeverityProposalCard
                conversationId={selected.intercom_conversation_id}
                onAccepted={(sev) => {
                  setRows((prev) =>
                    prev.map((r) =>
                      r.intercom_conversation_id === selected.intercom_conversation_id
                        ? { ...r, custom_attributes: { ...(r.custom_attributes ?? {}), Severity: sev } }
                        : r,
                    ),
                  );
                  setSelected(null);
                }}
              />
              <div className="max-md:[&_button]:min-h-11 max-md:[&_[role=combobox]]:min-h-11 max-md:[&_input]:min-h-11">
                <div className="text-xs text-muted-foreground mb-2">Update ticket fields</div>
                <TicketFieldsPanel
                  conversationId={selected.intercom_conversation_id}
                  showSubject
                  onSubjectSaved={(next) => {
                    const id = selected.id;
                    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, subject_override: next } : x)));
                  }}
                  currentSeverity={null}
                  currentOwner={selected.owner}
                  currentProductArea={selected.custom_attributes?.["Affected Product Area"] ?? null}
                  currentTicketType={selected.custom_attributes?.["Ticket type"] ?? null}
                  onWritten={(field, value) => {
                    const convId = selected.intercom_conversation_id;
                    setRows((prev) =>
                      prev.map((r) => {
                        if (r.intercom_conversation_id !== convId) return r;
                        if (field === "owner") return { ...r, owner: value };
                        const key =
                          field === "severity"
                            ? "Severity"
                            : field === "product_area"
                              ? "Affected Product Area"
                              : "Ticket type";
                        return { ...r, custom_attributes: { ...(r.custom_attributes ?? {}), [key]: value } };
                      }),
                    );
                    setSelected((s) => {
                      if (!s) return s;
                      if (field === "severity")
                        return mode === "unassigned"
                          ? { ...s, custom_attributes: { ...(s.custom_attributes ?? {}), Severity: value } }
                          : null; // triaged — drops out of the severity queue

                      // Assigning an owner completes the unassigned queue's gap.
                      if (field === "owner") return severityMode ? { ...s, owner: value } : null;

                      const key = field === "product_area" ? "Affected Product Area" : "Ticket type";
                      return { ...s, custom_attributes: { ...(s.custom_attributes ?? {}), [key]: value } };
                    });
                  }}
                />
              </div>
            </div>

          </>
        )}
      </IssueDetailSheet>
    </AppLayout>
  );
}
