import { useEffect, useMemo, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, ExternalLink, AlertCircle, ChevronDown, Download } from "lucide-react";
import { format, formatDistanceToNow, startOfMonth, endOfMonth, subMonths, subDays, startOfDay, endOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type Ticket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  product_area: string | null;
  classification: string | null;
  status: string | null;
  tags: string[] | null;
  intercom_created_at: string | null;
  intercom_updated_at: string | null;
  last_synced_at: string | null;
  raw_payload: any;
};

const ANY = "__any__";
const MISSING = "__missing__";
const NO_TAGS = "(no tags)";

const NO_ENGAGEMENT_TAGS = new Set(["enterprise-fyi", "enterprise-duplicate"]);
const isNoEngagement = (tags: string[] | null) =>
  (tags ?? []).some((t) => NO_ENGAGEMENT_TAGS.has(t.trim().toLowerCase()));

type ColKey = "intercom_id" | "subject" | "contact" | "owner" | "product_area" | "classification" | "tags" | "status" | "engagement" | "updated";
const COL_ORDER: ColKey[] = ["intercom_id", "subject", "contact", "owner", "product_area", "classification", "tags", "status", "engagement", "updated"];
const COL_LABELS: Record<ColKey, string> = {
  intercom_id: "Intercom ID",
  subject: "Subject",
  contact: "Contact",
  owner: "Owner",
  product_area: "Product area",
  classification: "Classification",
  tags: "Tags",
  status: "Status",
  engagement: "Engagement",
  updated: "Updated",
};
const DEFAULT_WIDTHS: Record<ColKey, number> = {
  intercom_id: 150,
  subject: 360,
  contact: 180,
  owner: 120,
  product_area: 160,
  classification: 140,
  tags: 220,
  status: 90,
  engagement: 130,
  updated: 140,
};


const STORAGE_KEY = "inbox-v2-col-widths";
const MIN_WIDTH = 60;

