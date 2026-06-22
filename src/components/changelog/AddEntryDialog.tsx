import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export type ChangelogEntry = {
  id: string;
  entry_date: string;
  title: string;
  body: string | null;
  tags: string[];
  area: string | null;
};

const ALL_TAGS = ["new", "improved", "fixed", "internal"] as const;
type Tag = (typeof ALL_TAGS)[number];

const TAG_META: Record<Tag, { label: string; className: string }> = {
  new: { label: "New", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  improved: { label: "Improved", className: "bg-sky-100 text-sky-800 border-sky-200" },
  fixed: { label: "Fixed", className: "bg-amber-100 text-amber-800 border-amber-200" },
  internal: { label: "Under the hood", className: "bg-muted text-muted-foreground border-border" },
};

export function tagMeta(tag: string) {
  return TAG_META[tag as Tag] ?? { label: tag, className: "bg-muted text-muted-foreground border-border" };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: ChangelogEntry | null;
  onSaved: () => void;
};

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function AddEntryDialog({ open, onOpenChange, entry, onSaved }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [area, setArea] = useState("");
  const [tags, setTags] = useState<Tag[]>(["new"]);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setEntryDate(entry.entry_date);
      setTitle(entry.title);
      setBody(entry.body ?? "");
      setArea(entry.area ?? "");
      setTags((entry.tags || []).filter((t): t is Tag => (ALL_TAGS as readonly string[]).includes(t)));
    } else {
      setEntryDate(todayIso());
      setTitle("");
      setBody("");
      setArea("");
      setTags(["new"]);
    }
  }, [open, entry]);

  function toggleTag(t: Tag) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function handleSave() {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      entry_date: entryDate,
      title: title.trim(),
      body: body.trim() || null,
      tags,
      area: area.trim() || null,
      author_user_id: userData?.user?.id ?? null,
    };
    const { error } = entry
      ? await supabase.from("changelog_entries").update(payload).eq("id", entry.id)
      : await supabase.from("changelog_entries").insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: entry ? "Entry updated" : "Entry added" });
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit changelog entry" : "Add changelog entry"}</DialogTitle>
          <DialogDescription>
            Briefly describe what shipped. Body supports plain text with line breaks.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="entry-date">Date</Label>
              <Input id="entry-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entry-area">Area (optional)</Label>
              <Input id="entry-area" placeholder="e.g. Inbox v2" value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry-title">Title</Label>
            <Input id="entry-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="One-line summary" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entry-body">Body (optional)</Label>
            <Textarea id="entry-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything users should know about this change." />
          </div>
          <div className="space-y-1">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_TAGS.map((t) => {
                const active = tags.includes(t);
                const meta = TAG_META[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? meta.className : "bg-background text-muted-foreground border-border hover:bg-accent"}`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {entry ? "Save changes" : "Add entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
