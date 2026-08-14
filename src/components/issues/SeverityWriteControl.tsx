import { useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Check } from "lucide-react";

/**
 * Step 2 of the ESH write rollout: the first Hub-originated write surfaced in the UI.
 *
 * Everything goes through `esh-write-action` — never a direct Intercom call and
 * never a local write to an Intercom-owned column. A refusal (kill switch off,
 * action not allowlisted, caller not mapped to an Intercom admin) MUST be
 * visible here: no silent no-op, no optimistic update. The local row only moves
 * after the edge function reports that Intercom accepted and re-read the value.
 */

const SEVERITIES = ["1", "2", "3", "4"] as const;

type Outcome =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; severity: string; actor: string }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string };

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

export function SeverityWriteControl({
  conversationId,
  currentSeverity,
  onWritten,
}: {
  conversationId: string;
  /** Severity Intercom currently holds, or null when untriaged. */
  currentSeverity: string | null;
  /** Fired only after Intercom accepted and the mirror was updated. */
  onWritten?: (severity: string) => void;
}) {
  const [value, setValue] = useState<string>(currentSeverity ?? "");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const sending = outcome.kind === "sending";
  const dirty = value !== "" && value !== (currentSeverity ?? "");

  const submit = async () => {
    if (!dirty) return;
    setOutcome({ kind: "sending" });
    try {
      const { data, error } = await supabase.functions.invoke("esh-write-action", {
        body: { conversationId, action: "set_severity", payload: { severity: value } },
      });
      if (error) {
        const message = await readError(error);
        // The function marks every deliberate interlock refusal with `blocked`.
        // Anything else is a genuine failure (Intercom rejected, mirror update
        // failed, transport error) and is worded differently on purpose.
        const refused = /kill switch|allowlist|Unknown action|teammate|severity must be/i.test(message);
        setOutcome(refused ? { kind: "refused", message } : { kind: "failed", message });
        return;
      }
      const written = String((data as any)?.custom_attributes?.Severity ?? value);
      setOutcome({ kind: "ok", severity: written, actor: String((data as any)?.actor ?? "") });
      onWritten?.(written);
    } catch (e) {
      setOutcome({ kind: "failed", message: await readError(e) });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={(v) => { setValue(v); setOutcome({ kind: "idle" }); }} disabled={sending}>
          <SelectTrigger className="h-9 w-[150px] text-xs">
            <SelectValue placeholder="Set severity…" />
          </SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>Severity {s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={submit} disabled={!dirty || sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Write to Intercom"}
        </Button>
      </div>

      {outcome.kind === "ok" && (
        <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Intercom accepted Severity {outcome.severity}
          {outcome.actor ? ` as ${outcome.actor}` : ""}. The queue clears this ticket on the next refresh.
        </p>
      )}

      {(outcome.kind === "refused" || outcome.kind === "failed") && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">
              {outcome.kind === "refused" ? "Write refused — nothing changed. " : "Write failed — nothing changed. "}
            </span>
            {outcome.message}
          </span>
        </p>
      )}

      <p className="text-[10px] text-muted-foreground">
        Writes go through <code>esh-write-action</code>: Intercom first, then the Hub mirrors what Intercom returns.
      </p>
    </div>
  );
}
