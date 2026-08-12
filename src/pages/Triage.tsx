import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Info } from "lucide-react";
import { format } from "date-fns";
import { useSlaPolicy } from "@/hooks/useSlaPolicy";
import { PolicyFallbackBanner } from "@/components/sla/PolicyFallbackBanner";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { IssueDetailSheet, IssueField } from "@/components/issues/IssueDetailSheet";
import { idColumn, subjectColumn, contactColumn, customerColumn, ownerColumn } from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import {
  computeSla,
  businessHoursBetween,
  formatDuration,
  DEFAULT_BUSINESS_HOURS,
  TRIAGE_TARGET_S,
  type BusinessHoursConfig,
} from "@/lib/slaMetrics";

type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  customer_key: string | null;
  custom_attributes: any;
  intercom_created_at: string | null;
  last_synced_at: string | null;
  raw_payload: any;
};

type Band = "breached" | "at_risk" | "approaching" | "ok";

type TriageRow = Row & {
  anchorS: number | null;
  fromAssignment: boolean;
  businessS: number | null;
  wallS: number | null;
  band: Band;
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


function hasSeverity(attrs: any): boolean {
  const v = attrs?.["Severity"];
  if (v == null) return false;
  return String(v).trim() !== "";
}

export default function Triage() {
  const { policies, loading: policyLoading, error: policyError, resolveForAnchor } = useSlaPolicy();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState(ANY);
  const [customer, setCustomer] = useState(ANY);
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000));

  // Tick every 30s so ages/bands advance without a reload (data itself is not refetched).
  useEffect(() => {
    const t = setInterval(() => setNowS(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  const { accountLabel } = useCustomerLabels();
  const [selected, setSelected] = useState<TriageRow | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("intercom_tickets_v3")
      .select(
        "id,intercom_conversation_id,subject,contact_name,contact_email,owner,customer_key,custom_attributes,intercom_created_at,last_synced_at,raw_payload",
      )
      .in("lifecycle_status", ["open", "reopened_after_finalize"])
      .limit(1000);
    if (!error) setRows((data ?? []) as Row[]);
    setLoading(false);
    setNowS(Math.floor(Date.now() / 1000));
  };

  useEffect(() => { load(); }, []);

  const configLoaded = policies.length > 0 && !policyError;
  const activePolicy = useMemo(
    () => (configLoaded ? resolveForAnchor(Date.now()) : null),
    [configLoaded, resolveForAnchor],
  );
  const businessHours: BusinessHoursConfig = activePolicy?.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const targetS = activePolicy?.triageTargetS ?? TRIAGE_TARGET_S;
  const policyFallback = !configLoaded || activePolicy == null || activePolicy.triageTargetS == null;

  const untriaged = useMemo(() => {
    if (policyLoading) return [];
    return rows
      .filter((r) => !hasSeverity(r.custom_attributes))
      .map((r) => {
        const sla = computeSla(r.raw_payload, undefined, businessHours);
        const createdS = r.intercom_created_at ? Math.floor(new Date(r.intercom_created_at).getTime() / 1000) : null;
        const anchorS = sla.slaClockStartS ?? sla.createdAtS ?? createdS;
        const fromAssignment = sla.slaClockStartS != null && sla.slaClockStartS !== sla.createdAtS;
        const businessS = anchorS != null ? businessHoursBetween(anchorS, nowS, businessHours) : null;
        const wallS = anchorS != null ? Math.max(0, nowS - anchorS) : null;
        return {
          ...r,
          anchorS,
          fromAssignment,
          businessS,
          wallS,
          band: bandFor(businessS ?? 0, targetS) as Band,
        };
      })
      .sort((a, b) => (b.businessS ?? -1) - (a.businessS ?? -1));
  }, [rows, nowS, businessHours, targetS, policyLoading]);

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
        const hay = [r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [untriaged, search, owner, customer]);

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
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Triage queue</h1>
              <Badge variant="outline" className="text-[10px]">Read-only</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Open Enterprise-Inbox tickets with no <code className="text-xs">Severity</code> assigned in Intercom,
              oldest first. Graded against the triage target ({formatDuration(targetS)}, business hours — provisional).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {dataAsOf ? `Data as of ${format(new Date(dataAsOf), "HH:mm")} · syncs every 5 min` : "—"}
            </span>
            <Button onClick={load} size="sm" variant="outline" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <PolicyFallbackBanner show={policyFallback} error={policyError} />

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            No live Intercom feed. <code className="text-xs">sync-v3-open</code> runs every 5 minutes over tickets
            changed since the last window, so a newly-triaged ticket leaves this queue within about 5 minutes.
            Age is business-hours elapsed ({businessHours.dayStartHour}:00–{businessHours.dayEndHour}:00 {businessHours.tz},
            work days only), anchored on Enterprise-Inbox assignment where present, else ticket creation.
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {(["breached", "at_risk", "approaching", "ok"] as Band[]).map((b) => (
            <div key={b} className={`rounded-md border px-3 py-1.5 text-xs ${BAND_META[b].pill}`}>
              <span className="font-semibold">{counts[b]}</span> {BAND_META[b].label}
            </div>
          ))}
          <div className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{filtered.length}</span> awaiting triage
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search subject, contact, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[280px] text-xs"
          />
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Owner: any</SelectItem>
              {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={customer} onValueChange={setCustomer}>
            <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Customer: any</SelectItem>
              {customerOpts.map((k) => <SelectItem key={k} value={k as string}>{accountLabel(k)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <IssueTable<TriageRow>
          rows={filtered}
          columns={columns}
          getRowKey={(r) => r.id}
          loading={loading || policyLoading}
          emptyMessage="Nothing awaiting triage."
          rowClassName={(r) => BAND_META[r.band].row}
          onRowClick={(r) => setSelected(r)}
        />
      </div>

      <IssueDetailSheet
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.subject || "Untitled"}
        conversationId={selected?.intercom_conversation_id ?? null}
      >
        {selected && (
          <>
            <IssueField label="Intercom ID" value={selected.intercom_conversation_id} mono />
            <IssueField label="Age (business)" value={selected.businessS == null ? "—" : formatDuration(selected.businessS)} />
            <IssueField label="Elapsed (wall)" value={selected.wallS == null ? "—" : formatDuration(selected.wallS)} />
            <IssueField label="Band" value={BAND_META[selected.band].label} />
            <IssueField label="Target" value={formatDuration(targetS)} />
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
            <IssueField
              label="Created"
              value={selected.intercom_created_at ? format(new Date(selected.intercom_created_at), "PPpp") : "—"}
            />
          </>
        )}
      </IssueDetailSheet>
    </AppLayout>
  );
}
