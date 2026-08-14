import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useActionSignals, type SignalState } from "@/hooks/useActionSignals";
import { FAMILY_LABEL, type SignalFamily } from "@/lib/actionSignals";

const FAMILY_ORDER: SignalFamily[] = ["queues", "sla", "pipeline", "review"];

function SignalCard({ state, onGo }: { state: SignalState; onGo: (to: string) => void }) {
  const { signal, status, reading, error } = state;
  const count = reading?.count ?? 0;
  const active = status === "ok" && count > 0;
  const isError = status === "error";

  const border = isError
    ? "border-destructive/50 bg-destructive/5"
    : active
      ? "border-amber-500/50 bg-amber-500/5"
      : "border-border";

  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-2 ${border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{signal.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{FAMILY_LABEL[signal.family]}</div>
        </div>
        <div className="shrink-0 text-right">
          {status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {isError && <AlertTriangle className="h-5 w-5 text-destructive" />}
          {status === "ok" && (
            <span
              className={`text-2xl font-semibold tabular-nums ${active ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
            >
              {count}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-snug">{signal.meaning}</p>

      {isError && (
        <p className="text-xs text-destructive break-words">
          Could not read this signal — treat it as unknown, not clear. {error}
        </p>
      )}

      {status === "ok" && (
        <div className="text-xs text-muted-foreground">
          {active ? (
            <>
              {reading?.oldestAt
                ? `oldest ${formatDistanceToNowStrict(new Date(reading.oldestAt))}`
                : "waiting"}
              {reading?.detail ? ` · ${reading.detail}` : ""}
            </>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> clear
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-2">
        <Button variant={active ? "default" : "outline"} size="sm" onClick={() => onGo(signal.route)}>
          {signal.routeLabel}
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    </div>
  );
}

export default function ActionCenter() {
  const navigate = useNavigate();
  const { states, attentionCount, errorCount, loading, lastLoadedAt, refresh } = useActionSignals();

  const grouped = useMemo(() => {
    const active = states.filter((s) => s.status === "error" || (s.reading?.count ?? 0) > 0);
    const quiet = states.filter((s) => !(s.status === "error" || (s.reading?.count ?? 0) > 0));
    return { active, quiet };
  }, [states]);

  const byFamily = (list: SignalState[]) =>
    FAMILY_ORDER.map((f) => ({ family: f, items: list.filter((s) => s.signal.family === f) })).filter(
      (g) => g.items.length > 0,
    );

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Bell className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Action center</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {states.length} signals watched · {attentionCount} need attention
              {errorCount > 0 ? ` · ${errorCount} unreadable` : ""}
              {lastLoadedAt ? ` · updated ${formatDistanceToNowStrict(new Date(lastLoadedAt))} ago` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {!loading && attentionCount === 0 && errorCount === 0 && (
          <div className="rounded-lg border border-border p-6 flex items-center gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Nothing is waiting — every watched queue is empty and every pipeline is healthy.
          </div>
        )}

        {grouped.active.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Needs attention
              </h2>
              <Badge variant="secondary">{grouped.active.length}</Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {grouped.active.map((s) => (
                <SignalCard key={s.signal.id} state={s} onGo={navigate} />
              ))}
            </div>
          </section>
        )}

        {byFamily(grouped.quiet).map((g) => (
          <section key={g.family} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {FAMILY_LABEL[g.family]}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {g.items.map((s) => (
                <SignalCard key={s.signal.id} state={s} onGo={navigate} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppLayout>
  );
}
