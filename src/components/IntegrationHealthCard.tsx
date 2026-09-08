import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, ShieldAlert, Circle, Send, Play, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";


type HealthRow = {
  integration: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_status: string | null;
  last_error: string | null;
  consecutive_failures: number;
  updated_at: string;
};

// Each integration has an expected freshness window. If last_success_at is older
// than maxStaleMin AND we don't have a fresh failure, surface a "stale" warning.
// `fn` = edge function that is safe to re-run on demand (idempotent pollers).
const INTEGRATIONS: Array<{ key: string; label: string; description: string; maxStaleMin: number; fn?: string }> = [
  { key: "intercom_poll", label: "Intercom poll", description: "Pulls new tickets from the enterprise inbox (every 5 min).", maxStaleMin: 30, fn: "poll-intercom-inbox" },
  { key: "intercom_webhook", label: "Intercom webhook", description: "Live conversation/assignment events from Intercom.", maxStaleMin: 24 * 60 },
  { key: "intercom_csat", label: "Intercom CSAT refresh", description: "Refreshes conversation ratings (hourly).", maxStaleMin: 3 * 60, fn: "refresh-intercom-csat" },
  { key: "intercom_import", label: "Manual Intercom import", description: "On-demand imports from the Log Conversation form.", maxStaleMin: 30 * 24 * 60 },
  { key: "gmail_poll", label: "Gmail poll", description: "Pulls support@ mail and reconciles to Intercom.", maxStaleMin: 30, fn: "poll-gmail" },
  { key: "v3_closed_sync", label: "Inbox V3 closed sync", description: "Finalizes closed Intercom conversations into the v3 reporting table (nightly).", maxStaleMin: 24 * 60, fn: "sync-v3-closed" },
  { key: "slack_closed_won_poll", label: "Closed-won account import", description: "Imports new customer accounts from Slack #closed-won (daily, 7-day lookback).", maxStaleMin: 36 * 60, fn: "poll-slack-closed-won" },
  { key: "slack_incidents_poll", label: "Incident feed", description: "Reads incident.io announcements from Slack #incidents (every 5 min, 2-day rolling window).", maxStaleMin: 30, fn: "poll-slack-incidents" },
  { key: "parahelp_routing_sync", label: "Parahelp routing queue", description: "Pushes new customer domains to Parahelp email routing (API leg dormant until credentials exist; posts a pending digest to Slack).", maxStaleMin: 36 * 60, fn: "sync-parahelp-routing" },
  { key: "notion_registry_publish", label: "Notion domain page", description: "Mirrors the customer registry domain list to the Notion page Parahelp reads. Writes only when the domain set changed.", maxStaleMin: 36 * 60, fn: "publish-registry-notion" },
  { key: "reconcile-v3-open", label: "Transferred-out reconciliation", description: "Catches tickets that left the Enterprise Inbox and marks them transferred_out (hourly).", maxStaleMin: 180, fn: "reconcile-v3-open" },
  { key: "intercom_fields_sync", label: "Intercom field options", description: "Caches the allowed product area / ticket type values from Intercom so drift against the Hub lists is visible (daily).", maxStaleMin: 48 * 60, fn: "sync-intercom-fields" },
];

type Severity = "ok" | "degraded" | "warn" | "auth" | "error" | "unknown";

function severityFor(row: HealthRow | undefined, maxStaleMin: number): Severity {
  if (!row) return "unknown";
  if (row.last_status === "auth_error") return "auth";
  if (row.last_status === "error" && (row.consecutive_failures || 0) >= 2) return "error";
  // One failure since the last success: not broken yet, but the Action Center
  // counts any consecutive_failures > 0, so surface the same thing here.
  if ((row.consecutive_failures || 0) > 0) return "degraded";
  const lastOk = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  const ageMin = lastOk ? (Date.now() - lastOk) / 60000 : Infinity;
  if (ageMin > maxStaleMin) return "warn";
  return "ok";
}

const SEVERITY_META: Record<Severity, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  degraded: { label: "Last run failed", className: "bg-amber-100 text-amber-800 border-amber-200", Icon: AlertTriangle },
  ok: { label: "Healthy", className: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: CheckCircle2 },
  warn: { label: "Stale", className: "bg-amber-100 text-amber-800 border-amber-200", Icon: AlertTriangle },
  auth: { label: "Auth error", className: "bg-red-100 text-red-800 border-red-200", Icon: ShieldAlert },
  error: { label: "Failing", className: "bg-red-100 text-red-800 border-red-200", Icon: AlertTriangle },
  unknown: { label: "No data yet", className: "bg-muted text-muted-foreground border-border", Icon: Circle },
};

