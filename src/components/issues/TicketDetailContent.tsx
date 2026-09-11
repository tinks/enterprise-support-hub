import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, X } from "lucide-react";
import { TicketFieldsPanel } from "@/components/issues/TicketFieldsPanel";
import { PaxInvestigateControl } from "@/components/issues/PaxInvestigateControl";
import { TicketCommentCard } from "@/components/issues/TicketCommentCard";
import { ticketComments } from "@/lib/ticketComments";
import { displaySubject, originalSubject, subjectSource, type SubjectRow } from "@/lib/subjectDisplay";

/**
 * The one ticket panel used everywhere (My Queue, Inbox V3, Escalations…).
 *
 * Collapsed by default: badges, metadata, engineering card (only when a real
 * escalation exists), and the two message cards. The pencil expands the inline
 * editor, which is the existing `TicketFieldsPanel` — so every write still goes
 * through `esh-write-action` with unchanged contracts. Nothing new is written
 * to Intercom by this component.
 */

export type TicketDetailContentProps = {
  conversationId: string;
  subjectRow: SubjectRow;
  /** State pills owned by the calling surface (queue bucket, chase due, gaps…). */
  badges?: ReactNode;
  /** One line explaining the state above. */
  blurb?: string;
  /** Dense metadata grid — usually `IssueStat` cells. */
  stats?: ReactNode;
  /** Engineering escalation card. Omitted entirely when the ticket has none. */
  escalation?: ReactNode;
  /** Extra surface-owned card rendered under the escalation (e.g. snooze). */
  extra?: ReactNode;
  /** Persisted Intercom payload; drives the message cards. */
  rawPayload?: Record<string, any> | null;
  currentSeverity?: string | null;
  currentOwner?: string | null;
  currentProductArea?: string | null;
  currentTicketType?: string | null;
  /** Read-only mirror of Intercom's "Escalated to Engineering" attribute. */
  escalatedToEngineering?: string | null;
  /** Anything reloaded after a Hub or Intercom write landed. */
  onChanged?: () => void;
};

function Chip({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Badge variant={value ? "secondary" : "outline"} className="text-[10px] font-normal">
      {label}: {value ?? "—"}
    </Badge>
  );
}

export function TicketDetailContent({
  conversationId,
  subjectRow,
  badges,
  blurb,
  stats,
  escalation,
  rawPayload,
  currentSeverity = null,
  currentOwner = null,
  currentProductArea = null,
  currentTicketType = null,
  escalatedToEngineering = null,
  onChanged,
}: TicketDetailContentProps) {
  const [editing, setEditing] = useState(false);
  const { initial, latest, note } = useMemo(() => ticketComments(rawPayload), [rawPayload]);
  const source = subjectSource(subjectRow);
  const original = originalSubject(subjectRow);

  return (
    <div className="space-y-4">
      {/* Status + classification at a glance, with one way in to editing. */}
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {badges}
            <Chip label="Sev" value={currentSeverity ? `S${currentSeverity}` : null} />
            <Chip label="Owner" value={currentOwner} />
            <Chip label="Area" value={currentProductArea} />
            <Chip label="Type" value={currentTicketType} />
            {escalatedToEngineering ? (
              <Chip label="Esc to eng" value={escalatedToEngineering} />
            ) : null}
          </div>
          <Button
            size="icon"
            variant={editing ? "secondary" : "outline"}
            className="h-8 w-8 shrink-0"
            title={editing ? "Close the editor" : "Edit ticket fields"}
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </Button>
        </div>

        {blurb ? <p className="text-xs text-muted-foreground">{blurb}</p> : null}
        {source !== "intercom" && original ? (
          <p className="text-[10px] text-muted-foreground">
            Showing {source === "manual" ? "a Hub label" : "an AI subject"} — Intercom keeps “{original}”.
          </p>
        ) : null}

        {stats ? <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1">{stats}</div> : null}
      </div>

      {editing ? (
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Edit ticket</div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <TicketFieldsPanel
            conversationId={conversationId}
            currentSeverity={currentSeverity}
            currentOwner={currentOwner}
            currentProductArea={currentProductArea}
            currentTicketType={currentTicketType}
            showSubject
            onSubjectSaved={() => onChanged?.()}
            onWritten={() => onChanged?.()}
          />
        </div>
      ) : null}

      {escalation}

      {initial || latest || note ? (
        <div className="space-y-3">
          {initial ? <TicketCommentCard comment={initial} label="Initial message" /> : null}
          {latest && latest.text !== initial?.text ? (
            <TicketCommentCard comment={latest} label="Latest reply" />
          ) : null}
          {note ? (
            <TicketCommentCard comment={note} label="Latest internal note" tone="note" />
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No message content on this ticket yet.</p>
      )}

      <div className="rounded-md border p-3">
        <div className="text-sm font-medium mb-2">Investigation</div>
        <PaxInvestigateControl conversationId={conversationId} />
      </div>

      <p className="sr-only">{displaySubject(subjectRow)}</p>
    </div>
  );
}
