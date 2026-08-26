import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export type TicketNote = {
  id: string;
  conversation_id: string;
  conversation_source: string;
  author: string;
  note_text: string;
  created_at: string;
};

/** The source value every v3 surface writes notes under. */
export const V3_NOTE_SOURCE = "intercom_v3";

/**
 * Batch-load notes for a set of v3 ticket uuids, so a list surface can search
 * and open a detail sheet without a per-row round trip.
 */
export async function fetchV3Notes(ticketIds: string[]): Promise<Map<string, TicketNote[]>> {
  const out = new Map<string, TicketNote[]>();
  if (ticketIds.length === 0) return out;
  const { data, error } = await supabase
    .from("conversation_notes")
    .select("*")
    .eq("conversation_source", V3_NOTE_SOURCE)
    .in("conversation_id", ticketIds)
    .order("created_at", { ascending: true });
  if (error) return out;
  for (const row of (data ?? []) as unknown as TicketNote[]) {
    const list = out.get(row.conversation_id) ?? [];
    list.push(row);
    out.set(row.conversation_id, list);
  }
  return out;
}

/**
 * Threaded internal notes for one v3 ticket, stored in `conversation_notes`
 * (the same table the conversation detail page uses) so a note written here is
 * real ticket data rather than page-local state.
 */
export function TicketNotes({
  ticketId,
  initialNotes,
  canEdit,
  onChange,
}: {
  ticketId: string;
  initialNotes?: TicketNote[];
  canEdit: boolean;
  onChange?: (notes: TicketNote[]) => void;
}) {
  const [notes, setNotes] = useState<TicketNote[]>(initialNotes ?? []);
  const [author, setAuthor] = useState(() => localStorage.getItem("note_author") ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversation_notes")
        .select("*")
        .eq("conversation_id", ticketId)
        .eq("conversation_source", V3_NOTE_SOURCE)
        .order("created_at", { ascending: true });
      if (!cancelled && data) {
        setNotes(data as unknown as TicketNote[]);
        onChange?.(data as unknown as TicketNote[]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const authorName = author.trim() || "Anonymous";
    localStorage.setItem("note_author", authorName);
    const { data, error } = await supabase
      .from("conversation_notes")
      .insert({
        conversation_id: ticketId,
        conversation_source: V3_NOTE_SOURCE,
        author: authorName,
        note_text: text.trim(),
      } as any)
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      toast.error(`Failed to add note: ${error?.message ?? "unknown error"}`);
      return;
    }
    const next = [...notes, data as unknown as TicketNote];
    setNotes(next);
    onChange?.(next);
    setText("");
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("conversation_notes").delete().eq("id", id);
    if (error) {
      toast.error(`Failed to delete note: ${error.message}`);
      return;
    }
    const next = notes.filter((n) => n.id !== id);
    setNotes(next);
    onChange?.(next);
  };

  return (
    <div className="space-y-2">
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notes yet.</p>
      ) : (
        notes.map((n) => (
          <div key={n.id} className="group rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs whitespace-pre-wrap break-words">{n.note_text}</div>
              {canEdit && (
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => remove(n.id)}
                  title="Delete note"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {n.author} · {format(new Date(n.created_at), "d MMM yyyy HH:mm")}
            </div>
          </div>
        ))
      )}

      {canEdit && (
        <div className="space-y-2 pt-1">
          <Input
            className="h-8 text-xs"
            placeholder="Your name"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
          <Textarea
            className="text-xs min-h-[64px]"
            placeholder="Add an internal note… (⌘+Enter to save)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); add(); }
            }}
          />
          <Button size="sm" onClick={add} disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Add note
          </Button>
        </div>
      )}
    </div>
  );
}
