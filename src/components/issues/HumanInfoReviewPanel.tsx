import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  PROVENANCE_TAG,
  REPRO_LABEL,
  initialReview,
  reviewBlockers,
  severityLabel,
  scopeLabel,
  type Extraction,
  type IdField,
  type Provenance,
  type ReproStatus,
  type ReviewState,
} from "@/lib/humanInfo";

/**
 * Pre-flight review of the AI-drafted Human Info block. Nothing is posted from
 * here — onSubmit receives the reviewed state and the caller posts it. Submit
 * stays disabled until the reviewer deliberately clicks a repro status.
 */

function Tag({ p }: { p: Provenance }) {
  return (
    <span className="rounded border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground whitespace-nowrap">
      {PROVENANCE_TAG[p]}
    </span>
  );
}

function Field({ label, p, children, hint }: { label: string; p?: Provenance; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs font-medium">
        {label}
        {p ? <Tag p={p} /> : null}
      </div>
      {hint}
      {children}
    </div>
  );
}

function IdRow({ label, field, value, onChange }: { label: string; field: IdField; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-start gap-2">
      <div className="pt-2 text-xs text-muted-foreground">{label}</div>
      <div className="space-y-1">
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 font-mono text-xs" placeholder="—" />
        {field.candidates.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {field.candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.context}
                onClick={() => onChange(c.id)}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${c.id === value ? "bg-secondary" : "hover:bg-muted"}`}
              >
                {c.id.length > 18 ? `${c.id.slice(0, 8)}…${c.id.slice(-6)}` : c.id}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const REPRO_ORDER: ReproStatus[] = [
  "customer_reported_unverified",
  "support_verified",
  "attempted_could_not_reproduce_infra_limitation",
];

export function HumanInfoReviewPanel({
  extraction,
  busy,
  onCancel,
  onSubmit,
}: {
  extraction: Extraction;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (state: ReviewState) => void;
}) {
  const [s, setS] = useState<ReviewState>(() => initialReview(extraction));
  const set = <K extends keyof ReviewState>(k: K, v: ReviewState[K]) => setS((p) => ({ ...p, [k]: v }));
  const blockers = reviewBlockers(s);
  const urg = extraction.impact.customer_stated_urgency.value;

  return (
    <div className="space-y-4 rounded-md border bg-muted/20 p-3">
      <div className="text-sm font-medium">Review Human Info before posting</div>

      <Field label="Summary" p="inferred">
        <Input value={s.summary} maxLength={160} onChange={(e) => set("summary", e.target.value)} className="h-8 text-sm" />
      </Field>

      <Field
        label="Customer statement"
        p="direct_quote"
        hint={
          <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Review for sensitive info before submitting — this is a verbatim quote.
          </p>
        }
      >
        <Textarea rows={3} value={s.customerStatement} onChange={(e) => set("customerStatement", e.target.value)} className="text-sm" />
      </Field>

      <Field label="Identifiers" p="deterministic">
        <div className="space-y-1.5">
          <IdRow label="User" field={extraction.identifiers.user_id} value={s.userId} onChange={(v) => set("userId", v)} />
          <IdRow label="Project" field={extraction.identifiers.project_id} value={s.projectId} onChange={(v) => set("projectId", v)} />
          <IdRow label="Workspace" field={extraction.identifiers.workspace_id} value={s.workspaceId} onChange={(v) => set("workspaceId", v)} />
        </div>
      </Field>

      <Field label="Impact" p="inferred">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {severityLabel(extraction.impact.technical_severity)} · {scopeLabel(extraction.impact.technical_scope)}
          </Badge>
          {urg ? (
            <span className="text-xs italic text-muted-foreground">
              Customer: “{urg}” <Tag p="direct_quote" />
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{extraction.impact.technical_description}</p>
      </Field>

      <Field label="Reproduction status">
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {REPRO_ORDER.map((r) => {
            const active = s.reproTouched && s.reproStatus === r;
            const suggested = !s.reproTouched && r === "customer_reported_unverified";
            return (
              <Button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                size="sm"
                variant={active ? "default" : "outline"}
                className={suggested ? "border-dashed" : undefined}
                onClick={() => setS((p) => ({ ...p, reproStatus: r, reproTouched: true }))}
              >
                {REPRO_LABEL[r]}
                {suggested ? " (suggested)" : ""}
              </Button>
            );
          })}
        </div>
        {s.reproStatus === "attempted_could_not_reproduce_infra_limitation" && s.reproTouched ? (
          <Input
            value={s.infraReason}
            onChange={(e) => set("infraReason", e.target.value)}
            placeholder="Required: what infra limitation blocked reproduction?"
            className="mt-1.5 h-8 text-sm"
          />
        ) : null}
        <Textarea
          rows={3}
          value={s.reproSteps}
          onChange={(e) => set("reproSteps", e.target.value)}
          placeholder="Steps, one per line"
          className="mt-1.5 text-xs"
        />
      </Field>

      <Field label="Expected vs observed" p={s.evoProvenance}>
        <Input value={s.expected} onChange={(e) => set("expected", e.target.value)} placeholder="Expected" className="h-8 text-sm" />
        <Input value={s.observed} onChange={(e) => set("observed", e.target.value)} placeholder="Observed" className="h-8 text-sm" />
      </Field>

      <Field label="Evidence links" p="deterministic">
        <Textarea rows={2} value={s.evidence} onChange={(e) => set("evidence", e.target.value)} placeholder="One URL per line" className="font-mono text-xs" />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={blockers.length > 0 || busy} onClick={() => onSubmit(s)}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Submit and ask Pax
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {blockers.length ? <span className="text-[11px] text-muted-foreground">{blockers.join(" · ")}</span> : null}
      </div>
    </div>
  );
}
