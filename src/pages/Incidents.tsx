import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useTableSort, SortableHead } from "@/components/issues/useTableSort";
import { Loader2, ExternalLink, Download } from "lucide-react";
import { format } from "date-fns";

/**
 * Historical incident log. Rows come from `public.incidents`, which
 * poll-slack-incidents fills from the incident.io announcements in the
 * #incidents Slack channel — that Slack card is also the only place customer
 * impact is visible (a public status-page link), so "Customer impacting" here
 * means "was published to the public status page", nothing more.
 */

type Incident = {
  incident_number: number;
  title: string;
  severity: string | null;
  severity_rank: number | null;
  status: string | null;
  status_category: "live" | "post_incident" | "closed" | "unknown";
  is_customer_impacting: boolean;
  status_page_url: string | null;
  incident_url: string | null;
  incident_channel_id: string | null;
  incident_channel_name: string | null;
  declared_at: string;
  last_update_at: string | null;
  resolved_at: string | null;
};

const ANY = "__any__";

const CATEGORY_LABEL: Record<Incident["status_category"], string> = {
  live: "Live",
  post_incident: "Post-incident",
  closed: "Closed",
  unknown: "Unknown",
};

function fmt(v: string | null) {
  return v ? format(new Date(v), "d MMM yyyy HH:mm") : "—";
}

function duration(row: Incident): number | null {
  if (!row.resolved_at) return null;
  return new Date(row.resolved_at).getTime() - new Date(row.declared_at).getTime();
}

function fmtDuration(ms: number | null) {
  if (ms == null || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Incidents() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState(ANY);
  const [category, setCategory] = useState(ANY);
  const [impact, setImpact] = useState<"all" | "customer" | "internal">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("incidents")
        .select(
          "incident_number, title, severity, severity_rank, status, status_category, is_customer_impacting, status_page_url, incident_url, incident_channel_id, incident_channel_name, declared_at, last_update_at, resolved_at",
        )
        .order("declared_at", { ascending: false })
        .limit(5000);
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows((data ?? []) as Incident[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const severities = useMemo(
    () => [...new Set(rows.map((r) => r.severity).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (severity !== ANY && r.severity !== severity) return false;
      if (category !== ANY && r.status_category !== category) return false;
      if (impact === "customer" && !r.is_customer_impacting) return false;
      if (impact === "internal" && r.is_customer_impacting) return false;
      if (q) {
        const hay = `inc-${r.incident_number} ${r.title} ${r.status ?? ""} ${r.incident_channel_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, severity, category, impact]);

  const { sorted, sort, toggle } = useTableSort<Incident>(
    filtered,
    {
      ref: (r) => r.incident_number,
      title: (r) => r.title,
      severity: (r) => r.severity_rank ?? r.severity ?? null,
      status: (r) => r.status ?? null,
      impact: (r) => (r.is_customer_impacting ? 1 : 0),
      declared: (r) => r.declared_at,
      resolved: (r) => r.resolved_at,
      duration: (r) => duration(r),
    },
    { key: "declared", dir: "desc" },
  );

  const liveCount = rows.filter((r) => r.status_category === "live").length;
  const customerCount = rows.filter((r) => r.is_customer_impacting).length;

  const exportCsv = () => {
    const header = [
      "reference", "title", "severity", "status", "category",
      "customer_impacting", "declared_at", "resolved_at", "duration_minutes", "incident_url",
    ];
    const lines = [header.join(",")];
    for (const r of sorted) {
      const ms = duration(r);
      lines.push([
        `INC-${r.incident_number}`, r.title, r.severity, r.status,
        r.status_category, r.is_customer_impacting, r.declared_at, r.resolved_at,
        ms == null ? "" : Math.round(ms / 60000), r.incident_url,
      ].map(csvCell).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `incidents-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Incidents</h1>
            <p className="text-sm text-muted-foreground">
              Imported from the incident.io announcements in Slack #incidents.
              "Customer impacting" means the incident was published to the public status page.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!sorted.length}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <Input
            placeholder="Search title, reference, channel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72"
          />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Severity" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All severities</SelectItem>
              {severities.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All statuses</SelectItem>
              {(["live", "post_incident", "closed", "unknown"] as const).map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={impact} onValueChange={(v) => setImpact(v as typeof impact)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All impact</SelectItem>
              <SelectItem value="customer">Customer impacting</SelectItem>
              <SelectItem value="internal">Internal only</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {sorted.length} of {rows.length} · {liveCount} live · {customerCount} customer-impacting
          </span>
        </div>

        {error && <p className="text-sm text-destructive">Could not load incidents: {error}</p>}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading incidents…
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead sortKey="ref" sort={sort} onToggle={toggle} className="w-[110px] text-left">Ref</SortableHead>
                  <SortableHead sortKey="title" sort={sort} onToggle={toggle} className="text-left">Title</SortableHead>
                  <SortableHead sortKey="severity" sort={sort} onToggle={toggle} className="w-[110px] text-left">Severity</SortableHead>
                  <SortableHead sortKey="status" sort={sort} onToggle={toggle} className="w-[140px] text-left">Status</SortableHead>
                  <SortableHead sortKey="impact" sort={sort} onToggle={toggle} className="w-[140px] text-left">Impact</SortableHead>
                  <SortableHead sortKey="declared" sort={sort} onToggle={toggle} className="w-[160px] text-left">Opened</SortableHead>
                  <SortableHead sortKey="resolved" sort={sort} onToggle={toggle} className="w-[160px] text-left">Closed</SortableHead>
                  <SortableHead sortKey="duration" sort={sort} onToggle={toggle} className="w-[110px] text-left">Duration</SortableHead>
                  <SortableHead sort={sort} onToggle={toggle} className="w-[140px] text-left">Links</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-sm text-muted-foreground">
                      No incidents match these filters.
                    </TableCell>
                  </TableRow>
                )}
                {sorted.map((r) => (
                  <TableRow key={r.incident_number}>
                    <TableCell className="font-mono text-xs">INC-{r.incident_number}</TableCell>
                    <TableCell className="max-w-[520px] truncate" title={r.title}>{r.title}</TableCell>
                    <TableCell>{r.severity ?? "—"}</TableCell>
                    <TableCell>
                      <span className={r.status_category === "live" ? "text-destructive font-medium" : ""}>
                        {r.status ?? CATEGORY_LABEL[r.status_category]}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.is_customer_impacting ? (
                        <span className="text-xs rounded-full bg-destructive/15 text-destructive px-2 py-0.5">Customer</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Internal</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{fmt(r.declared_at)}</TableCell>
                    <TableCell className="text-sm">{fmt(r.resolved_at)}</TableCell>
                    <TableCell className="text-sm">{fmtDuration(duration(r))}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {r.incident_url && (
                          <a href={r.incident_url} target="_blank" rel="noreferrer" title="incident.io" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {r.status_page_url && (
                          <a href={r.status_page_url} target="_blank" rel="noreferrer" title="Public status page" className="text-xs underline">
                            Status
                          </a>
                        )}
                        {r.incident_channel_id && (
                          <a
                            href={`https://lovable-dev.slack.com/archives/${r.incident_channel_id}`}
                            target="_blank"
                            rel="noreferrer"
                            title={r.incident_channel_name ? `#${r.incident_channel_name}` : "Slack channel"}
                            className="text-xs underline"
                          >
                            Slack
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
