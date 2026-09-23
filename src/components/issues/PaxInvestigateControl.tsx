import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, Check, ExternalLink, Bot, FileEdit } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";
import { SlackConnectControl, useSlackConnection } from "./SlackConnectControl";
import { HumanInfoReviewPanel } from "./HumanInfoReviewPanel";
import { assembleHumanInfo, type Extraction, type ReviewState } from "@/lib/humanInfo";

/**
 * "Ask Pax to investigate" — the one place the Hub starts a bot investigation.
 *
 * Contract (deliberately narrow):
 *  - posts ONE Slack request per ticket, ever (the edge function is idempotent
 *    on the conversation id — a repeat click returns the existing thread)
 *  - writes ONE Intercom INTERNAL NOTE carrying the Slack thread link; never a
 *    customer-facing reply, never a ticket field
 *  - a partial failure (Slack posted, note failed) is shown, not repaired
 *    silently: the operator gets an explicit "Retry link" action which only
 *    re-attempts the note.
 */

type Investigation = {
  intercom_conversation_id: string;
  slack_permalink: string | null;
  slack_thread_ts: string;
  note_state: "pending" | "linked" | "failed";
  note_error: string | null;
  requested_by_name: string | null;
  created_at: string;
};

async function readError(error: unknown): Promise<{ message: string; blocked: boolean }> {
  if (error instanceof FunctionsHttpError) {
    const text = await error.context.text();
    try {
      const parsed = JSON.parse(text);
      return { message: String(parsed.error ?? parsed.message ?? text), blocked: parsed.blocked === true };
    } catch {
      return { message: text, blocked: false };
    }
  }
  return { message: error instanceof Error ? error.message : String(error), blocked: false };
}

export function PaxInvestigateControl({ conversationId }: { conversationId: string }) {
  const { canEdit, isLoading: roleLoading } = useCanEdit();
  const { status: slackStatus, loading: slackLoading, refresh: refreshSlack } = useSlackConnection();
  const [inv, setInv] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractFailed, setExtractFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data } = await supabase
        .from("pax_investigations")
        .select("*")
        .eq("intercom_conversation_id", conversationId)
        .maybeSingle();
      if (!cancelled) {
        setInv((data as unknown as Investigation) ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  const run = async (mode: "start" | "retry_note", humanInfoBlock?: string) => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("ask-pax-investigate", {
        body: { conversationId, mode, ...(humanInfoBlock ? { humanInfoBlock } : {}) },
      });
      if (fnError) {
        const { message } = await readError(fnError);
        setError(message);
        // A note failure still returns the investigation row; refresh from the DB
        // so the retry action appears.
        const { data: row } = await supabase
          .from("pax_investigations")
          .select("*")
          .eq("intercom_conversation_id", conversationId)
          .maybeSingle();
        setInv((row as unknown as Investigation) ?? null);
        return;
      }
      setInv(((data as any)?.investigation as Investigation) ?? null);
      setExtraction(null);
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    setExtracting(true);
    setError(null);
    setExtractFailed(false);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("extract-human-info", {
        body: { conversation_id: conversationId },
      });
      if (fnError) {
        const { message } = await readError(fnError);
        setError(`Human Info extraction failed: ${message}`);
        setExtractFailed(true);
        return;
      }
      setExtraction((data as any)?.extraction as Extraction);
    } finally {
      setExtracting(false);
    }
  };

  const submitReviewed = async (s: ReviewState) => {
    let block: string;
    try {
      const { data: u } = await supabase.auth.getUser();
      block = assembleHumanInfo(s, extraction!, u.user?.email ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    await run("start", block);
  };

  if (loading) {
    return <p className="text-xs text-muted-foreground">Checking Pax investigation…</p>;
  }

  if (!roleLoading && !canEdit) {
    return (
      <p className="text-xs text-muted-foreground">
        {inv ? "Pax was already asked to investigate this ticket." : "Read-only account — editor role required."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!slackLoading && slackStatus && !slackStatus.connected ? (
        <SlackConnectControl status={slackStatus} onChanged={refreshSlack} />
      ) : null}

      {!inv && extraction ? (
        <HumanInfoReviewPanel
          extraction={extraction}
          busy={busy}
          onCancel={() => setExtraction(null)}
          onSubmit={(s) => void submitReviewed(s)}
        />
      ) : !inv ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void run("start")}
            disabled={busy || extracting || slackLoading || !slackStatus?.connected}
            title={!slackStatus?.connected ? "Connect your Slack account first" : "Starts a Pax investigation in #pax-ets-help"}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Bot className="h-4 w-4 mr-1" />}
            Ask Pax to investigate
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void prepare()}
            disabled={extracting || busy || slackLoading || !slackStatus?.connected}
            title={!slackStatus?.connected ? "Connect your Slack account first" : "AI drafts a Human Info block for you to review before it goes to Dev"}
          >
            {extracting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileEdit className="h-4 w-4 mr-1" />}
            {extracting ? "Drafting…" : "Draft Dev Escalation"}
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {inv.slack_permalink ? (
              <a
                href={inv.slack_permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                Open Pax thread in Slack <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-muted-foreground">Slack thread ts {inv.slack_thread_ts}</span>
            )}
            <span className="text-muted-foreground">
              · asked by {inv.requested_by_name ?? "—"}
            </span>
          </div>

          {inv.note_state === "linked" ? (
            <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Linked into Intercom as an internal note.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">Link to Intercom failed. </span>
                  Pax was asked in Slack, but the internal note was not written.
                  {inv.note_error ? ` ${inv.note_error}` : ""}
                </span>
              </p>
              <Button size="sm" variant="outline" onClick={() => run("retry_note")} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Retry link
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {slackStatus?.connected && (
        <SlackConnectControl status={slackStatus} onChanged={refreshSlack} compact />
      )}

      <p className="text-[10px] text-muted-foreground">
        Posts one request in #pax-ets-help as you and adds an internal note only — never a customer-facing reply.
      </p>
    </div>
  );
}
