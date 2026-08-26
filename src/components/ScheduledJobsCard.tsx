import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, PauseCircle, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Read-only pg_cron introspection panel.
 *
 * Backed by `public.esh_cron_jobs()` — a SECURITY DEFINER, admin-gated function
 * that reads the schedule table and the last run per job, with any
 * Authorization / Bearer value in the command redacted before it leaves the DB.
 *
 * There is deliberately NO write path here: jobs are created, altered and
 * removed only from the SQL editor. This card exists so a silently failing
 * schedule is visible without depending on the target function remembering to
 * write an `integration_health` key.
 */

type CronJobRow = {
  jobname: string;
  schedule: string;
  active: boolean;
  command_summary: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
};

type Severity = "ok" | "warn" | "error" | "paused" | "unknown";

const SEVERITY_META: Record<Severity, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "Ran OK", className: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: CheckCircle2 },
  warn: { label: "Overdue", className: "bg-amber-100 text-amber-800 border-amber-200", Icon: AlertTriangle },
  error: { label: "Failed", className: "bg-red-100 text-red-800 border-red-200", Icon: AlertTriangle },
  paused: { label: "Disabled", className: "bg-muted text-muted-foreground border-border", Icon: PauseCircle },
  unknown: { label: "Never run", className: "bg-muted text-muted-foreground border-border", Icon: Circle },
};

/**
 * Best-effort cadence in minutes for the cron expressions this project uses.
 * Returns null when the expression is not one we can reason about — in that
 * case we never claim a job is overdue.
 */
export function cadenceMinutes(schedule: string): number | null {
  const s = (schedule || "").trim();
  const named: Record<string, number> = {
    "@hourly": 60,
    "@daily": 1440,
    "@midnight": 1440,
    "@weekly": 10080,
    "@monthly": 44640,
  };
  if (named[s]) return named[s];

  const secs = s.match(/^(\d+)\s+seconds?$/i);
  if (secs) return Number(secs[1]) / 60;

  const parts = s.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, , dow] = parts;

  const everyN = min.match(/^\*\/(\d+)$/);
  if (everyN && hour === "*") return Number(everyN[1]);
  if (min === "*" && hour === "*") return 1;

  const hourEveryN = hour.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(min) && hourEveryN) return Number(hourEveryN[1]) * 60;
  if (/^\d+$/.test(min) && hour === "*") return 60;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    if (dom === "*" && dow === "*") return 1440;
    if (dow !== "*") return 10080;
    return 44640;
  }
  return null;
}

export function severityFor(row: CronJobRow): Severity {
  if (!row.active) return "paused";
  const status = (row.last_status || "").toLowerCase();
  if (status && status !== "succeeded" && status !== "running") return "error";
  if (!row.last_run_at) return "unknown";

  const cadence = cadenceMinutes(row.schedule);
  if (cadence == null) return status === "succeeded" ? "ok" : "unknown";

  const ageMin = (Date.now() - new Date(row.last_run_at).getTime()) / 60000;
  // Two missed cycles (plus a 5 min floor) before we call it overdue.
  if (ageMin > Math.max(cadence * 2, 5)) return "warn";
  return "ok";
}

export default function ScheduledJobsCard() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [rows, setRows] = useState<CronJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("esh_cron_jobs");
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setError(null);
      setRows((data || []) as CronJobRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!adminLoading && isAdmin) load();
    else if (!adminLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminLoading, isAdmin]);

  if (adminLoading || !isAdmin) return null;

  const problems = rows.filter((r) => {
    const s = severityFor(r);
    return s === "error" || s === "warn";
  }).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-lg">Scheduled jobs</CardTitle>
          <CardDescription>
            Read-only view of pg_cron. Credentials in job commands are redacted before they leave the database.
            Jobs are created and changed only from the SQL editor.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {problems > 0 && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
              {problems} need attention
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Could not read the schedule list: {error}
            <div className="mt-1 text-amber-800">
              This panel needs <code>public.esh_cron_jobs()</code>. Run the introspection migration in the SQL editor,
              then refresh.
            </div>
          </div>
        )}

        {!error && !loading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No scheduled jobs reported.</p>
        )}

        {rows.map((row) => {
          const sev = severityFor(row);
          const meta = SEVERITY_META[sev];
          const Icon = meta.Icon;
          return (
            <div
              key={row.jobname}
              className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{row.jobname}</span>
                  <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">{row.schedule}</code>
                </div>
                {row.command_summary && (
                  <p className="mt-1 truncate text-xs text-muted-foreground" title={row.command_summary}>
                    {row.command_summary}
                  </p>
                )}
                {sev === "error" && row.last_message && (
                  <p className="mt-1 truncate text-xs text-red-700" title={row.last_message}>
                    {row.last_message}
                  </p>
                )}
              </div>
              <div className="whitespace-nowrap text-right text-xs text-muted-foreground">
                {row.last_run_at ? (
                  <>Last run {formatDistanceToNow(new Date(row.last_run_at), { addSuffix: true })}</>
                ) : (
                  <>No run recorded</>
                )}
                {row.last_status && <div>Status: {row.last_status}</div>}
              </div>
            </div>
          );
        })}

        <p className="text-xs text-muted-foreground">
          Overdue = no run within twice the job's cadence. Sourced from pg_cron itself, so a job that fails before it
          can report its own health is still visible here.
        </p>
      </CardContent>
    </Card>
  );
}
