import { useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { intercomUrl } from "@/lib/intercom";
import { useCanEdit } from "@/hooks/useCanEdit";
import { OVERRIDE_REASON_CODES } from "@/lib/severityProposals";

/**
 * The training-foundation surfaces for the severity classifier.
 *
 * Showdown  — score N tickets that already carry a human severity, cold, and
 *             adjudicate every disagreement. Deliberately kept OUT of
 *             severity_proposals so a backfill never masquerades as live triage.
 * Backtest  — re-score decided tickets against a rubric draft, so a rubric edit
 *             is measured instead of guessed.
 * Reasons   — which override reasons recur; a recurring one is a rubric gap.
 */

async function readError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const text = await error.context.text();
    try {
      const parsed = JSON.parse(text);
      return String(parsed.error ?? parsed.message ?? text);
    } catch {
      return text;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

const SEVS = [1, 2, 3, 4];

type Run = {
  id: string;
  label: string | null;
  pass: string;
  rubric_version: number | null;
  model: string | null;
  requested_n: number;
  scored_n: number;
  created_at: string;
};

type Item = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  human_severity: number | null;
  ai_severity: number | null;
  confidence: string | null;
  rationale: string | null;
  error: string | null;
  verdict: string;
  adjudication_note: string | null;
};

const VERDICTS: Array<{ key: string; label: string }> = [
  { key: "ai_wrong", label: "AI was wrong" },
  { key: "human_wrong", label: "The ticket was wrong" },
  { key: "both_defensible", label: "Both defensible" },
];

export function SeverityShowdown() {
  const { canEdit } = useCanEdit();
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [n, setN] = useState("10");
  const [pass, setPass] = useState("triage");

  const loadRuns = async () => {
    const { data } = await supabase
      .from("severity_eval_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);
    const list = (data ?? []) as Run[];
    setRuns(list);
    setRunId((cur) => cur || list[0]?.id || "");
    setLoading(false);
  };

  const loadItems = async (id: string) => {
    if (!id) {
      setItems([]);
      return;
    }
    const { data } = await supabase
      .from("severity_eval_items")
      .select("*")
      .eq("run_id", id)
      .order("created_at", { ascending: true });
    setItems((data ?? []) as Item[]);
  };

  useEffect(() => {
    void loadRuns();
  }, []);
  useEffect(() => {
    void loadItems(runId);
  }, [runId]);

  const start = async () => {
    setRunning(true);
    setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("run-severity-eval", {
        body: { n: Number(n), pass },
      });
      if (error) {
        setNote(await readError(error));
      } else {
        setNote(
          `Scored ${data.scored} of ${data.requested} tickets against rubric v${data.rubricVersion}${
            data.failed ? ` — ${data.failed} could not be scored.` : "."
          }`,
        );
        await loadRuns();
        setRunId(data.runId);
        await loadItems(data.runId);
      }
    } catch (e) {
      setNote(await readError(e));
    }
    setRunning(false);
  };

  const adjudicate = async (item: Item, verdict: string, adjNote?: string) => {
    const { data: userData } = await supabase.auth.getUser();
    await supabase
      .from("severity_eval_items")
      .update({
        verdict,
        adjudication_note: adjNote?.trim() ? adjNote.trim().slice(0, 500) : item.adjudication_note,
        adjudicated_by: userData.user?.id ?? null,
        adjudicated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, verdict } : i)));
  };

  const scored = items.filter((i) => i.ai_severity != null && i.human_severity != null);
  const agree = scored.filter((i) => i.ai_severity === i.human_severity).length;
  const disagreements = scored.filter((i) => i.ai_severity !== i.human_severity);
  const pending = disagreements.filter((i) => i.verdict === "pending").length;
  const agreementPct = scored.length ? Math.round((agree / scored.length) * 1000) / 10 : null;

  const matrix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of scored) m[`${i.ai_severity}-${i.human_severity}`] = (m[`${i.ai_severity}-${i.human_severity}`] ?? 0) + 1;
    return m;
  }, [scored]);

  return (
    <div className="rounded-md border border-border p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Showdown — AI vs. the severity already on the ticket</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Samples tickets that already carry a human severity in Intercom and scores them cold (no examples, rubric
            only). Nothing here is written to Intercom or counted as a live proposal.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select value={n} onValueChange={setN}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["10", "25", "50"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v} tickets
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={pass} onValueChange={setPass}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="triage">Triage pass</SelectItem>
                <SelectItem value="reclassify">Full thread</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs" onClick={start} disabled={running}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run showdown"}
            </Button>
          </div>
        )}
      </div>

      {note && <p className="text-xs text-muted-foreground">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Run</span>
        <Select value={runId} onValueChange={setRunId}>
          <SelectTrigger className="h-8 w-[340px] text-xs">
            <SelectValue placeholder={loading ? "Loading…" : "No runs yet"} />
          </SelectTrigger>
          <SelectContent>
            {runs.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {format(new Date(r.created_at), "d MMM HH:mm")} · {r.pass} · {r.scored_n}/{r.requested_n} · rubric v
                {r.rubric_version ?? "?"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scored.length === 0 ? (
        <p className="text-xs text-muted-foreground">No scored tickets in this run yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span>
              Agreement <span className="font-medium">{agreementPct}%</span>{" "}
              <span className="text-muted-foreground">({agree}/{scored.length})</span>
            </span>
            <span className="text-muted-foreground">Sample size {scored.length}</span>
            {pending > 0 && (
              <Badge variant="outline" className="text-[10px]">
                UNVERIFIED — {pending} disagreement{pending > 1 ? "s" : ""} not yet adjudicated
              </Badge>
            )}
          </div>

          <table className="text-xs">
            <thead>
              <tr>
                <th className="p-2 text-left text-muted-foreground font-normal">AI \ ticket</th>
                {SEVS.map((s) => (
                  <th key={s} className="p-2 w-14 text-muted-foreground font-normal">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SEVS.map((a) => (
                <tr key={a}>
                  <td className="p-2 text-muted-foreground">Severity {a}</td>
                  {SEVS.map((h) => {
                    const v = matrix[`${a}-${h}`] ?? 0;
                    return (
                      <td
                        key={h}
                        className={`p-2 text-center rounded ${
                          v === 0
                            ? "text-muted-foreground"
                            : a === h
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium"
                              : "bg-destructive/10 text-destructive font-medium"
                        }`}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-2">
            <h3 className="text-xs font-medium">Disagreements ({disagreements.length})</h3>
            {disagreements.length === 0 && <p className="text-xs text-muted-foreground">None in this run.</p>}
            {disagreements.map((i) => (
              <DisagreementRow key={i.id} item={i} canEdit={canEdit} onAdjudicate={adjudicate} />
            ))}
          </div>
        </>
      )}

      {items.some((i) => i.error) && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {items.filter((i) => i.error).length} ticket(s) in this run could not be scored.
        </p>
      )}
    </div>
  );
}

function DisagreementRow({
  item,
  canEdit,
  onAdjudicate,
}: {
  item: Item;
  canEdit: boolean;
  onAdjudicate: (item: Item, verdict: string, note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <a
          href={intercomUrl(item.intercom_conversation_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          {item.intercom_conversation_id}
          <ExternalLink className="h-3 w-3" />
        </a>
        <span className="text-muted-foreground truncate max-w-[420px]">{item.subject ?? "—"}</span>
        <Badge variant="outline" className="text-[10px]">AI {item.ai_severity}</Badge>
        <Badge variant="outline" className="text-[10px]">Ticket {item.human_severity}</Badge>
        {item.confidence && <span className="text-[10px] text-muted-foreground">{item.confidence} confidence</span>}
        {item.verdict !== "pending" && (
          <Badge className="text-[10px]">{VERDICTS.find((v) => v.key === item.verdict)?.label ?? item.verdict}</Badge>
        )}
      </div>
      {item.rationale && <p className="text-xs text-muted-foreground">{item.rationale}</p>}
      {canEdit && item.verdict === "pending" && (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note on why"
            className="text-xs min-h-[44px]"
          />
          <div className="flex flex-wrap gap-2">
            {VERDICTS.map((v) => (
              <Button
                key={v.key}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onAdjudicate(item, v.key, note)}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SeverityBacktest({ rubricBody }: { rubricBody: string }) {
  const { canEdit } = useCanEdit();
  const [n, setN] = useState("25");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setBusy(true);
    setNote(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("backtest-severity", {
        body: { n: Number(n), rubricBody },
      });
      if (error) setNote(await readError(error));
      else setResult(data);
    } catch (e) {
      setNote(await readError(e));
    }
    setBusy(false);
  };

  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Backtest the rubric draft</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Re-scores tickets you have already decided, plus showdown tickets whose human severity still stands —
            including ones the AI already got right, so a rubric edit that breaks them shows up as a regression.
            Costs one model call per ticket. Nothing is saved.
          </p>

        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select value={n} onValueChange={setN}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["10", "25", "50"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v} cases
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs" onClick={run} disabled={busy || !rubricBody.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Backtest"}
            </Button>
          </div>
        )}
      </div>

      {note && <p className="text-xs text-destructive">{note}</p>}

      {result && (
        <div className="space-y-2">
          <p className="text-xs">
            Exact match <span className="font-medium">{result.agreementPct ?? "—"}%</span>{" "}
            <span className="text-muted-foreground">
              ({result.exactMatch}/{result.scored}) · off by 1: {result.offByOne} · off by 2+: {result.offByTwoPlus}
            </span>
          </p>
          {result.scored < 30 && (
            <Badge variant="outline" className="text-[10px]">
              UNVERIFIED — {result.scored} cases is a small sample; treat the number as directional
            </Badge>
          )}
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="p-1.5 text-left font-normal">Ticket</th>
                  <th className="p-1.5 text-left font-normal">Source</th>
                  <th className="p-1.5 text-left font-normal">Human</th>
                  <th className="p-1.5 text-left font-normal">Draft rubric</th>
                </tr>
              </thead>
              <tbody>
                {(result.results ?? []).map((r: any) => (
                  <tr key={r.id} className={r.ai != null && r.ai !== r.human ? "text-destructive" : ""}>
                    <td className="p-1.5">
                      <a href={intercomUrl(r.id)} target="_blank" rel="noreferrer" className="underline">
                        {r.id}
                      </a>
                    </td>
                    <td className="p-1.5 text-muted-foreground">{r.source}</td>
                    <td className="p-1.5">{r.human}</td>
                    <td className="p-1.5">{r.ai ?? r.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function OverrideReasonRollup() {
  const [rows, setRows] = useState<Array<{ reason_code: string; occurrences: number; last_seen: string | null }>>([]);

  useEffect(() => {
    supabase.rpc("severity_override_reason_rollup").then(({ data }) => setRows((data ?? []) as any));
  }, []);

  const labelFor = (code: string) =>
    OVERRIDE_REASON_CODES.find((r) => r.code === code)?.label ?? code;

  return (
    <div className="rounded-md border border-border p-4 space-y-2">
      <h2 className="text-sm font-medium">Why we overrode the AI (last 90 days)</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No overrides recorded yet.</p>
      ) : (
        <table className="text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="p-1.5 text-left font-normal">Reason</th>
              <th className="p-1.5 text-left font-normal">Times</th>
              <th className="p-1.5 text-left font-normal">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reason_code}>
                <td className="p-1.5">{labelFor(r.reason_code)}</td>
                <td className="p-1.5">{r.occurrences}</td>
                <td className="p-1.5 text-muted-foreground">
                  {r.last_seen ? format(new Date(r.last_seen), "d MMM yyyy") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[10px] text-muted-foreground">
        A reason that keeps recurring is a rubric gap — draft a line for it, then backtest before publishing.
      </p>
    </div>
  );
}
