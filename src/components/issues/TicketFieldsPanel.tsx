import { useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Check, RotateCw } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";

/**
 * One panel, one Update button.
 *
 * Replaces the per-field write buttons. Contract is unchanged from the single
 * controls: every field still goes through `esh-write-action` (Intercom first,
 * Hub mirrors what Intercom returns), nothing is written optimistically, and a
 * refusal stays visible per field. Only CHANGED fields are sent; each field is
 * a separate call, run in sequence, and a failure on one does not cancel the
 * others — the result line names exactly which ones landed.
 */

type FieldKey = "severity" | "owner" | "product_area" | "ticket_type";

const FIELD_LABEL: Record<FieldKey, string> = {
  severity: "Severity",
  owner: "Owner",
  product_area: "Product area",
  ticket_type: "Ticket type",
};

const ACTION: Record<FieldKey, string> = {
  severity: "set_severity",
  owner: "set_owner",
  product_area: "set_product_area",
  ticket_type: "set_classification",
};

const REFUSAL_RE = /kill switch|allowlist|Unknown action|teammate|must be one of|is required|no handler|severity must be/i;

type FieldResult = {
  field: FieldKey;
  kind: "ok" | "stale" | "refused" | "failed";
  message: string;
};

async function readError(error: unknown): Promise<{ message: string; stale: boolean }> {
  if (error instanceof FunctionsHttpError) {
    const text = await error.context.text();
    try {
      const parsed = JSON.parse(text);
      return { message: String(parsed.error ?? parsed.message ?? text), stale: parsed.stale === true };
    } catch {
      return { message: text, stale: false };
    }
  }
  return { message: error instanceof Error ? error.message : String(error), stale: false };
}

export type TicketFieldsPanelProps = {
  conversationId: string;
  /** What the Hub currently mirrors. Each is sent as `expectedCurrent` for conflict checking. */
  currentSeverity?: string | null;
  currentOwner?: string | null;
  currentProductArea?: string | null;
  currentTicketType?: string | null;
  /** Hide a field entirely (e.g. a surface that does not own severity). */
  show?: Partial<Record<FieldKey, boolean>>;
  /** Fired per field, only after Intercom accepted that field. */
  onWritten?: (field: FieldKey, value: string) => void;
};

