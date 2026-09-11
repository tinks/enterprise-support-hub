import { useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Check, RotateCw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useCanEdit } from "@/hooks/useCanEdit";
import { Input } from "@/components/ui/input";
import { clearAiSubject, displaySubject, requestAiSubject, saveSubjectOverride } from "@/lib/subjectDisplay";
import {
  OVERRIDE_REASON_CODES,
  recordSeverityDecision,
  saveOverrideReason,
  type SeverityDecision,
} from "@/lib/severityProposals";

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
  /** Show the Hub-only subject label editor (never written to Intercom). */
  showSubject?: boolean;
  /** Fired after the Hub subject override is saved or cleared. */
  onSubjectSaved?: (next: string | null) => void;
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
  showSubject = false,
  onSubjectSaved,
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
  // Set only when the human wrote a severity different from an open AI proposal.
  const [override, setOverride] = useState<SeverityDecision | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [reasonSaved, setReasonSaved] = useState(false);

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
    setOverride(null);
    setReasonCode("");
    setReasonNote("");
    setReasonSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // General rule: whatever Intercom already has set shows as the current value.
  // The caller's props win when they carry a value; anything they leave null is
  // filled from the v3 mirror of Intercom (`custom_attributes` + columns).
  useEffect(() => {
    let cancelled = false;
    if (!conversationId) return;
    supabase
      .from("intercom_tickets_v3")
      .select("owner, product_area, classification, custom_attributes")
      .eq("intercom_conversation_id", conversationId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const ca = (data as any).custom_attributes ?? {};
        const sevRaw = ca["Severity"] ?? ca["severity"] ?? null;
        const sev = sevRaw == null ? null : (String(sevRaw).match(/[1-4]/)?.[0] ?? String(sevRaw));
        setCurrent((c) => ({
          severity: c.severity ?? sev,
          owner: c.owner ?? (data as any).owner ?? null,
          product_area:
            c.product_area ?? (data as any).product_area ?? ca["Affected Product Area"] ?? null,
          ticket_type: c.ticket_type ?? (data as any).classification ?? ca["Ticket type"] ?? null,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Hub-only subject label. Separate from the Intercom fields above: it never
  // reaches Intercom, so it does not go through `esh-write-action`.
  const [subjectRow, setSubjectRow] = useState<
    { subject: string | null; subject_override: string | null; subject_ai: string | null } | null
  >(null);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [subjectSaving, setSubjectSaving] = useState(false);
  const [subjectAiBusy, setSubjectAiBusy] = useState(false);
  const [subjectMsg, setSubjectMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!showSubject || !conversationId) return;
    let cancelled = false;
    setSubjectMsg(null);
    supabase
      .from("intercom_tickets_v3")
      .select("subject,subject_override,subject_ai")
      .eq("intercom_conversation_id", conversationId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSubjectRow(data as any);
        setSubjectDraft(displaySubject(data as any, ""));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, showSubject]);

  const commitSubject = async (next: string | null) => {
    setSubjectSaving(true);
    const { error, saved } = await saveSubjectOverride(conversationId, next);
    setSubjectSaving(false);
    if (error) {
      setSubjectMsg({ ok: false, text: error });
      return;
    }
    setSubjectRow((r) => (r ? { ...r, subject_override: saved } : r));
    setSubjectDraft(saved ?? subjectRow?.subject ?? "");
    setSubjectMsg({ ok: true, text: saved ? "Subject label saved (Hub only)." : "Override cleared — showing Intercom's subject." });
    onSubjectSaved?.(saved);
  };

  // Ask the model for a title. Works on any ticket, including one whose
  // Intercom subject is fine. The AI subject is written server-side; the draft
  // is offered here so it can be edited into a human label instead.
  const rewriteWithAi = async () => {
    setSubjectAiBusy(true);
    setSubjectMsg(null);
    const { error, subject } = await requestAiSubject(conversationId);
    setSubjectAiBusy(false);
    if (error || !subject) {
      setSubjectMsg({ ok: false, text: error ?? "The model returned no usable title" });
      return;
    }
    setSubjectRow((r) => (r ? { ...r, subject_ai: subject } : r));
    setSubjectDraft(subject);
    setSubjectMsg({ ok: true, text: "AI subject written (Hub only). Edit and save to make it a human label." });
    onSubjectSaved?.(subjectRow?.subject_override ?? null);
  };

  const dropAiSubject = async () => {
    setSubjectAiBusy(true);
    const { error } = await clearAiSubject(conversationId);
    setSubjectAiBusy(false);
    if (error) {
      setSubjectMsg({ ok: false, text: error });
      return;
    }
    setSubjectRow((r) => (r ? { ...r, subject_ai: null } : r));
    setSubjectDraft(subjectRow?.subject_override ?? subjectRow?.subject ?? "");
    setSubjectMsg({ ok: true, text: "AI subject removed — showing Intercom's subject." });
    onSubjectSaved?.(subjectRow?.subject_override ?? null);
  };

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
    setOverride(null);
    setReasonSaved(false);
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
          if (field === "severity") {
            // Label the open proposal now that Intercom accepted the value. A
            // disagreement is the highest-value signal the classifier gets, so
            // it is followed by a one-line "why".
            const decision = await recordSeverityDecision(conversationId, Number(written));
            if (decision?.status === "overridden") {
              setOverride(decision);
              setReasonCode("");
              setReasonNote("");
              setReasonSaved(false);
            }
          }
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
      {showSubject && (
        <div className="space-y-1">
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 items-start">
            <span className="text-xs text-muted-foreground pt-2">Subject</span>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Input
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                disabled={subjectSaving}
                placeholder="Descriptive subject…"
                className="h-9 text-xs w-full min-w-0 sm:w-[280px]"
              />

              <Button
                size="sm"
                variant="secondary"
                disabled={subjectSaving || subjectDraft.trim() === displaySubject(subjectRow, "")}
                onClick={() => void commitSubject(subjectDraft)}
              >
                {subjectSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save label"}
              </Button>
              {subjectRow?.subject_override ? (
                <Button size="sm" variant="ghost" disabled={subjectSaving} onClick={() => void commitSubject(null)}>
                  Clear
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={subjectSaving || subjectAiBusy}
                title="Ask AI for a title. Written as a Hub label only — Intercom is never changed."
                onClick={() => void rewriteWithAi()}
              >
                {subjectAiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rewrite with AI"}
              </Button>
              {subjectRow?.subject_ai ? (
                <Button size="sm" variant="ghost" disabled={subjectAiBusy} onClick={() => void dropAiSubject()}>
                  Use Intercom's
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground pl-[118px]">
            Hub label only — Intercom keeps {subjectRow?.subject ? `"${subjectRow.subject}"` : "its own subject"}.
            {subjectRow?.subject_ai && !subjectRow?.subject_override
              ? ` Currently showing an AI-written subject: "${subjectRow.subject_ai}".`
              : ""}
          </p>
          {subjectMsg && (
            <p className={`text-xs pl-[118px] ${subjectMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
              {subjectMsg.text}
            </p>
          )}
        </div>
      )}
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

      {override && !reasonSaved && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <p className="text-xs">
            You set <span className="font-medium">Severity {override.finalSeverity}</span>; the classifier had proposed{" "}
            <span className="font-medium">{override.proposedSeverity}</span>. Why?
          </p>
          <Select value={reasonCode} onValueChange={setReasonCode}>
            <SelectTrigger className="h-9 w-full max-w-[280px] text-xs">
              <SelectValue placeholder="Pick a reason…" />
            </SelectTrigger>
            <SelectContent>
              {OVERRIDE_REASON_CODES.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Optional: one line of detail (fed back into the classifier's examples)"
            className="text-xs min-h-[56px]"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!reasonCode}
              onClick={async () => {
                const { error } = await saveOverrideReason(override.proposalId, reasonCode, reasonNote);
                if (!error) setReasonSaved(true);
              }}
            >
              Save reason
            </Button>
            <button
              type="button"
              className="text-[10px] text-muted-foreground underline"
              onClick={() => setOverride(null)}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {override && reasonSaved && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Reason recorded — it will appear in the classifier's examples and in the reason roll-up.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground">
        Each changed field is written through <code>esh-write-action</code>: Intercom first, then the Hub mirrors what
        Intercom returns.
      </p>
    </div>
  );
}
