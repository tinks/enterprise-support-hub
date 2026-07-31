import { Fragment, useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";

// ---- Vocabulary (single source of truth for labels/emoji) -----------------
const CATEGORIES = [
  { value: "bug", emoji: "🐛", label: "Bug" },
  { value: "todo", emoji: "🛠️", label: "To-do" },
  { value: "tech_debt", emoji: "🧹", label: "Tech Debt" },
  { value: "feature_request", emoji: "✨", label: "Feature Request" },
  { value: "strategic", emoji: "🚀", label: "Strategic" },
] as const;
type Category = (typeof CATEGORIES)[number]["value"];

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "wontfix", label: "Won't fix" },
] as const;
type Status = (typeof STATUSES)[number]["value"];

const PRIORITIES = [
  { value: "high", label: "High" },
  { value: "med", label: "Med" },
  { value: "low", label: "Low" },
] as const;
type Priority = (typeof PRIORITIES)[number]["value"];

const PRIORITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };
const CLOSED_STATUSES: Status[] = ["done", "wontfix"];

const catMeta = (c: string) => CATEGORIES.find((x) => x.value === c);
const catLabel = (c: string) => {
  const m = catMeta(c);
  return m ? `${m.emoji} ${m.label}` : c;
};
const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? s;
const priorityLabel = (p: string | null) =>
  p ? PRIORITIES.find((x) => x.value === p)?.label ?? p : "Unprioritized";

type BacklogItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string | null;
  area: string | null;
  assignee: string | null;
  linked_ref: string | null;
  source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type Teammate = { name: string; email: string | null; role: string; active: boolean };

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const fmtTs = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

const NONE = "__none__";

type FormState = {
  id?: string;
  title: string;
  category: Category | "";
  priority: string;
  assignee: string;
  area: string;
  linked_ref: string;
  description: string;
};

const emptyForm: FormState = {
  title: "", category: "", priority: NONE, assignee: NONE, area: "", linked_ref: "", description: "",
};