export function TicketFieldsPanel({
  conversationId,
  currentSeverity = null,
  currentOwner = null,
  currentProductArea = null,
  currentTicketType = null,
  show,
  onWritten,
}: TicketFieldsPanelProps) {
  const { canEdit, isLoading: roleLoading } = useCanEdit();

  const visible = useMemo(
    () => ({
      severity: show?.severity ?? true,
      owner: show?.owner ?? true,
      product_area: show?.product_area ?? true,
      ticket_type: show?.ticket_type ?? true,
    }),
    [show],
  );

  const [current, setCurrent] = useState<Record<FieldKey, string | null>>({
    severity: currentSeverity,
    owner: currentOwner,
    product_area: currentProductArea,
    ticket_type: currentTicketType,
  });
  const [draft, setDraft] = useState<Record<FieldKey, string>>({
    severity: "",
    owner: "",
    product_area: "",
    ticket_type: "",
  });
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<FieldResult[]>([]);

  // A different ticket means a fresh panel.
  useEffect(() => {
    setCurrent({
      severity: currentSeverity,
      owner: currentOwner,
      product_area: currentProductArea,
      ticket_type: currentTicketType,
    });
    setDraft({ severity: "", owner: "", product_area: "", ticket_type: "" });
    setResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const [owners, setOwners] = useState<string[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("teammates")
      .select("name, intercom_admin_id, active")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setOwners((data ?? []).filter((t) => t.intercom_admin_id).map((t) => t.name)));
    // Options come from the Intercom-sourced cache, never a hand-kept list.
    supabase
      .from("intercom_field_options" as any)
      .select("option_value")
      .eq("attr_key", "Affected Product Area")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setAreas(((data ?? []) as unknown as Array<{ option_value: string }>).map((r) => r.option_value)));
    supabase
      .from("intercom_field_options" as any)
      .select("option_value")
      .eq("attr_key", "Ticket type")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setTypes(((data ?? []) as unknown as Array<{ option_value: string }>).map((r) => r.option_value)));
  }, []);

  const changed = (["severity", "owner", "product_area", "ticket_type"] as FieldKey[]).filter(
    (f) => visible[f] && draft[f] !== "" && draft[f] !== (current[f] ?? ""),
  );

  const payloadFor = (field: FieldKey): Record<string, unknown> => {
    const expectedCurrent = current[field] ?? null;
    switch (field) {
      case "severity":
        return { severity: draft.severity };
      case "owner":
        return { teammateName: draft.owner, expectedCurrent };
      case "product_area":
        return { productArea: draft.product_area, expectedCurrent };
      case "ticket_type":
        return { classification: draft.ticket_type, expectedCurrent };
    }
  };

  const readBack = (field: FieldKey, data: any): string => {
    switch (field) {
      case "severity":
        return String(data?.custom_attributes?.Severity ?? draft.severity);
      case "owner":
        return String(data?.owner ?? draft.owner);
      case "product_area":
        return String(data?.product_area ?? draft.product_area);
      case "ticket_type":
        return String(data?.classification ?? draft.ticket_type);
    }
  };

  const submit = async () => {
    if (changed.length === 0) return;
    setSending(true);
    setResults([]);
    const out: FieldResult[] = [];
    for (const field of changed) {
      try {
        const { data, error } = await supabase.functions.invoke("esh-write-action", {
          body: { conversationId, action: ACTION[field], payload: payloadFor(field) },
        });
        if (error) {
          const { message, stale } = await readError(error);
          out.push({
            field,
            kind: stale ? "stale" : REFUSAL_RE.test(message) ? "refused" : "failed",
            message,
          });
        } else {
          const written = readBack(field, data);
          out.push({ field, kind: "ok", message: written });
          setCurrent((c) => ({ ...c, [field]: written }));
          setDraft((d) => ({ ...d, [field]: "" }));
          onWritten?.(field, written);
        }
      } catch (e) {
        const { message } = await readError(e);
        out.push({ field, kind: "failed", message });
      }
      setResults([...out]);
    }
    setSending(false);
  };

  if (!roleLoading && !canEdit) {
    return (
      <p className="text-xs text-muted-foreground">
        Read-only account — editor role required to write to Intercom. Severity {current.severity ?? "not set"} ·
        owner {current.owner ?? "unassigned"} · product area {current.product_area ?? "not set"} · ticket type{" "}
        {current.ticket_type ?? "not set"}.
      </p>
    );
  }

  const Row = ({
    field,
    placeholder,
    options,
    labelFor,
  }: {
    field: FieldKey;
    placeholder: string;
    options: string[];
    labelFor?: (v: string) => string;
  }) => (
    <div className="grid grid-cols-[110px_1fr] gap-2 items-center">
      <span className="text-xs text-muted-foreground">{FIELD_LABEL[field]}</span>
      <Select
        value={draft[field]}
        onValueChange={(v) => setDraft((d) => ({ ...d, [field]: v }))}
        disabled={sending}
      >
        <SelectTrigger className="h-9 w-full max-w-[240px] text-xs">
          <SelectValue placeholder={current[field] ? `${current[field]}` : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {labelFor ? labelFor(o) : o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-2">
      {visible.severity && (
        <Row field="severity" placeholder="Set severity…" options={["1", "2", "3", "4"]} labelFor={(s) => `Severity ${s}`} />
      )}
      {visible.owner && <Row field="owner" placeholder="Assign owner…" options={owners} />}
      {visible.product_area && <Row field="product_area" placeholder="Set product area…" options={areas} />}
      {visible.ticket_type && <Row field="ticket_type" placeholder="Set ticket type…" options={types} />}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={submit} disabled={changed.length === 0 || sending}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : changed.length > 0 ? (
            `Update ${changed.length} field${changed.length > 1 ? "s" : ""} in Intercom`
          ) : (
            "Update in Intercom"
          )}
        </Button>
        {changed.length > 0 && !sending && (
          <span className="text-[10px] text-muted-foreground">
            {changed.map((f) => FIELD_LABEL[f]).join(", ")}
          </span>
        )}
      </div>

      {results.map((r) => {
        if (r.kind === "ok") {
          return (
            <p key={r.field} className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Intercom accepted {FIELD_LABEL[r.field].toLowerCase()} {r.message}.
            </p>
          );
        }
        if (r.kind === "stale") {
          return (
            <p key={r.field} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <RotateCw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{FIELD_LABEL[r.field]} refused — the ticket moved. </span>
                {r.message}
              </span>
            </p>
          );
        }
        return (
          <p key={r.field} className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">
                {FIELD_LABEL[r.field]} {r.kind === "refused" ? "refused" : "failed"} — nothing changed.{" "}
              </span>
              {r.message}
            </span>
          </p>
        );
      })}

      <p className="text-[10px] text-muted-foreground">
        Each changed field is written through <code>esh-write-action</code>: Intercom first, then the Hub mirrors what
        Intercom returns.
      </p>
    </div>
  );
}
