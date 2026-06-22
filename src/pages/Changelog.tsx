import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, ScrollText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import AddEntryDialog, { tagMeta, type ChangelogEntry } from "@/components/changelog/AddEntryDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function monthKey(dateIso: string) {
  return dateIso.slice(0, 7); // YYYY-MM
}

const Changelog = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChangelogEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChangelogEntry | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("changelog_entries")
      .select("id, entry_date, title, body, tags, area")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load changelog", description: error.message, variant: "destructive" });
    } else {
      setRows((data || []) as ChangelogEntry[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ChangelogEntry[]>();
    for (const r of rows) {
      const k = monthKey(r.entry_date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries());
  }, [rows]);

  async function handleDelete() {
    if (!confirmDelete) return;
    const { error } = await supabase.from("changelog_entries").delete().eq("id", confirmDelete.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Entry deleted" });
      load();
    }
    setConfirmDelete(null);
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-semibold text-foreground">Changelog</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              What's shipped, newest first. Add an entry whenever something user-visible changes.
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-1">
            <Plus className="h-4 w-4" /> Add entry
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No entries yet — click <span className="font-medium text-foreground">Add entry</span> to log a change.
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map(([month, entries]) => (
              <section key={month}>
                <h2 className="sticky top-0 z-10 bg-background/80 backdrop-blur py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border mb-3">
                  {format(parseISO(`${month}-01`), "MMMM yyyy")}
                </h2>
                <div className="space-y-4">
                  {entries.map((e) => (
                    <article key={e.id} className="rounded-md border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {format(parseISO(e.entry_date), "MMM d, yyyy")}
                            </span>
                            {e.area && (
                              <Badge variant="outline" className="text-xs">{e.area}</Badge>
                            )}
                            {(e.tags || []).map((t) => {
                              const m = tagMeta(t);
                              return (
                                <Badge key={t} variant="outline" className={`text-xs ${m.className}`}>{m.label}</Badge>
                              );
                            })}
                          </div>
                          <h3 className="text-sm font-medium text-foreground">{e.title}</h3>
                          {e.body && (
                            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{e.body}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => { setEditing(e); setDialogOpen(true); }}
                            aria-label="Edit entry"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmDelete(e)}
                            aria-label="Delete entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <AddEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editing}
        onSaved={load}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title}" will be removed from the changelog. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default Changelog;
