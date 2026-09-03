import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Beaker, RefreshCw, Loader2, ScanLine, PlayCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { CLEAN_DATA_START_LABEL } from "@/pages/inbox-v3/constants";

type JobRow = {
  id: string;
  kind: "closed_backfill" | "open_refresh" | "gap_scan";
  status: "idle" | "running" | "done" | "error";
  cursor_ts: string | null;
  processed: number;
  inserted: number;
  updated_count: number;
  failed: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const KIND_LABEL: Record<JobRow["kind"], string> = {
  closed_backfill: "Closed sync",
  open_refresh: "Open refresh",
  gap_scan: "Gap scan",
};

export default function InboxV3SyncCard() {
  const [latest, setLatest] = useState<Record<string, JobRow | null>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const kinds: JobRow["kind"][] = ["closed_backfill", "open_refresh", "gap_scan"];
    const next: Record<string, JobRow | null> = {};
    for (const k of kinds) {
      const { data } = await supabase
        .from("intercom_sync_jobs_v3")
        .select("*")
        .eq("kind", k)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      next[k] = (data as JobRow) ?? null;
    }
    setLatest(next);
    const { count } = await supabase
      .from("intercom_tickets_v3")
      .select("id", { count: "exact", head: true });
    setTotalRows(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const invoke = async (
    fn: "sync-v3-closed" | "sync-v3-open" | "sync-v3-gap-scan" | "backfill-v3-responsiveness",
    body: Record<string, unknown> = {},
    label: string = fn,
  ) => {
    setRunning(fn);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      toast.success(`${label} complete`, {
        description: JSON.stringify({
          fetched: data?.fetched,
          inserted: data?.inserted,
          updated: data?.updated,
          failed: data?.failed,
          reopened: data?.reopened,
          discrepancies: data?.discrepancies?.length,
          // backfill-v3-responsiveness reports its own counters
          processed: data?.processed,
          written: data?.written,
          no_triage: data?.no_triage,
          no_human_reply: data?.no_human_reply,
          remaining: data?.remaining,
        }),
      });
      await load();
    } catch (e: any) {
      toast.error(`${label} failed`, { description: e?.message || "unknown" });
    } finally {
      setRunning(null);
    }
  };

  const catchUpClosed = async () => {
    setRunning("sync-v3-closed-loop");
    let total = { inserted: 0, updated: 0, reopened: 0, failed: 0, iters: 0 };
    try {
      for (let i = 0; i < 10; i++) {
        const { data, error } = await supabase.functions.invoke("sync-v3-closed", { body: {} });
        if (error) throw error;
        total.iters++;
        total.inserted += data?.inserted ?? 0;
        total.updated += data?.updated ?? 0;
        total.reopened += data?.reopened ?? 0;
        total.failed += data?.failed ?? 0;
        if (!data?.fetched || data.fetched === 0) break;
      }
      toast.success("Catch-up complete", {
        description: `${total.iters} iters · +${total.inserted} new · ${total.updated} updated · ${total.reopened} reopened · ${total.failed} failed`,
      });
      await load();
    } catch (e: any) {
      toast.error("Catch-up failed", { description: e?.message || "unknown" });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Beaker className="h-4 w-4" /> Inbox v3 sync
          <Badge variant="secondary" className="text-[10px]">Beta</Badge>
        </CardTitle>
        <CardDescription>
          Reporting-grade mirror of Intercom enterprise tickets. Data floor: {CLEAN_DATA_START_LABEL}.
          Closed tickets are synced once and frozen; open tickets get cheap freshness only.
          Parallel to v2 — does not affect Inbox v2 or Analytics v2.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Rows in v3: <strong className="text-foreground">{totalRows?.toLocaleString() ?? "—"}</strong></span>
          <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-7 px-2">
            <RefreshCw className={`h-3 w-3 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(["closed_backfill", "open_refresh", "gap_scan"] as const).map((k) => {
            const j = latest[k];
            return (
              <div key={k} className="rounded-md border border-border p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{KIND_LABEL[k]}</span>
                  <Badge variant={
                    j?.status === "done" ? "secondary" :
                    j?.status === "running" ? "default" :
                    j?.status === "error" ? "destructive" : "outline"
                  } className="text-[10px]">{j?.status ?? "—"}</Badge>
                </div>
                <div className="text-muted-foreground">
                  Last run: {j?.created_at ? formatDistanceToNow(new Date(j.created_at), { addSuffix: true }) : "never"}
                </div>
                <div className="text-muted-foreground">
                  Fetched {j?.processed ?? 0} · +{j?.inserted ?? 0} · upd {j?.updated_count ?? 0} · fail {j?.failed ?? 0}
                </div>
                {j?.cursor_ts && (
                  <div className="text-muted-foreground">Cursor: {new Date(j.cursor_ts).toISOString().slice(0, 16)}Z</div>
                )}
                {j?.last_error && (
                  <div className="text-destructive truncate" title={j.last_error}>Err: {j.last_error}</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={catchUpClosed} disabled={!!running}>
            {running === "sync-v3-closed-loop"
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
            Catch up closed
          </Button>
          <Button size="sm" variant="outline" onClick={() => invoke("sync-v3-closed", {}, "Closed sync")} disabled={!!running}>
            Run closed once
          </Button>
          <Button size="sm" variant="outline" onClick={() => invoke("sync-v3-open", { windowHours: 2 }, "Open refresh")} disabled={!!running}>
            Run open refresh
          </Button>
          <Button size="sm" variant="outline" onClick={() => invoke("sync-v3-gap-scan", { lookbackDays: 30 }, "Gap scan")} disabled={!!running}>
            {running === "sync-v3-gap-scan"
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <ScanLine className="h-3.5 w-3.5 mr-1.5" />}
            Run gap scan
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              invoke("backfill-v3-responsiveness", { batch: 200, maxBatches: 10 }, "Responsiveness backfill")
            }
            disabled={!!running}
          >
            {running === "backfill-v3-responsiveness"
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : null}
            Backfill responsiveness
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
