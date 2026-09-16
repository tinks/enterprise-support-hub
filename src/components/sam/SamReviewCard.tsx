import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCanEdit } from "@/hooks/useCanEdit";
import { format } from "date-fns";

/** Hub-only review of a Sam (bot) failure. Never written back to Intercom. */
export type SamReview = {
  id: string;
  conversation_id: string;
  failure_category: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export const SAM_FAILURE_CATEGORIES = [
  "Hallucination / Factually inaccurate",
  "Misunderstood request",
  "Outdated docs / Stale guidance",
  "Premature / Missed handoff",
  "Incomplete answer",
  "Tone / Formatting issue",
  "Other",
] as const;

const NONE = "__none__";

export function SamReviewCard({
  conversationId,
  review,
  onSaved,
  onDeleted,
}: {
  conversationId: string;
  review: SamReview | null;
  onSaved: (row: SamReview) => void;
  onDeleted: (conversationId: string) => void;
}) {
  const { canEdit } = useCanEdit();
  const { toast } = useToast();
  const [category, setCategory] = useState<string>(review?.failure_category ?? NONE);
  const [note, setNote] = useState<string>(review?.review_note ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCategory(review?.failure_category ?? NONE);
    setNote(review?.review_note ?? "");
  }, [review?.id, conversationId]);

  const save = async () => {
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("sam_ticket_reviews")
      .upsert(
        {
          conversation_id: conversationId,
          failure_category: category === NONE ? null : category,
          review_note: note.trim() || null,
          reviewed_by: auth.user?.email ?? null,
        },
        { onConflict: "conversation_id" },
      )
      .select()
      .maybeSingle();
    setSaving(false);
    if (error || !data) {
      toast({ title: "Could not save review", description: error?.message, variant: "destructive" });
      return;
    }
    onSaved(data as SamReview);
    toast({ title: "Review saved" });
  };

  const remove = async () => {
    setSaving(true);
    const { error } = await supabase.from("sam_ticket_reviews").delete().eq("conversation_id", conversationId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not clear review", description: error.message, variant: "destructive" });
      return;
    }
    onDeleted(conversationId);
    setCategory(NONE);
    setNote("");
    toast({ title: "Review cleared" });
  };

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Sam review</div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Hub only · not sent to Intercom</span>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Failure category</div>
        <Select value={category} onValueChange={setCategory} disabled={!canEdit}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Not categorised" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not categorised</SelectItem>
            {SAM_FAILURE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">Review note</div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!canEdit}
          rows={4}
          placeholder="What should Sam have done differently?"
          className="text-xs"
        />
      </div>

      {review ? (
        <div className="text-[11px] text-muted-foreground">
          Last reviewed by {review.reviewed_by ?? "—"} on {format(new Date(review.updated_at), "d MMM yyyy HH:mm")}
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />} Save
          </Button>
          {review ? (
            <Button size="sm" variant="ghost" onClick={remove} disabled={saving}>
              <Trash2 className="h-4 w-4 mr-1" /> Clear
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Read-only access — ask a Hub admin for the editor role.</div>
      )}
    </div>
  );
}
