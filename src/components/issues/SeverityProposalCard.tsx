import { useCallback, useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, AlertTriangle, Check } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";
import { fetchLatestProposal, recordSeverityDecision, type SeverityProposal } from "@/lib/severityProposals";

/**
 * The AI's severity suggestion, shown ABOVE the human write control.
 *
 * It is a proposal and nothing else: the model never writes to Intercom. The
 * only path to Intercom is the same `esh-write-action` call the manual control
 * uses, fired by an explicit human click on Accept. A refused or failed write
 * leaves the proposal open — nothing is marked accepted on hope.
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

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40",
  low: "bg-muted text-muted-foreground border-border",
};

export function SeverityProposalCard({
  conversationId,
  onAccepted,
}: {
  conversationId: string;
  /** Fired only after Intercom accepted the severity written from the proposal. */
  onAccepted?: (severity: string) => void;
}) {
  const { canEdit } = useCanEdit();
  const [proposal, setProposal] = useState<SeverityProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "propose" | "accept">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setProposal(await fetchLatestProposal(conversationId));
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const propose = async (pass: "triage" | "reclassify") => {
    setBusy("propose");
    setError(null);
    setNote(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("propose-severity", {
        body: { ticketIds: [conversationId], pass },
      });
      if (fnError) {
        setError(await readError(fnError));
        return;
      }
      const first = (data as any)?.results?.[0];
      if (first && first.ok === false) {
        setError(String(first.error ?? "Proposal failed"));
        return;
      }
      if (first?.skipped === "unchanged") {
        setNote("Ticket unchanged since the last proposal — no model call was made.");
      }
      await load();
    } catch (e) {
      setError(await readError(e));
    } finally {
      setBusy(null);
    }
  };

  const accept = async () => {
    if (!proposal) return;
    setBusy("accept");
    setError(null);
    setNote(null);
    const severity = String(proposal.proposed_severity);
    try {
      const { error: fnError } = await supabase.functions.invoke("esh-write-action", {
        body: { conversationId, action: "set_severity", payload: { severity } },
      });
      if (fnError) {
        setError(await readError(fnError));
        return;
      }
      await recordSeverityDecision(conversationId, proposal.proposed_severity);
      await load();
      onAccepted?.(severity);
    } catch (e) {
      setError(await readError(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for an AI proposal…
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          AI severity proposal
        </div>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy !== null}
            onClick={() => propose(proposal ? "reclassify" : "triage")}
          >
            {busy === "propose" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : proposal ? (
              "Re-score with full thread"
            ) : (
              "Propose severity"
            )}
          </Button>
        )}
      </div>

      {!proposal && !error && (
        <p className="text-xs text-muted-foreground">
          No proposal yet for this ticket.
        </p>
      )}

      {proposal && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">Severity {proposal.proposed_severity}</Badge>
            <Badge variant="outline" className={`text-[10px] ${CONFIDENCE_STYLE[proposal.confidence] ?? ""}`}>
              {proposal.confidence} confidence
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {proposal.pass === "triage" ? "from limited info" : "re-scored with full thread"}
              {proposal.rubric_version ? ` · rubric v${proposal.rubric_version}` : ""}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
          {proposal.evidence && (
            <p className="text-[10px] text-muted-foreground italic border-l-2 border-border pl-2">
              {proposal.evidence}
            </p>
          )}

          {proposal.status === "proposed" && canEdit && (
            <Button size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={accept}>
              {busy === "accept" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                `Accept — write Severity ${proposal.proposed_severity}`
              )}
            </Button>
          )}

          {proposal.status === "accepted" && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Accepted — Severity {proposal.final_severity} written to Intercom.
            </p>
          )}
          {proposal.status === "overridden" && (
            <p className="text-xs text-muted-foreground">
              Overridden — the team set Severity {proposal.final_severity} instead. Recorded as a correction.
            </p>
          )}
          {proposal.status === "superseded" && (
            <p className="text-xs text-muted-foreground">Superseded by a newer proposal.</p>
          )}
        </>
      )}

      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span><span className="font-medium">Nothing changed. </span>{error}</span>
        </p>
      )}

      <p className="text-[10px] text-muted-foreground">
        The AI only proposes. Severity reaches Intercom exclusively through <code>esh-write-action</code>, on a human click.
      </p>
    </div>
  );
}