const InboxV2 = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string>(ANY);
  const [productAreaFilter, setProductAreaFilter] = useState<string>(ANY);
  const [classificationFilter, setClassificationFilter] = useState<string>(ANY);
  const [statusFilter, setStatusFilter] = useState<string[]>(["open"]);
  const [tagsFilter, setTagsFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);

  const [widths, setWidths] = useState<Record<ColKey, number>>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTHS;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_WIDTHS, ...parsed };
      }
    } catch {}
    return DEFAULT_WIDTHS;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {}
  }, [widths]);

  const dragRef = useRef<{ key: ColKey; startX: number; startWidth: number } | null>(null);

  const onResizeStart = (key: ColKey) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startWidth: widths[key] };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const next = Math.max(MIN_WIDTH, dragRef.current.startWidth + delta);
      setWidths((w) => ({ ...w, [dragRef.current!.key]: next }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inbox_v2_tickets")
      .select("*")
      .order("intercom_updated_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) {
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    } else {
      setRows((data || []) as Ticket[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const [windowHours, setWindowHours] = useState<number>(24);

  const runSync = async (hoursOverride?: number) => {
    const hours = Math.max(1, Math.min(8760, hoursOverride ?? windowHours));
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-inbox-v2", {
        body: { windowHours: hours },
      });
      if (error) throw error;
      toast({
        title: `Sync complete (${hours}h window)`,
        description: `Fetched ${data?.fetched ?? 0} · ${data?.inserted ?? 0} new · ${data?.updated ?? 0} updated${data?.failed ? ` · ${data.failed} failed` : ""}`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };


  const ownerOptions = useMemo(() => Array.from(new Set(rows.map(r => r.owner).filter(Boolean))).sort() as string[], [rows]);
  const productAreaOptions = useMemo(() => Array.from(new Set(rows.map(r => r.product_area).filter(Boolean))).sort() as string[], [rows]);
  const classificationOptions = useMemo(() => Array.from(new Set(rows.map(r => r.classification).filter(Boolean))).sort() as string[], [rows]);
  const statusOptions = useMemo(() => Array.from(new Set(rows.map(r => r.status).filter(Boolean))).sort() as string[], [rows]);
  const tagsOptions = useMemo(() => {
    const set = new Set<string>();
    let hasEmpty = false;
    for (const r of rows) {
      const t = r.tags;
      if (!t || t.length === 0) { hasEmpty = true; continue; }
      for (const v of t) if (v) set.add(v);
    }
    const list = Array.from(set).sort();
    if (hasEmpty) list.unshift(NO_TAGS);
    return list;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (ownerFilter === MISSING && r.owner) return false;
      if (ownerFilter !== ANY && ownerFilter !== MISSING && r.owner !== ownerFilter) return false;
      if (productAreaFilter === MISSING && r.product_area) return false;
      if (productAreaFilter !== ANY && productAreaFilter !== MISSING && r.product_area !== productAreaFilter) return false;
      if (classificationFilter === MISSING && r.classification) return false;
      if (classificationFilter !== ANY && classificationFilter !== MISSING && r.classification !== classificationFilter) return false;
      if (statusFilter.length > 0 && (!r.status || !statusFilter.includes(r.status))) return false;
      if (tagsFilter.length > 0) {
        const rTags = r.tags || [];
        const wantEmpty = tagsFilter.includes(NO_TAGS);
        const otherSelected = tagsFilter.filter(t => t !== NO_TAGS);
        const matchEmpty = wantEmpty && rTags.length === 0;
        const matchTag = otherSelected.some(t => rTags.includes(t));
        if (!matchEmpty && !matchTag) return false;
      }
      if (q) {
        const hay = [r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id, ...(r.tags || [])]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, ownerFilter, productAreaFilter, classificationFilter, statusFilter, tagsFilter]);

  const lastSync = useMemo(() => {
    const ts = rows.map(r => r.last_synced_at).filter(Boolean).sort().pop();
    return ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : "never";
  }, [rows]);

  const intercomUrl = (id: string) => `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;

  const renderField = (val: string | null) => {
    if (val) return <span className="text-foreground">{val}</span>;
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
        <AlertCircle className="h-3 w-3" /> missing
      </span>
    );
  };

  const ResizeHandle = ({ colKey }: { colKey: ColKey }) => (
    <span
      onMouseDown={onResizeStart(colKey)}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40 active:bg-primary/60"
      style={{ touchAction: "none" }}
    />
  );

  const Th = ({ colKey, children }: { colKey: ColKey; children: React.ReactNode }) => (
    <TableHead style={{ width: widths[colKey] }} className="relative overflow-hidden">
      <span className="truncate block pr-2">{children}</span>
      <ResizeHandle colKey={colKey} />
    </TableHead>
  );

  const totalWidth = COL_ORDER.reduce((acc, k) => acc + widths[k], 0);

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              Inbox v2 <Badge variant="secondary" className="text-[10px]">Beta</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              Sandbox view sourced directly from Intercom — read-only. Owner / Product Area / Classification mirror Intercom and are never edited locally.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Last synced: {lastSync} · {rows.length} tickets</span>
            <div className="flex items-center gap-1.5 rounded-md border border-border px-2 h-9">
              <label htmlFor="window-hours" className="text-xs text-muted-foreground">Window (h)</label>
              <Input
                id="window-hours"
                type="number"
                min={1}
                max={8760}
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value) || 1)}
                className="h-7 w-20 text-xs"
              />
            </div>
            <Button onClick={() => runSync()} disabled={syncing} size="sm" variant="outline">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync now
            </Button>
            <Button
              onClick={() => runSync(720)}
              disabled={syncing}
              size="sm"
              variant="ghost"
              title="Backfill the last 30 days"
            >
              Backfill 30d
            </Button>
          </div>
        </div>


        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search subject, contact, email, Intercom ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm h-9"
          />
          <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter} options={ownerOptions} />
          <FilterSelect label="Product area" value={productAreaFilter} onChange={setProductAreaFilter} options={productAreaOptions} />
          <FilterSelect label="Classification" value={classificationFilter} onChange={setClassificationFilter} options={classificationOptions} />
          <MultiFilterSelect label="Status" values={statusFilter} onChange={setStatusFilter} options={statusOptions} />
          <MultiFilterSelect label="Tags" values={tagsFilter} onChange={setTagsFilter} options={tagsOptions} />
          <span className="text-xs text-muted-foreground ml-2">{filtered.length} of {rows.length}</span>
          <div className="ml-auto flex items-center gap-2">
            <ExportPopover
              filters={{
                search,
                ownerFilter,
                productAreaFilter,
                classificationFilter,
                statusFilter,
                tagsFilter,
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => setWidths(DEFAULT_WIDTHS)}
              title="Reset column widths"
            >
              Reset columns
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card overflow-auto">
          <Table style={{ tableLayout: "fixed", width: totalWidth, minWidth: "100%" }}>
            <TableHeader>
              <TableRow>
                {COL_ORDER.map((k) => (
                  <Th key={k} colKey={k}>{COL_LABELS[k]}</Th>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={COL_ORDER.length} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COL_ORDER.length} className="text-center py-10 text-muted-foreground text-sm">
                    {rows.length === 0
                      ? "No tickets yet — click \"Sync now\" to pull from Intercom."
                      : "No tickets match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(r => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => setSelected(r)}
                  >
                    <TableCell style={{ width: widths.intercom_id }} className="text-xs font-mono text-muted-foreground truncate overflow-hidden">
                      <a
                        href={intercomUrl(r.intercom_conversation_id)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-primary hover:underline"
                        title={r.intercom_conversation_id}
                      >
                        {r.intercom_conversation_id}
                      </a>
                    </TableCell>
                    <TableCell style={{ width: widths.subject }} className="font-medium truncate overflow-hidden">
                      {r.subject || "(no subject)"}
                    </TableCell>
                    <TableCell style={{ width: widths.contact }} className="text-sm overflow-hidden">
                      <div className="truncate">{r.contact_name || "—"}</div>
                      {r.contact_email && <div className="text-[11px] text-muted-foreground truncate">{r.contact_email}</div>}
                    </TableCell>
                    <TableCell style={{ width: widths.owner }} className="text-sm truncate overflow-hidden">{renderField(r.owner)}</TableCell>
                    <TableCell style={{ width: widths.product_area }} className="text-sm truncate overflow-hidden">{renderField(r.product_area)}</TableCell>
                    <TableCell style={{ width: widths.classification }} className="text-sm truncate overflow-hidden">{renderField(r.classification)}</TableCell>
                    <TableCell style={{ width: widths.tags }} className="text-xs overflow-hidden">
                      {r.tags && r.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {r.tags.map(t => (
                            <Badge key={t} variant="secondary" className="text-[10px] font-normal px-1.5 py-0">{t}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell style={{ width: widths.status }} className="text-xs truncate overflow-hidden">{r.status || "—"}</TableCell>
                    <TableCell style={{ width: widths.updated }} className="text-xs text-muted-foreground truncate overflow-hidden">
                      {r.intercom_updated_at ? formatDistanceToNow(new Date(r.intercom_updated_at), { addSuffix: true }) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base pr-6">{selected.subject || "(no subject)"}</SheetTitle>
                <SheetDescription className="text-xs">
                  Intercom #{selected.intercom_conversation_id}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4 text-sm">
                <Field label="Contact" value={selected.contact_name} sub={selected.contact_email} />
                <Field label="Owner" value={selected.owner} highlightMissing />
                <Field label="Product area" value={selected.product_area} highlightMissing />
                <Field label="Classification" value={selected.classification} highlightMissing />
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tags</div>
                  {selected.tags && selected.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selected.tags.map(t => (
                        <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">—</div>
                  )}
                </div>
                <Field label="Status" value={selected.status} />
                <Field
                  label="Created"
                  value={selected.intercom_created_at ? format(new Date(selected.intercom_created_at), "MMM d, yyyy HH:mm") : null}
                />
                <Field
                  label="Last updated"
                  value={selected.intercom_updated_at ? format(new Date(selected.intercom_updated_at), "MMM d, yyyy HH:mm") : null}
                />
                <Field
                  label="Last synced"
                  value={selected.last_synced_at ? format(new Date(selected.last_synced_at), "MMM d, yyyy HH:mm") : null}
                />

                <a
                  href={intercomUrl(selected.intercom_conversation_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline pt-2"
                >
                  View in Intercom <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
};

function FilterSelect({
  label, value, onChange, options, includeMissing = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  includeMissing?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[170px] text-xs">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}: any</SelectItem>
        {includeMissing && <SelectItem value={MISSING}>{label}: missing</SelectItem>}
        {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function MultiFilterSelect({
  label, values, onChange, options,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const toggle = (opt: string) => {
    if (values.includes(opt)) onChange(values.filter(v => v !== opt));
    else onChange([...values, opt]);
  };
  const summary = values.length === 0
    ? `${label}: any`
    : values.length === 1
    ? `${label}: ${values[0]}`
    : `${label}: ${values.length} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 w-[170px] justify-between text-xs font-normal">
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-50 ml-1 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-2" align="start">
        <div className="flex items-center justify-between mb-1 px-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {options.length === 0 ? (
            <div className="text-xs text-muted-foreground px-2 py-1">No options</div>
          ) : options.map(o => (
            <label
              key={o}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm"
            >
              <Checkbox checked={values.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, value, sub, highlightMissing }: { label: string; value: string | null; sub?: string | null; highlightMissing?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {value ? (
        <div className="text-foreground">{value}{sub && <div className="text-xs text-muted-foreground">{sub}</div>}</div>
      ) : highlightMissing ? (
        <div className="inline-flex items-center gap-1 text-amber-600 text-sm">
          <AlertCircle className="h-3.5 w-3.5" /> missing
        </div>
      ) : (
        <div className="text-muted-foreground">—</div>
      )}
    </div>
  );
}

type ExportFilters = {
  search: string;
  ownerFilter: string;
  productAreaFilter: string;
  classificationFilter: string;
  statusFilter: string[];
  tagsFilter: string[];
};

type Preset = "7d" | "14d" | "30d" | "this_month" | "last_month" | "custom";

const CSV_COLS: { header: string; get: (r: Ticket) => string }[] = [
  { header: "Intercom ID", get: r => r.intercom_conversation_id },
  { header: "Subject", get: r => r.subject || "" },
  { header: "Contact name", get: r => r.contact_name || "" },
  { header: "Contact email", get: r => r.contact_email || "" },
  { header: "Owner", get: r => r.owner || "" },
  { header: "Product area", get: r => r.product_area || "" },
  { header: "Classification", get: r => r.classification || "" },
  { header: "Tags", get: r => (r.tags || []).join("; ") },
  { header: "Status", get: r => r.status || "" },
  { header: "Created", get: r => r.intercom_created_at || "" },
  { header: "Updated", get: r => r.intercom_updated_at || "" },
];

function csvEscape(v: string) {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(rows: Ticket[]) {
  const lines = [CSV_COLS.map(c => csvEscape(c.header)).join(",")];
  for (const r of rows) lines.push(CSV_COLS.map(c => csvEscape(c.get(r))).join(","));
  return lines.join("\n");
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExportPopover({ filters }: { filters: ExportFilters }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("30d");
  const [from, setFrom] = useState<string>(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [busy, setBusy] = useState(false);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const now = new Date();
    const fmt = (d: Date) => format(d, "yyyy-MM-dd");
    if (p === "7d") { setFrom(fmt(subDays(now, 7))); setTo(fmt(now)); }
    else if (p === "14d") { setFrom(fmt(subDays(now, 14))); setTo(fmt(now)); }
    else if (p === "30d") { setFrom(fmt(subDays(now, 30))); setTo(fmt(now)); }
    else if (p === "this_month") { setFrom(fmt(startOfMonth(now))); setTo(fmt(now)); }
    else if (p === "last_month") {
      const lm = subMonths(now, 1);
      setFrom(fmt(startOfMonth(lm)));
      setTo(fmt(endOfMonth(lm)));
    }
    // custom: leave dates as-is
  };

  const run = async () => {
    if (!from || !to) {
      toast({ title: "Pick a date range", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fromIso = startOfDay(new Date(from + "T00:00:00")).toISOString();
      const toIso = endOfDay(new Date(to + "T00:00:00")).toISOString();
      const PAGE = 1000;
      let offset = 0;
      const all: Ticket[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q = supabase
          .from("inbox_v2_tickets")
          .select("*")
          .gte("intercom_created_at", fromIso)
          .lte("intercom_created_at", toIso)
          .order("intercom_created_at", { ascending: false })
          .range(offset, offset + PAGE - 1);

        if (filters.ownerFilter === MISSING) q = q.is("owner", null);
        else if (filters.ownerFilter !== ANY) q = q.eq("owner", filters.ownerFilter);
        if (filters.productAreaFilter === MISSING) q = q.is("product_area", null);
        else if (filters.productAreaFilter !== ANY) q = q.eq("product_area", filters.productAreaFilter);
        if (filters.classificationFilter === MISSING) q = q.is("classification", null);
        else if (filters.classificationFilter !== ANY) q = q.eq("classification", filters.classificationFilter);
        if (filters.statusFilter.length > 0) q = q.in("status", filters.statusFilter);

        const { data, error } = await q;
        if (error) throw error;
        const batch = (data || []) as Ticket[];
        all.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
      }

      // Tags + free-text search are filtered client-side (tags is text[]; search spans multiple cols).
      let rows = all;
      if (filters.tagsFilter.length > 0) {
        const wantEmpty = filters.tagsFilter.includes(NO_TAGS);
        const others = filters.tagsFilter.filter(t => t !== NO_TAGS);
        rows = rows.filter(r => {
          const t = r.tags || [];
          const matchEmpty = wantEmpty && t.length === 0;
          const matchTag = others.some(x => t.includes(x));
          return matchEmpty || matchTag;
        });
      }
      const sq = filters.search.trim().toLowerCase();
      if (sq) {
        rows = rows.filter(r => {
          const hay = [r.subject, r.contact_name, r.contact_email, r.intercom_conversation_id, ...(r.tags || [])]
            .filter(Boolean).join(" ").toLowerCase();
          return hay.includes(sq);
        });
      }

      const csv = toCsv(rows);
      const fname = `inbox-v2-${from}_to_${to}.csv`;
      triggerDownload(fname, csv);
      toast({ title: "Export complete", description: `Exported ${rows.length} tickets` });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-3" align="end">
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Preset</label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="14d">Last 14 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="last_month">Last month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">From</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }}
                className="h-8 text-xs mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">To</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPreset("custom"); }}
                className="h-8 text-xs mt-1"
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Filters by Intercom created date. Current screen filters (status, owner, tags, search) still apply.
          </p>
          <Button onClick={run} disabled={busy} size="sm" className="w-full h-8 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Export
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default InboxV2;