export default function Backlog() {
  const { isAdmin } = useIsAdmin();
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // filters
  const [fCategory, setFCategory] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fPriority, setFPriority] = useState<string>("all");
  const [fAssignee, setFAssignee] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BacklogItem | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("esh_backlog_items")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) toast.error(`Failed to load backlog: ${error.message}`);
    setItems((data ?? []) as BacklogItem[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    (async () => {
      const { data } = await supabase
        .from("teammates")
        .select("name,email,role,active")
        .eq("active", true)
        .neq("role", "ai")
        .order("name");
      setTeammates((data ?? []) as Teammate[]);
      const { data: sess } = await supabase.auth.getSession();
      setMyEmail(sess.session?.user?.email ?? null);
    })();
  }, []);

  const assignable = useMemo(
    () => teammates.filter((t) => !!t.email) as Array<Teammate & { email: string }>,
    [teammates],
  );
  const nameFor = (email: string | null) => {
    if (!email) return null;
    return assignable.find((t) => t.email.toLowerCase() === email.toLowerCase())?.name ?? email;
  };
  const canAssignToMe = !!myEmail && assignable.some((t) => t.email.toLowerCase() === myEmail.toLowerCase());

  // ---- filtering ---------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (!showDone && CLOSED_STATUSES.includes(i.status as Status)) return false;
      if (fCategory !== "all" && i.category !== fCategory) return false;
      if (fStatus !== "all" && i.status !== fStatus) return false;
      if (fPriority !== "all") {
        if (fPriority === "none" ? i.priority != null : i.priority !== fPriority) return false;
      }
      if (fAssignee !== "all") {
        if (fAssignee === "unassigned" ? i.assignee != null : i.assignee !== fAssignee) return false;
      }
      if (q) {
        const hay = `${i.title} ${i.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, showDone, fCategory, fStatus, fPriority, fAssignee, search]);

  const sortRows = (rows: BacklogItem[]) =>
    [...rows].sort((a, b) => {
      const pa = a.priority ? PRIORITY_RANK[a.priority] ?? 3 : 3;
      const pb = b.priority ? PRIORITY_RANK[b.priority] ?? 3 : 3;
      if (pa !== pb) return pa - pb;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  const openCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of CATEGORIES) m[c.value] = 0;
    for (const i of items) {
      if (CLOSED_STATUSES.includes(i.status as Status)) continue;
      if (i.category in m) m[i.category] += 1;
    }
    return m;
  }, [items]);

  // ---- writes ------------------------------------------------------------
  const patch = async (item: BacklogItem, changes: Partial<BacklogItem>) => {
    const prev = items;
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, ...changes } : i)));
    const { error } = await supabase.from("esh_backlog_items").update(changes).eq("id", item.id);
    if (error) {
      setItems(prev);
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    toast.success("Saved");
    load();
  };

  const openAdd = () => { setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (i: BacklogItem) => {
    setForm({
      id: i.id,
      title: i.title,
      category: i.category as Category,
      priority: i.priority ?? NONE,
      assignee: i.assignee ?? NONE,
      area: i.area ?? "",
      linked_ref: i.linked_ref ?? "",
      description: i.description ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (!form.category) { toast.error("Category is required"); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      category: form.category,
      priority: form.priority === NONE ? null : form.priority,
      assignee: form.assignee === NONE ? null : form.assignee,
      area: form.area.trim() || null,
      linked_ref: form.linked_ref.trim() || null,
      description: form.description.trim() || null,
    };
    const { error } = form.id
      ? await supabase.from("esh_backlog_items").update(payload).eq("id", form.id)
      : await supabase.from("esh_backlog_items").insert({ ...payload, created_by: myEmail });
    setSaving(false);
    if (error) { toast.error(`Save failed: ${error.message}`); return; }
    toast.success(form.id ? "Item updated" : "Item added");
    setDialogOpen(false);
    load();
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("esh_backlog_items").delete().eq("id", deleteTarget.id);
    setDeleteTarget(null);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    toast.success("Item deleted");
    load();
  };

  const visibleCategories = CATEGORIES.filter((c) => fCategory === "all" || fCategory === c.value);

  return (
    <AppLayout>
      <div className="p-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Backlog</h1>
            <p className="text-sm text-muted-foreground">
              Single-pane view of all outstanding ESH work — bugs, to-dos, tech debt and ideas.
            </p>
          </div>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" /> Add item
          </Button>
        </div>

        {/* Open-count strip */}
        <Card>
          <CardContent className="flex flex-wrap gap-6 py-4">
            {CATEGORIES.map((c) => (
              <div key={c.value} className="flex items-center gap-2 text-sm">
                <span className="text-base">{c.emoji}</span>
                <span className="text-muted-foreground">{c.label}</span>
                <span className="font-semibold tabular-nums">{openCounts[c.value] ?? 0}</span>
              </div>
            ))}
            <span className="text-xs text-muted-foreground self-center">open items (excludes done / won't fix)</span>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={fCategory} onValueChange={setFCategory}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={fPriority} onValueChange={setFPriority}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              <SelectItem value="none">Unprioritized</SelectItem>
            </SelectContent>
          </Select>

          <Select value={fAssignee} onValueChange={setFAssignee}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {assignable.map((t) => <SelectItem key={t.email} value={t.email}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Input
            placeholder="Search title or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[260px]"
          />

          <div className="flex items-center gap-2">
            <Switch id="show-done" checked={showDone} onCheckedChange={setShowDone} />
            <Label htmlFor="show-done" className="text-sm text-muted-foreground">Show done / won't fix</Label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading backlog…
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">Nothing here 🎉</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {visibleCategories.map((c) => {
              const rows = sortRows(filtered.filter((i) => i.category === c.value));
              const collapsed = !!collapsedSections[c.value];
              return (
                <Collapsible
                  key={c.value}
                  open={!collapsed}
                  onOpenChange={(o) => setCollapsedSections((s) => ({ ...s, [c.value]: !o }))}
                >
                  <Card>
                    <CollapsibleTrigger className="w-full flex items-center gap-2 px-6 py-4 text-left">
                      {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <span className="font-medium">{c.emoji} {c.label}</span>
                      <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        {rows.length === 0 ? (
                          <div className="py-6 text-center text-sm text-muted-foreground">Nothing here 🎉</div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[40px]" />
                                <TableHead className="text-left">Title</TableHead>
                                <TableHead className="text-left w-[140px]">Priority</TableHead>
                                <TableHead className="text-left w-[160px]">Status</TableHead>
                                <TableHead className="text-left w-[180px]">Assignee</TableHead>
                                <TableHead className="text-left w-[140px]">Area</TableHead>
                                <TableHead className="text-left w-[180px]">Linked</TableHead>
                                <TableHead className="w-[90px]" />
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.map((i) => {
                                const isOpen = !!expanded[i.id];
                                return (
                                  <Fragment key={i.id}>
                                    <TableRow>
                                      <TableCell>
                                        <button
                                          aria-label={isOpen ? "Collapse row" : "Expand row"}
                                          onClick={() => setExpanded((s) => ({ ...s, [i.id]: !s[i.id] }))}
                                          className="text-muted-foreground hover:text-foreground"
                                        >
                                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        </button>
                                      </TableCell>
                                      <TableCell className="text-left font-medium">{i.title}</TableCell>
                                      <TableCell className="text-left">
                                        <Select
                                          value={i.priority ?? NONE}
                                          onValueChange={(v) => patch(i, { priority: v === NONE ? null : v })}
                                        >
                                          <SelectTrigger className="h-8 w-[125px]"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                                            <SelectItem value={NONE}>Unprioritized</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="text-left">
                                        <Select value={i.status} onValueChange={(v) => patch(i, { status: v })}>
                                          <SelectTrigger className="h-8 w-[145px]"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="text-left">
                                        <Select
                                          value={i.assignee ?? NONE}
                                          onValueChange={(v) => patch(i, { assignee: v === NONE ? null : v })}
                                        >
                                          <SelectTrigger className="h-8 w-[165px]">
                                            {i.assignee
                                              ? <span className="truncate">{nameFor(i.assignee)}</span>
                                              : <Badge variant="outline">Unassigned</Badge>}
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value={NONE}>Unassigned</SelectItem>
                                            {canAssignToMe && myEmail && (
                                              <SelectItem value={myEmail}>Assign to me</SelectItem>
                                            )}
                                            {assignable
                                              .filter((t) => !(canAssignToMe && myEmail && t.email.toLowerCase() === myEmail.toLowerCase()))
                                              .map((t) => <SelectItem key={t.email} value={t.email}>{t.name}</SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                      <TableCell className="text-left text-sm text-muted-foreground">{i.area || "—"}</TableCell>
                                      <TableCell className="text-left text-sm">
                                        {i.linked_ref
                                          ? isUrl(i.linked_ref)
                                            ? <a href={i.linked_ref} target="_blank" rel="noreferrer" className="text-primary underline truncate inline-block max-w-[160px] align-bottom">{i.linked_ref}</a>
                                            : <span className="text-muted-foreground">{i.linked_ref}</span>
                                          : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right whitespace-nowrap">
                                        <Button variant="ghost" size="sm" onClick={() => openEdit(i)}>Edit</Button>
                                        {isAdmin && (
                                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(i)} aria-label="Delete item">
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                    {isOpen && (
                                      <TableRow key={`${i.id}-detail`} className="bg-muted/30">
                                        <TableCell />
                                        <TableCell colSpan={7} className="text-left">
                                          <div className="space-y-2 py-2 text-sm">
                                            <div className="whitespace-pre-wrap">
                                              {i.description || <span className="text-muted-foreground">No description.</span>}
                                            </div>
                                            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                                              <span>Source: {i.source || "—"}</span>
                                              <span>Created by: {i.created_by || "—"}</span>
                                              <span>Created: {fmtTs(i.created_at)}</span>
                                              <span>Updated: {fmtTs(i.updated_at)}</span>
                                            </div>
                                          </div>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit item" : "Add item"}</DialogTitle>
            <DialogDescription>Backlog items are visible to everyone signed in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as Category })}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unprioritized</SelectItem>
                    {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assignee</Label>
                <Select value={form.assignee} onValueChange={(v) => setForm({ ...form, assignee: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Unassigned</SelectItem>
                    {canAssignToMe && myEmail && <SelectItem value={myEmail}>Assign to me</SelectItem>}
                    {assignable
                      .filter((t) => !(canAssignToMe && myEmail && t.email.toLowerCase() === myEmail.toLowerCase()))
                      .map((t) => <SelectItem key={t.email} value={t.email}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Area</Label>
                <Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Linked ref</Label>
              <Input
                placeholder="Ticket id / commit sha / Linear id / URL"
                value={form.linked_ref}
                onChange={(e) => setForm({ ...form, linked_ref: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {form.id ? "Save changes" : "Add item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (admins only) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete backlog item?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” will be permanently removed. Prefer setting the status to
              “Won't fix” if you want to keep the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
