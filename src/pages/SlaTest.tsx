import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Gauge, ArrowUpDown } from "lucide-react";
import { format } from "date-fns";
import { aggregate, computeTicketSla, formatDuration, type TicketSla } from "@/lib/slaMetrics";

type Row = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  contact_name: string | null;
  contact_email: string | null;
  intercom_created_at: string | null;
  intercom_closed_at: string | null;
  time_to_resolve_s: number | null;
  time_to_first_admin_reply_s: number | null;
  raw_payload: any;
};

type Enriched = Row & { sla: TicketSla };

type SortKey = "closed" | "firstReply" | "rawResolve" | "responseGap" | "bhHandling" | "parts";

export default function SlaTest() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("closed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const PAGE = 500;
        const all: Row[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await supabase
            .from("intercom_tickets_v3")
            .select("id,intercom_conversation_id,subject,contact_name,contact_email,intercom_created_at,intercom_closed_at,time_to_resolve_s,time_to_first_admin_reply_s,raw_payload")
            .eq("owner", "Matt")
            .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
            .order("intercom_closed_at", { ascending: false })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          const batch = (data ?? []) as Row[];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        if (!cancelled) setRows(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const enriched: Enriched[] = useMemo(
    () => rows.map((r) => ({ ...r, sla: computeTicketSla(r) })),
    [rows],
  );

  const kpis = useMemo(() => ({
    firstReply: aggregate(enriched.map((r) => r.sla.firstAdminReplyS ?? 0)),
    rawResolve: aggregate(enriched.map((r) => r.sla.rawResolveS ?? 0)),
    responseGap: aggregate(enriched.map((r) => r.sla.responseGapSumS)),
    bhHandling: aggregate(enriched.map((r) => r.sla.businessHoursHandlingS)),
  }), [enriched]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: Enriched): number => {
      switch (sortKey) {
        case "closed": return r.intercom_closed_at ? new Date(r.intercom_closed_at).getTime() : 0;
        case "firstReply": return r.sla.firstAdminReplyS ?? -1;
        case "rawResolve": return r.sla.rawResolveS ?? -1;
        case "responseGap": return r.sla.responseGapSumS;
        case "bhHandling": return r.sla.businessHoursHandlingS;
        case "parts": return r.sla.partsCount;
      }
    };
    return [...enriched].sort((a, b) => (val(a) - val(b)) * dir);
  }, [enriched, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <Gauge className="h-3.5 w-3.5" /> Prototype · SLA
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">SLA test</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Comparing four latency metrics across Matt's finalized v3 tickets. All values computed from Intercom part metadata.
              Business hours = Mon–Fri, 09:00–23:59 UTC.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {error && (
          <Card><CardContent className="p-4 text-sm text-destructive">{error}</CardContent></Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Time to first admin reply"
            desc="Intercom time_to_admin_reply"
            agg={kpis.firstReply}
          />
          <KpiCard
            title="Raw time to resolve"
            desc="Intercom time_to_last_close (wall clock)"
            agg={kpis.rawResolve}
          />
          <KpiCard
            title="Response-gap sum"
            desc="Σ user→admin reply gaps"
            agg={kpis.responseGap}
          />
          <KpiCard
            title="Business-hours handling"
            desc="Response-gap sum, clipped to Mon–Fri 09–24 UTC"
            agg={kpis.bhHandling}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Per-ticket breakdown
              {loading && <Loader2 className="h-4 w-4 inline ml-2 animate-spin text-muted-foreground" />}
            </CardTitle>
            <CardDescription>{enriched.length} finalized tickets for Matt</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <SortableTh label="Closed" k="closed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="text-left px-3 py-2 font-medium">Subject</th>
                    <th className="text-left px-3 py-2 font-medium">Contact</th>
                    <SortableTh label="First reply" k="firstReply" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="Raw resolve" k="rawResolve" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="Response-gap" k="responseGap" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="Business-hrs" k="bhHandling" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortableTh label="Parts" k="parts" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {r.intercom_closed_at ? format(new Date(r.intercom_closed_at), "MMM d, yyyy") : "—"}
                      </td>
                      <td className="px-3 py-2 max-w-[320px] truncate">
                        <a
                          href={`https://app.intercom.com/a/inbox/_/inbox/conversation/${r.intercom_conversation_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground hover:underline"
                          title={r.subject ?? ""}
                        >
                          {r.subject || `Intercom #${r.intercom_conversation_id}`}
                        </a>
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate text-muted-foreground" title={r.contact_email ?? ""}>
                        {r.contact_name || r.contact_email || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.firstAdminReplyS)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.rawResolveS)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatDuration(r.sla.responseGapSumS)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatDuration(r.sla.businessHoursHandlingS)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.sla.partsCount}</td>
                    </tr>
                  ))}
                  {!loading && !sorted.length && (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No tickets found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function KpiCard({ title, desc, agg }: { title: string; desc: string; agg: { avg: number | null; median: number | null; p90: number | null; n: number } }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        <Stat label="Avg" value={formatDuration(agg.avg)} />
        <Stat label="Median" value={formatDuration(agg.median)} />
        <Stat label="P90" value={formatDuration(agg.p90)} />
        <div className="text-[10px] text-muted-foreground pt-1">n={agg.n}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SortableTh({
  label, k, sortKey, sortDir, onSort, align,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; align?: "right";
}) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground" : ""}`}
        onClick={() => onSort(k)}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        {active && <span className="text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
