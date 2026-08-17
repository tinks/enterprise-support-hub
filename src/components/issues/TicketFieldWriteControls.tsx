import { useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Check, RotateCw } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";

/**
 * Step 3 of the ESH write rollout: owner and product area.
 *
 * Same contract as SeverityWriteControl — everything goes through
 * `esh-write-action`, never a direct Intercom call and never a local write to an
 * Intercom-owned column. Step 3 adds a third refusal shape: the ticket moved in
 * Intercom since this page loaded (409 / `stale`). That one is worded
 * differently because the operator's next action differs — reload, don't retry.
 */

type Outcome =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; value: string; actor: string }
  | { kind: "stale"; message: string }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string };

async function readError(error: unknown): Promise<{ message: string; stale: boolean }> {
  if (error instanceof FunctionsHttpError) {
    const text = await error.context.text();
    try {
      const parsed = JSON.parse(text);
      return {
        message: String(parsed.error ?? parsed.message ?? text),
        stale: parsed.stale === true,
      };
    } catch {
      return { message: text, stale: false };
    }
  }
  return { message: error instanceof Error ? error.message : String(error), stale: false };
}

function Outcomes({ outcome, noun }: { outcome: Outcome; noun: string }) {
  if (outcome.kind === "ok") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        Intercom accepted {noun} {outcome.value}
        {outcome.actor ? ` as ${outcome.actor}` : ""}.
      </p>
    );
  }
  if (outcome.kind === "stale") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <RotateCw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">Write refused — the ticket moved. </span>
          {outcome.message}
        </span>
      </p>
    );
  }
  if (outcome.kind === "refused" || outcome.kind === "failed") {
    return (
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">
            {outcome.kind === "refused" ? "Write refused — nothing changed. " : "Write failed — nothing changed. "}
          </span>
          {outcome.message}
        </span>
      </p>
    );
  }
  return null;
}

const REFUSAL_RE = /kill switch|allowlist|Unknown action|teammate|must be one of|is required|no handler/i;

function useWriter() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const send = async (
    body: Record<string, unknown>,
    onOk: (data: any) => { value: string },
  ) => {
    setOutcome({ kind: "sending" });
    try {
      const { data, error } = await supabase.functions.invoke("esh-write-action", { body });
      if (error) {
        const { message, stale } = await readError(error);
        if (stale) setOutcome({ kind: "stale", message });
        else setOutcome(REFUSAL_RE.test(message) ? { kind: "refused", message } : { kind: "failed", message });
        return null;
      }
      const { value } = onOk(data);
      setOutcome({ kind: "ok", value, actor: String((data as any)?.actor ?? "") });
      return data;
    } catch (e) {
      const { message } = await readError(e);
      setOutcome({ kind: "failed", message });
      return null;
    }
  };

  return { outcome, setOutcome, send };
}

function Footnote() {
  return (
    <p className="text-[10px] text-muted-foreground">
      Writes go through <code>esh-write-action</code>: Intercom first, then the Hub mirrors what Intercom returns.
    </p>
  );
}

/** Owner = a real Intercom assignment, not a label. */
export function OwnerWriteControl({
  conversationId,
  currentOwner,
  onWritten,
}: {
  conversationId: string;
  /** Owner the Hub currently mirrors, or null when unassigned. Sent as expectedCurrent. */
  currentOwner: string | null;
  onWritten?: (owner: string | null) => void;
}) {
  const { canEdit, isLoading: roleLoading } = useCanEdit();
  const { outcome, setOutcome, send } = useWriter();
  const [value, setValue] = useState<string>(currentOwner ?? "");
  const [teammates, setTeammates] = useState<{ name: string }[]>([]);

  useEffect(() => {
    supabase
      .from("teammates")
      .select("name, intercom_admin_id, active")
      .eq("active", true)
      .order("name")
      .then(({ data }) =>
        setTeammates((data ?? []).filter((t) => t.intercom_admin_id).map((t) => ({ name: t.name }))),
      );
  }, []);

  const sending = outcome.kind === "sending";
  const dirty = value !== "" && value !== (currentOwner ?? "");

  if (!roleLoading && !canEdit) {
    return (
      <p className="text-xs text-muted-foreground">
        Owner {currentOwner ?? "unassigned"} — read-only account, editor role required to write to Intercom.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={(v) => { setValue(v); setOutcome({ kind: "idle" }); }} disabled={sending}>
          <SelectTrigger className="h-9 w-[180px] text-xs">
            <SelectValue placeholder="Assign owner…" />
          </SelectTrigger>
          <SelectContent>
            {teammates.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!dirty || sending}
          onClick={async () => {
            const data = await send(
              {
                conversationId,
                action: "set_owner",
                payload: { teammateName: value, expectedCurrent: currentOwner ?? null },
              },
              (d) => ({ value: String(d?.owner ?? value) }),
            );
            if (data) onWritten?.((data as any)?.owner ?? value);
          }}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign in Intercom"}
        </Button>
      </div>
      <Outcomes outcome={outcome} noun="owner" />
      <Footnote />
    </div>
  );
}

/** Product area = the `Affected Product Area` custom attribute the v3 sync reads. */
export function ProductAreaWriteControl({
  conversationId,
  currentProductArea,
  onWritten,
}: {
  conversationId: string;
  currentProductArea: string | null;
  onWritten?: (productArea: string | null) => void;
}) {
  const { canEdit, isLoading: roleLoading } = useCanEdit();
  const { outcome, setOutcome, send } = useWriter();
  const [value, setValue] = useState<string>(currentProductArea ?? "");
  const [areas, setAreas] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("settings")
      .select("product_areas")
      .limit(1)
      .maybeSingle()
      .then(({ data }) =>
        setAreas(
          String(data?.product_areas ?? "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
  }, []);

  const sending = outcome.kind === "sending";
  const dirty = value !== "" && value !== (currentProductArea ?? "");

  if (!roleLoading && !canEdit) {
    return (
      <p className="text-xs text-muted-foreground">
        Product area {currentProductArea ?? "not set"} — read-only account, editor role required to write to Intercom.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={(v) => { setValue(v); setOutcome({ kind: "idle" }); }} disabled={sending}>
          <SelectTrigger className="h-9 w-[220px] text-xs">
            <SelectValue placeholder="Set product area…" />
          </SelectTrigger>
          <SelectContent>
            {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!dirty || sending}
          onClick={async () => {
            const data = await send(
              {
                conversationId,
                action: "set_product_area",
                payload: { productArea: value, expectedCurrent: currentProductArea ?? null },
              },
              (d) => ({ value: String(d?.product_area ?? value) }),
            );
            if (data) onWritten?.((data as any)?.product_area ?? value);
          }}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Write to Intercom"}
        </Button>
      </div>
      <Outcomes outcome={outcome} noun="product area" />
      <Footnote />
    </div>
  );
}
