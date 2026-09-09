import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useActionSignals, type SignalState } from "@/lib/actionSignalsContext";
import { FAMILY_LABEL, type SignalFamily } from "@/lib/actionSignals";

const FAMILY_ORDER: SignalFamily[] = ["queues", "sla", "pipeline", "review"];

function SignalCard({
  state,
  onGo,
  onToggleMute,
}: {
  state: SignalState;
  onGo: (to: string) => void;
  onToggleMute: (id: string) => void;
}) {
  const { signal, status, reading, error, muted } = state;
  const count = reading?.count ?? 0;
  const active = status === "ok" && count > 0 && !muted;
  const isError = status === "error" && !muted;

  const border = muted
    ? "border-border bg-muted/30 opacity-70"
    : isError
      ? "border-destructive/50 bg-destructive/5"
      : active
        ? "border-amber-500/50 bg-amber-500/5"
        : "border-border";

  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-2 ${border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{signal.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {FAMILY_LABEL[signal.family]}
            {muted ? " · muted" : ""}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {status === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {status === "error" && (
            <AlertTriangle className={`h-5 w-5 ${muted ? "text-muted-foreground" : "text-destructive"}`} />
          )}
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

      {status === "ok" && active && (reading?.items?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Tickets ({reading!.items!.length}
            {reading!.items!.length < count ? ` of ${count}` : ""})
          </div>
          <div className="flex flex-wrap gap-1">
            {reading!.items!.map((it) => (
              <a
                key={it.id}
                href={
                  it.intercomId
                    ? `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${it.intercomId}`
                    : undefined
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                title={it.label ?? it.id}
              >
                {it.label ?? it.intercomId ?? it.id}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-2 flex items-center justify-between gap-2">
        <Button variant={active ? "default" : "outline"} size="sm" onClick={() => onGo(signal.route)}>
          {signal.routeLabel}
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`mute-${signal.id}`} className="text-[11px] text-muted-foreground">
            Alert
          </Label>
          <Switch
            id={`mute-${signal.id}`}
            checked={!muted}
            onCheckedChange={() => onToggleMute(signal.id)}
            aria-label={muted ? `Unmute ${signal.label}` : `Mute ${signal.label}`}
          />
        </div>
      </div>
    </div>
  );
}

export default function ActionCenter() {
  const navigate = useNavigate();
  const { states, attentionCount, errorCount, loading, lastLoadedAt, refresh, toggleMuted } =
    useActionSignals();

  const grouped = useMemo(() => {
    const isActive = (s: SignalState) =>
      !s.muted && (s.status === "error" || (s.reading?.count ?? 0) > 0);
    return { active: states.filter(isActive), quiet: states.filter((s) => !isActive(s)) };
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
              {states.length} signals watched · {attentionCount} need attention{states.filter((s) => s.muted).length > 0 ? ` · ${states.filter((s) => s.muted).length} muted` : ""}
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
                <SignalCard key={s.signal.id} state={s} onGo={navigate} onToggleMute={toggleMuted} />
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
                <SignalCard key={s.signal.id} state={s} onGo={navigate} onToggleMute={toggleMuted} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppLayout>
  );
}
