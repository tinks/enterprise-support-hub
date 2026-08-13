// Parahelp routing queue — step 2 of the closed-won automation.
// Rows are enqueued by a DB trigger on v3_customer_accounts (any newly added
// domain, from the closed-won poller or a manual registry edit). The push
// worker `sync-parahelp-routing` handles the API leg when credentials exist;
// this panel is the manual working path in the meantime.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { RefreshCw, Check, RotateCcw, MailCheck } from "lucide-react";

const sb = supabase as any;

type RoutingRow = {
  id: string;
  domain: string;
  account_key: string | null;
  source: string;
  state: "pending" | "pushed" | "manual_done" | "failed" | "skipped";
  attempts: number;
  last_error: string | null;
  pushed_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

const STATE_LABEL: Record<RoutingRow["state"], string> = {
  pending: "Pending",
  pushed: "Pushed via API",
  manual_done: "Routed manually",
  failed: "Failed",
  skipped: "Pre-existing",
};

export default function ParahelpRoutingTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<RoutingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb
      .from("parahelp_routing_sync")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error(`Load failed: ${error.message}`);
    setRows((data ?? []) as RoutingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useMemo(
    () => rows.filter((r) => r.state === "pending" || r.state === "failed"),
    [rows],
  );
  const done = useMemo(
    () => rows.filter((r) => r.state !== "pending" && r.state !== "failed"),
    [rows],
  );

  async function markDone(row: RoutingRow) {
    if (!isAdmin) return;
    setBusy(row.id);
    const { data: userRes } = await supabase.auth.getUser();
    const who = userRes?.user?.email ?? "unknown";
    const { error } = await sb
      .from("parahelp_routing_sync")
      .update({
        state: "manual_done",
        completed_by: who,
        completed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", row.id);
    setBusy(null);
    if (error) {
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    toast.success(`${row.domain} marked as routed`);
    void load();
  }

  async function retry(row: RoutingRow) {
    if (!isAdmin) return;
    setBusy(row.id);
    const { error } = await sb
      .from("parahelp_routing_sync")
      .update({ state: "pending", attempts: 0, last_error: null })
      .eq("id", row.id);
    setBusy(null);
    if (error) {
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    toast.success(`${row.domain} queued for retry`);
    void load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MailCheck className="h-5 w-5" /> Parahelp routing queue
            </CardTitle>
            <CardDescription>
              Domains added to the customer registry that still need email routing in Parahelp so
              mail to enterprise-support@lovable.dev lands in the Enterprise inbox. Rows are
              enqueued automatically — by the closed-won poller and by manual registry edits alike.
              Registry updates never wait on this queue.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 text-sm mb-4">
            <div>
              <div className="text-muted-foreground">Awaiting routing</div>
              <div className="text-2xl font-semibold">{open.length}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Failed pushes</div>
              <div className="text-2xl font-semibold">
                {rows.filter((r) => r.state === "failed").length}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Completed</div>
              <div className="text-2xl font-semibold">{done.length}</div>
            </div>
          </div>

          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing awaiting routing. New registry domains will appear here automatically.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left w-[220px]">Domain</TableHead>
                  <TableHead className="text-left w-[180px]">Account</TableHead>
                  <TableHead className="text-left w-[140px]">Source</TableHead>
                  <TableHead className="text-left w-[120px]">State</TableHead>
                  <TableHead className="text-left">Last error</TableHead>
                  <TableHead className="text-left w-[100px]">Age</TableHead>
                  <TableHead className="text-left w-[200px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {open.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.domain}</TableCell>
                    <TableCell className="text-xs">{r.account_key ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.source}</TableCell>
                    <TableCell>
                      <Badge variant={r.state === "failed" ? "destructive" : "secondary"}>
                        {STATE_LABEL[r.state]}
                        {r.attempts > 0 ? ` · ${r.attempts}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate">
                      {r.last_error ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDistanceToNowStrict(new Date(r.created_at))}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!isAdmin || busy === r.id}
                          onClick={() => void markDone(r)}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" /> Mark as routed
                        </Button>
                        {r.state === "failed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!isAdmin || busy === r.id}
                            onClick={() => void retry(r)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-3">
              Read-only — admin rights are required to change queue state.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Completed ({done.length})</CardTitle>
            <CardDescription>
              Pushed via API, marked routed by hand, or pre-existing at queue creation.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide" : "Show"}
          </Button>
        </CardHeader>
        {showDone && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left w-[220px]">Domain</TableHead>
                  <TableHead className="text-left w-[180px]">Account</TableHead>
                  <TableHead className="text-left w-[160px]">State</TableHead>
                  <TableHead className="text-left w-[200px]">By</TableHead>
                  <TableHead className="text-left w-[140px]">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {done.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.domain}</TableCell>
                    <TableCell className="text-xs">{r.account_key ?? "—"}</TableCell>
                    <TableCell className="text-xs">{STATE_LABEL[r.state]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.completed_by ?? (r.state === "pushed" ? "sync-parahelp-routing" : "—")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.completed_at || r.pushed_at
                        ? formatDistanceToNowStrict(new Date((r.completed_at ?? r.pushed_at)!), {
                            addSuffix: true,
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
