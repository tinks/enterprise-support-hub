import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useCanEdit } from "@/hooks/useCanEdit";
import { CsatOverride } from "@/lib/csat";
import { ShieldAlert } from "lucide-react";

/**
 * Visible CSAT override. The rating itself is never edited or deleted — we
 * record a reasoned suppression next to it, so the raw Intercom number and the
 * reason we discount it are both always readable.
 */
export function CsatOverrideDialog({
  ticketId,
  conversationId,
  rating,
  existing,
  onSaved,
}: {
  ticketId: string;
  conversationId: string | null;
  rating: number | null;
  existing?: CsatOverride | null;
  onSaved: () => void;
}) {
  const { canEdit } = useCanEdit();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [saving, setSaving] = useState(false);

  if (rating == null) return null;

  const save = async () => {
    if (reason.trim().length < 5) {
      toast({ title: "Reason required", description: "Write at least a short sentence.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase.from("csat_overrides").upsert(
      {
        ticket_id: ticketId,
        intercom_conversation_id: conversationId,
        original_rating: rating,
        action: "exclude",
        reason: reason.trim(),
        created_by: userRes.user?.id ?? null,
        created_by_email: userRes.user?.email ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ticket_id" },
    );
    setSaving(false);
    if (error) {
      toast({ title: "Could not save override", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: existing ? "Override updated" : "Rating overridden" });
    setOpen(false);
    onSaved();
  };

  const remove = async () => {
    setSaving(true);
    const { error } = await supabase.from("csat_overrides").delete().eq("ticket_id", ticketId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not remove override", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Override removed — rating counts again" });
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={existing ? "secondary" : "outline"} size="sm" className="gap-1.5" disabled={!canEdit}>
          <ShieldAlert className="h-3.5 w-3.5" />
          {existing ? "Edit override" : "Override rating"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override CSAT rating</DialogTitle>
          <DialogDescription>
            The {rating}-star rating stays on the ticket and stays visible. It is marked as excluded
            from CSAT metrics with the reason below, attributed to you.
          </DialogDescription>
        </DialogHeader>
        {existing ? (
          <div className="rounded-md border border-border p-2 text-xs text-muted-foreground space-y-1">
            <Badge variant="secondary" className="text-[10px]">Currently overridden</Badge>
            <div>{existing.reason}</div>
            <div>
              {existing.created_by_email ?? "unknown"} · {new Date(existing.created_at).toLocaleString()}
            </div>
          </div>
        ) : null}
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. 1-star given after closing a duplicate ticket that was explicitly explained to the customer."
          rows={4}
        />
        <DialogFooter className="gap-2">
          {existing ? (
            <Button variant="ghost" onClick={remove} disabled={saving}>Remove override</Button>
          ) : null}
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save override"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
