import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, startOfMonth, endOfMonth, parse } from "date-fns";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { NormalizedTicket, sourceLabel } from "./useMonthData";
import InlineConversationDetail from "@/components/InlineConversationDetail";

interface Props {
  tickets: NormalizedTicket[];
  month?: string; // e.g. "2026-05" — required for auto-categorize
  onChanged?: () => void;
}


type SrcFilter = "all" | "slack" | "gmail" | "manual";

const tableFor = (route: NormalizedTicket["route_source"]) =>
  route === "slack" ? "conversation_mappings" : route === "gmail" ? "gmail_conversations" : "manual_conversations";

export function UncategorizedPanel({ tickets, month, onChanged }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<string[]>([]);
  const [hideInternal, setHideInternal] = useState(true);
  const [srcFilter, setSrcFilter] = useState<SrcFilter>("all");
  const [savedIds, setSavedIds] = useState<Record<string, string>>({}); // id -> assigned area
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkArea, setBulkArea] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { owner?: string | null; status?: string; product_area?: string | null }>>({});

  const updateField = async (t: NormalizedTicket, field: "owner" | "status" | "product_area", value: string | null) => {
    const table = tableFor(t.route_source);
    const { error } = await supabase.from(table).update({ [field]: value } as any).eq("id", t.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    if (field === "product_area" && t.route_source === "gmail") {
      const { data: row } = await supabase.from("gmail_conversations").select("gmail_thread_id").eq("id", t.id).maybeSingle();
      if (row?.gmail_thread_id) {
        await supabase.from("gmail_conversations").update({ product_area: value }).eq("gmail_thread_id", row.gmail_thread_id);
      }
    }
    setOverrides(prev => ({ ...prev, [t.id]: { ...prev[t.id], [field]: value } }));
    await supabase.from("conversation_audit_logs").insert({
      conversation_id: t.id,
      conversation_source: t.route_source,
      action: `${field}_set`,
      old_value: ((t as any)[field] ?? null) as string | null,
      new_value: value,
      performed_by: "Insights inline edit",
    });
    if (field === "product_area" && value) {
      setSavedIds(prev => ({ ...prev, [t.id]: value }));
    }
  };



  useEffect(() => {
    supabase.from("settings").select("product_areas").limit(1).maybeSingle().then(({ data }) => {
      if (data?.product_areas) {
        const list = data.product_areas.split(",").map((s: string) => s.trim()).filter(Boolean);
        setAreas(Array.from(new Set([...list, "Other"])).sort((a, b) =>
          a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
        ));
      }
    });
  }, []);

  const uncategorized = useMemo(() => tickets.filter(t => !t.product_area || t.product_area === "Uncategorized"), [tickets]);

  const isInternal = (t: NormalizedTicket) =>
    t.display_source === "gmail" && /lovable\.dev$/i.test(t.customer_label || "");

  const visible = useMemo(() => {
    return uncategorized
      .filter(t => !savedIds[t.id])
      .filter(t => (hideInternal ? !isInternal(t) : true))
      .filter(t => (srcFilter === "all" ? true : t.route_source === srcFilter))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [uncategorized, savedIds, hideInternal, srcFilter]);

  const internalCount = uncategorized.filter(isInternal).length;

  const persist = async (t: NormalizedTicket, area: string) => {
    const table = tableFor(t.route_source);
    const update = supabase.from(table).update({ product_area: area }).eq("id", t.id);
    const { error } = await update;
    if (error) throw error;

    // Gmail: propagate to siblings sharing thread id
    if (t.route_source === "gmail") {
      const { data: row } = await supabase.from("gmail_conversations").select("gmail_thread_id").eq("id", t.id).maybeSingle();
      if (row?.gmail_thread_id) {
        await supabase.from("gmail_conversations").update({ product_area: area }).eq("gmail_thread_id", row.gmail_thread_id);
      }
    }

    await supabase.from("conversation_audit_logs").insert({
      conversation_id: t.id,
      conversation_source: t.route_source,
      action: "product_area_set",
      old_value: t.product_area || null,
      new_value: area,
      performed_by: "Insights bulk fix",
    });
  };

  const assign = async (t: NormalizedTicket, area: string) => {
    if (!area) return;
    setSavingId(t.id);
    try {
      await persist(t, area);
      setSavedIds(prev => ({ ...prev, [t.id]: area }));
      toast({ title: "Updated", description: `Set product area to ${area}.` });
    } catch (e) {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map(v => v.id)));
  };

  const applyBulk = async () => {
    if (!bulkArea || selected.size === 0) return;
    setBulkSaving(true);
    let ok = 0, fail = 0;
    const next = { ...savedIds };
    for (const t of visible) {
      if (!selected.has(t.id)) continue;
      try {
        await persist(t, bulkArea);
        next[t.id] = bulkArea;
        ok++;
      } catch {
        fail++;
      }
    }
    setSavedIds(next);
    setSelected(new Set());
    setBulkSaving(false);
    toast({
      title: `${ok} updated`,
      description: fail ? `${fail} failed.` : `Set to ${bulkArea}.`,
      variant: fail ? "destructive" : "default",
    });
    onChanged?.();
  };

  const autoCategorize = async () => {
    if (!month) {
      toast({ title: "Month missing", description: "Cannot auto-categorize without month context.", variant: "destructive" });
      return;
    }
    if (visible.length === 0) {
      toast({ title: "Nothing to categorize", description: "No visible uncategorized tickets." });
      return;
    }
    setAutoRunning(true);
    try {
      const start = startOfMonth(parse(month + "-01", "yyyy-MM-dd", new Date()));
      const end = endOfMonth(start);
      const { data, error } = await supabase.functions.invoke("auto-categorize-product-area", {
        body: {
          from: start.toISOString(),
          to: end.toISOString(),
          ids: visible.map(v => v.id),
          excludeInternal: hideInternal,
        },
      });
      if (error) throw error;
      const written = data?.written ?? 0;
      const low = data?.lowConfidence ?? 0;
      const failed = data?.failed ?? 0;
      const total = data?.total ?? 0;
      toast({
        title: `${written} of ${total} auto-categorized`,
        description: [
          low > 0 ? `${low} low-confidence skipped` : null,
          failed > 0 ? `${failed} failed` : null,
        ].filter(Boolean).join(" · ") || "All done.",
        variant: failed > 0 ? "destructive" : "default",
      });
      onChanged?.();
    } catch (e) {
      toast({ title: "Auto-categorize failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAutoRunning(false);
    }
  };

  if (uncategorized.length === 0) return null;


  return (
    <Card>
      <CardContent className="p-5">
        <button
          className="w-full flex items-center justify-between gap-2 text-left"
          onClick={() => setOpen(o => !o)}
        >
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h2 className="text-sm font-semibold">Uncategorized tickets</h2>
            <Badge variant="secondary">{uncategorized.length - Object.keys(savedIds).length}</Badge>
            {internalCount > 0 && (
              <span className="text-xs text-muted-foreground">
                ({internalCount} internal lovable.dev {hideInternal ? "hidden" : "shown"})
              </span>
            )}
          </div>
          {Object.keys(savedIds).length > 0 && (
            <span className="text-xs text-muted-foreground">{Object.keys(savedIds).length} fixed in this session</span>
          )}
        </button>

        {open && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={hideInternal} onCheckedChange={v => setHideInternal(!!v)} />
                Hide internal lovable.dev senders
              </label>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Source:</span>
                {(["all", "slack", "gmail", "manual"] as SrcFilter[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSrcFilter(s)}
                    className={`px-2 py-0.5 rounded border text-xs capitalize ${srcFilter === s ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <span className="text-muted-foreground ml-auto">{visible.length} shown</span>
              <Button
                size="sm"
                variant="outline"
                onClick={autoCategorize}
                disabled={autoRunning || visible.length === 0 || !month}
                className="h-7 gap-1.5"
                title={month ? "Use AI to categorize all visible tickets" : "Auto-categorize unavailable"}
              >
                {autoRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {autoRunning ? "Categorizing…" : `Auto-categorize ${visible.length}`}
              </Button>
            </div>


            {selected.size > 0 && (
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                <span className="text-xs font-medium">{selected.size} selected — set to</span>
                <Select value={bulkArea} onValueChange={setBulkArea}>
                  <SelectTrigger className="w-[180px] h-8"><SelectValue placeholder="Product area" /></SelectTrigger>
                  <SelectContent>
                    {areas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={applyBulk} disabled={!bulkArea || bulkSaving}>
                  {bulkSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}

            <div className="border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-8">
                      <Checkbox
                        checked={visible.length > 0 && selected.size === visible.length}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="px-2 py-1.5 w-20">Source</th>
                    <th className="px-2 py-1.5">Subject</th>
                    <th className="px-2 py-1.5 w-40">Sender</th>
                    <th className="px-2 py-1.5 w-24">Created</th>
                    <th className="px-2 py-1.5 w-44">Product area</th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(t => {
                    const ov = overrides[t.id] || {};
                    const isOpen = expandedId === t.id;
                    return (
                      <React.Fragment key={t.id}>
                        <tr className="border-t hover:bg-accent/30">
                          <td className="px-2 py-1.5">
                            <Checkbox
                              checked={selected.has(t.id)}
                              onCheckedChange={v => {
                                const n = new Set(selected);
                                if (v) n.add(t.id); else n.delete(t.id);
                                setSelected(n);
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {sourceLabel[t.display_source] || t.display_source}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 max-w-0">
                            <button
                              type="button"
                              onClick={() => setExpandedId(isOpen ? null : t.id)}
                              className="flex items-center gap-1 text-left truncate w-full hover:text-primary"
                              title={t.subject}
                            >
                              {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                              <span className="truncate">{t.subject}</span>
                            </button>
                          </td>
                          <td className="px-2 py-1.5 truncate" title={t.customer_label}>{t.customer_label}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{format(new Date(t.created_at), "MMM d")}</td>
                          <td className="px-2 py-1.5">
                            <Select onValueChange={v => assign(t, v)} disabled={savingId === t.id}>
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue placeholder={savingId === t.id ? "Saving…" : "Assign…"} />
                              </SelectTrigger>
                              <SelectContent>
                                {areas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Link to={`/conversations/${t.id}?source=${t.route_source}`} target="_blank">
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-t">
                            <td colSpan={7} className="p-0">
                              <ExpandedDetailRow
                                t={t}
                                areas={areas}
                                override={ov}
                                onChange={(field, value) => updateField(t, field, value)}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr><td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">Nothing to show with current filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
