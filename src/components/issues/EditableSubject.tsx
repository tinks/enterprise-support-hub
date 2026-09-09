import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCanEdit } from "@/hooks/useCanEdit";
import {
  displaySubject,
  isSubjectAiWritten,
  isSubjectOverridden,
  originalSubject,
  saveSubjectOverride,
  type SubjectRow,
} from "@/lib/subjectDisplay";
import { toast } from "sonner";

/**
 * Click-to-edit subject cell. Hub-only label — Intercom is never written to.
 * Read-only accounts get plain text with no affordance.
 */
export function EditableSubject({
  conversationId,
  row,
  secondary,
  onSaved,
}: {
  conversationId: string | null;
  row: SubjectRow;
  secondary?: React.ReactNode;
  /** Called with the new override (null when cleared) so the caller can patch local state. */
  onSaved?: (next: string | null) => void;
}) {
  const { canEdit } = useCanEdit();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const shown = displaySubject(row);
  const overridden = isSubjectOverridden(row);
  const aiWritten = isSubjectAiWritten(row);
  const original = originalSubject(row);

  const commit = async (next: string | null) => {
    if (!conversationId) return;
    setSaving(true);
    const { error, saved } = await saveSubjectOverride(conversationId, next);
    setSaving(false);
    if (error) {
      toast.error(`Subject not saved — ${error}`);
      return;
    }
    setEditing(false);
    onSaved?.(saved);
    toast.success(saved ? "Subject label saved (Hub only)" : "Override cleared — showing Intercom's subject");
  };

  if (editing) {
    return (
      <div className="min-w-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit(value);
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 text-xs"
          placeholder="Descriptive subject…"
        />
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 group/subj">
      <div className="flex items-center gap-1 min-w-0">
        <span className="truncate" title={overridden && original ? `Intercom: ${original}` : undefined}>
          {shown}
        </span>
        {canEdit && conversationId ? (
          <button
            type="button"
            title="Edit subject (Hub only)"
            className="opacity-0 group-hover/subj:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setValue(shown === "Untitled" ? "" : shown);
              setEditing(true);
            }}
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
        {overridden && canEdit && conversationId ? (
          <button
            type="button"
            title="Clear override — fall back to Intercom's subject"
            className="opacity-0 group-hover/subj:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              void commit(null);
            }}
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      {overridden ? (
        <div className="text-[10px] text-muted-foreground truncate" title={original ?? undefined}>
          edited · Intercom: {original ?? "—"}
        </div>
      ) : aiWritten ? (
        <div className="text-[10px] text-muted-foreground truncate" title={original ?? undefined}>
          AI · Intercom: {original ?? "—"}
        </div>
      ) : null}
      {secondary ? <div className="text-[10px] text-muted-foreground truncate">{secondary}</div> : null}
    </div>
  );
}