// The closed-won poller reports unhandled blank-domain companies with a fixed
// phrase. Pull the company names back out so each one can be dismissed
// individually (an acknowledgement row, not a registry change).
function blankDomainNames(lastError: string | null | undefined): string[] {
  if (!lastError) return [];
  const out: string[] = [];
  const re = /blank Company Domain for "([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lastError))) out.push(m[1]);
  return [...new Set(out)];
}

function toNameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export default function IntegrationHealthCard() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("integration_health").select("*");
    setRows((data || []) as HealthRow[]);
    setLoading(false);
  }

  async function sendTestAlert() {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("integration-health-alert", {
        body: { test: true },
      });
      if (error) throw error;
      if (data?.ok) {
        toast.success("Test alert posted to #enterprise-support-hub-alerts");
      } else {
        const slackErr = data?.slack?.error || "unknown error";
        toast.error(`Slack rejected the test alert: ${slackErr}`, {
          description: slackErr === "not_in_channel" ? "Invite @ask_lovable to the channel and try again." : undefined,
        });
      }
    } catch (e: any) {
      toast.error(`Failed to send test alert: ${e?.message || e}`);
    } finally {
      setTesting(false);
    }
  }

  async function runNow(fn: string, label: string) {
    setRunning(fn);
    try {
      const { error } = await supabase.functions.invoke(fn, { body: {} });
      if (error) throw error;
      toast.success(`${label} ran successfully`);
    } catch (e: any) {
      toast.error(`${label} failed: ${e?.message || e}`);
    } finally {
      setRunning(null);
      await load();
    }
  }

  // Records an acknowledgement ("this company is already covered by an existing
  // account") and re-runs the poller so the health card recomputes from real data
  // rather than being cleared cosmetically.
  async function dismissBlankDomain(name: string) {
    setDismissing(name);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("v3_closed_won_acknowledged_names").insert({
        name_key: toNameKey(name),
        display_name: name,
        note: "Dismissed from Integration health — already covered by an existing customer account",
        acknowledged_by: userData?.user?.id ?? null,
        acknowledged_by_email: userData?.user?.email ?? null,
      });
      if (error && error.code !== "23505") throw error;
      const { error: runErr } = await supabase.functions.invoke("poll-slack-closed-won", { body: {} });
      if (runErr) throw runErr;
      toast.success(`Dismissed "${name}"`);
    } catch (e: any) {
      toast.error(`Could not dismiss "${name}": ${e?.message || e}`);
    } finally {
      setDismissing(null);
      await load();
    }
  }



  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const byKey = new Map(rows.map((r) => [r.integration, r]));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-lg">Integration health</CardTitle>
          <CardDescription>
            Last successful sync per integration. Stale or failing checks usually mean a token needs to be re-pasted.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={sendTestAlert} disabled={testing} className="gap-1">
            <Send className={`h-3 w-3 ${testing ? "animate-pulse" : ""}`} />
            Send test alert
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {INTEGRATIONS.map((cfg) => {
          const row = byKey.get(cfg.key);
          const sev = severityFor(row, cfg.maxStaleMin);
          const meta = SEVERITY_META[sev];
          const Icon = meta.Icon;
          return (
            <div key={cfg.key} className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{cfg.label}</span>
                  <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{cfg.description}</p>
                {row?.last_status && row.last_status !== "ok" && row.last_error && (
                  <p className="mt-1 truncate text-xs text-red-700" title={row.last_error}>
                    {row.last_error}
                  </p>
                )}
                {cfg.key === "slack_closed_won_poll" && blankDomainNames(row?.last_error).length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Already handled?</span>
                    {blankDomainNames(row?.last_error).map((name) => (
                      <Button
                        key={name}
                        variant="outline"
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs"
                        disabled={dismissing === name}
                        onClick={() => dismissBlankDomain(name)}
                      >
                        <X className="h-3 w-3" />
                        {dismissing === name ? "Dismissing…" : `Dismiss "${name}"`}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 sm:justify-end">
              {cfg.fn && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => runNow(cfg.fn!, cfg.label)}
                  disabled={running === cfg.fn}
                >
                  <Play className={`h-3 w-3 ${running === cfg.fn ? "animate-pulse" : ""}`} />
                  {running === cfg.fn ? "Running…" : "Run now"}
                </Button>
              )}
              <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                {row?.last_success_at ? (
                  <>Last success {formatDistanceToNow(new Date(row.last_success_at), { addSuffix: true })}</>
                ) : (
                  <>No success recorded</>
                )}
                {row?.last_failure_at && (sev === "error" || sev === "auth" || sev === "warn" || sev === "degraded") && (
                  <div>Last failure {formatDistanceToNow(new Date(row.last_failure_at), { addSuffix: true })}</div>
                )}
              </div>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Auth errors typically mean the Intercom or Gmail token needs to be re-pasted. Stale = no successful sync within the expected window.
        </p>
      </CardContent>
    </Card>
  );
}
