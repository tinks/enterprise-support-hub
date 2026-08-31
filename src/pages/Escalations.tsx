import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, RefreshCw, ExternalLink, Info, Check, X, SlidersHorizontal } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { IssueDetailSheet, IssueField } from "@/components/issues/IssueDetailSheet";
import { displaySubject } from "@/lib/subjectDisplay";
import { idColumn, subjectColumn, customerColumn, ageColumn } from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";
import { useCanEdit } from "@/hooks/useCanEdit";
import { TicketNotes, fetchV3Notes, type TicketNote } from "@/components/issues/TicketNotes";


type Ticket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  subject_override: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: string | null;
  customer_key: string | null;
  customer_resolution_method: string | null;
  lifecycle_status: string | null;
  state: string | null;
  custom_attributes: any;
  intercom_created_at: string | null;
  last_synced_at: string | null;
};

type Escalation = {
  id: string;
  intercom_conversation_id: string;
  hub_state: string;
  linear_url_override: string | null;
  note: string | null;
  owner: string | null;
  state_changed_at: string | null;
  notified_at: string | null;
  linear_key: string | null;
  linear_title: string | null;
  linear_state: string | null;
  linear_assignee: string | null;
  linear_synced_at: string | null;
};

type EscalationRow = {
  ticket: Ticket;
  esc: Escalation | null;
  hubState: "open" | "in_progress" | "fix_shipped" | "customer_notified" | "wont_do";
  linear: { url: string | null; key: string | null; raw: string | null };
  /** True when a Linear issue is actually linked (a Slack permalink does not count). */
  hasLinear: boolean;
  type: "Bug" | "Feature Request";
  createdMs: number | null;
};


const ANY = "__any__";

const HUB_STATES = ["open", "in_progress", "fix_shipped", "customer_notified", "wont_do"] as const;
type HubState = (typeof HUB_STATES)[number];

const HUB_META: Record<HubState, { label: string; pill: string }> = {
  open: { label: "Open", pill: "bg-destructive/15 text-destructive border-destructive/40" },
  in_progress: { label: "In progress", pill: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" },
  fix_shipped: { label: "Fix shipped", pill: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40" },
  customer_notified: { label: "Customer notified", pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40" },
  wont_do: { label: "Won't do", pill: "bg-muted text-muted-foreground border-border" },
};

const TERMINAL: HubState[] = ["customer_notified", "wont_do"];

type Queue = "needs_linear" | "linked" | "all";

/** Resolve a Linear link from the Hub override first, then the Intercom attributes. */
function resolveLinear(attrs: any, override: string | null): { url: string | null; key: string | null; raw: string | null } {
  const candidates = [override, attrs?.["Linear Issue"], attrs?.["Escalated Issue"]]
    .map((v) => (v == null ? null : String(v).trim()))
    .filter((v): v is string => !!v);

  for (const c of candidates) {
    // Full Linear URL
    const m = c.match(/https?:\/\/linear\.app\/[^\s]+/i);
    if (m) {
      const keyMatch = m[0].match(/\/issue\/([A-Za-z0-9]+-\d+)/);
      return { url: m[0], key: keyMatch ? keyMatch[1] : null, raw: c };
    }
    // Bare issue key e.g. ENG-1234
    const k = c.match(/^([A-Za-z][A-Za-z0-9]*-\d+)$/);
    if (k) return { url: `https://linear.app/issue/${k[1]}`, key: k[1], raw: c };
  }
  // Non-Linear reference (e.g. a Slack permalink) — surface it as-is, unlinked to Linear.
  const first = candidates[0] ?? null;
  return { url: null, key: null, raw: first };
}

function ticketType(attrs: any): string | null {
  const v = attrs?.["Ticket type"];
  return v == null ? null : String(v).trim();
}

/** Ticket types that are escalation candidates on their own. */
const ESCALATION_TYPES = ["Bug", "Feature Request", "Issue", "Incident"];

/**
 * Board population gate — shared by the row build and the batched notes prefetch
 * so the two can never drift. A ticket qualifies when its type is an escalation
 * type, OR it already carries any Linear/Escalated Issue reference (any type).
 */
function qualifies(t: Ticket, override: string | null): boolean {
  if (t.lifecycle_status === "transferred_out") return false;
  if (t.customer_resolution_method === "not_enterprise") return false;
  const tt = ticketType(t.custom_attributes);
  if (tt && ESCALATION_TYPES.includes(tt)) return true;
  return !!resolveLinear(t.custom_attributes, override).raw;
}

export default function Escalations() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [escalations, setEscalations] = useState<Map<string, Escalation>>(new Map());
  const [notes, setNotes] = useState<Map<string, TicketNote[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [syncingLinear, setSyncingLinear] = useState(false);
  const { canEdit } = useCanEdit();

  const [queue, setQueue] = useState<Queue>("needs_linear");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"active" | "all" | HubState>("active");
  const [typeFilter, setTypeFilter] = useState(ANY);
  const [ownerFilter, setOwnerFilter] = useState(ANY);
  const [customerFilter, setCustomerFilter] = useState(ANY);

  const [detail, setDetail] = useState<EscalationRow | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [editingLink, setEditingLink] = useState(false);

  const { accountLabel } = useCustomerLabels();

  const load = async () => {
    setLoading(true);
    const [t, e] = await Promise.all([
      supabase
        .from("intercom_tickets_v3")
        .select(
          "id,intercom_conversation_id,subject,subject_override,contact_name,contact_email,owner,customer_key,customer_resolution_method,lifecycle_status,state,custom_attributes,intercom_created_at,last_synced_at",
        )
        .limit(2000),
      supabase.from("dev_escalations").select("*"),
    ]);
    const loaded = (t.error ? [] : ((t.data ?? []) as Ticket[]));
    if (!t.error) setTickets(loaded);
    const escMap = new Map<string, Escalation>();
    if (!e.error) {
      for (const row of (e.data ?? []) as Escalation[]) escMap.set(row.intercom_conversation_id, row);
      setEscalations(escMap);
    }
    // Notes for the qualifying population, batched — the detail sheet opens with
    // them already present and search can index them.
    const qualifying = loaded
      .filter((x) => qualifies(x, escMap.get(x.intercom_conversation_id)?.linear_url_override ?? null))
      .map((x) => x.id);
    setNotes(await fetchV3Notes(qualifying));
    setLoading(false);
  };

  /** Pull Linear issue title/state/assignee onto the board. Read-only in Linear. */
  const syncLinear = async () => {
    setSyncingLinear(true);
    const { data, error } = await supabase.functions.invoke("sync-linear-escalations");
    setSyncingLinear(false);
    if (error) {
      toast.error("Linear sync failed", { description: error.message });
      return;
    }
    const d = data as { resolved?: number; not_found?: string[]; rows_written?: number };
    toast.success(`Linear sync: ${d?.resolved ?? 0} issue(s) refreshed`, {
      description:
        d?.not_found && d.not_found.length > 0
          ? `Not found in Linear: ${d.not_found.slice(0, 5).join(", ")}`
          : undefined,
    });
    await load();
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    return tickets
      .filter((t) =>
        qualifies(t, escalations.get(t.intercom_conversation_id)?.linear_url_override ?? null),
      )
      .map((t) => {
        const esc = escalations.get(t.intercom_conversation_id) ?? null;
        const hubState = (esc?.hub_state ?? "open") as HubState;
        const linear = resolveLinear(t.custom_attributes, esc?.linear_url_override ?? null);
        const createdMs = t.intercom_created_at ? new Date(t.intercom_created_at).getTime() : null;
        return {
          ticket: t,
          esc,
          hubState,
          linear,
          hasLinear: !!linear.url,
          type: ticketType(t.custom_attributes) as "Bug" | "Feature Request",
          createdMs,
        } as EscalationRow;
      })
      .sort((a, b) => (a.createdMs ?? 0) - (b.createdMs ?? 0));
  }, [tickets, escalations]);

  const ownerOpts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.ticket.owner).filter(Boolean))).sort() as string[],
    [rows],
  );
  const customerOpts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.ticket.customer_key).filter(Boolean))).sort() as string[],
    [rows],
  );

  /** Everything except the queue split — so each queue's count reflects the filters. */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter === "active" && TERMINAL.includes(r.hubState)) return false;
      if (stateFilter !== "active" && stateFilter !== "all" && r.hubState !== stateFilter) return false;
      if (typeFilter !== ANY && r.type !== typeFilter) return false;
      if (ownerFilter !== ANY && r.ticket.owner !== ownerFilter) return false;
      if (customerFilter !== ANY && r.ticket.customer_key !== customerFilter) return false;
      if (q) {
        const hay = [
          displaySubject(r.ticket), r.ticket.subject, r.ticket.contact_name, r.ticket.contact_email,
          r.ticket.intercom_conversation_id, r.linear.raw,
          ...(notes.get(r.ticket.id) ?? []).map((n) => n.note_text),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, stateFilter, typeFilter, ownerFilter, customerFilter, notes]);

  const needsLinear = useMemo(() => filtered.filter((r) => !r.hasLinear), [filtered]);
  const linked = useMemo(() => filtered.filter((r) => r.hasLinear), [filtered]);
  const visible = queue === "needs_linear" ? needsLinear : queue === "linked" ? linked : filtered;

  const dataAsOf = useMemo(() => {
    let newest: number | null = null;
    for (const t of tickets) {
      if (!t.last_synced_at) continue;
      const ms = new Date(t.last_synced_at).getTime();
      if (newest == null || ms > newest) newest = ms;
    }
    return newest;
  }, [tickets]);

  const upsert = async (conversationId: string, patch: Partial<Escalation>) => {
    setSaving(conversationId);
    const existing = escalations.get(conversationId);
    const payload = {
      intercom_conversation_id: conversationId,
      hub_state: patch.hub_state ?? existing?.hub_state ?? "open",
      linear_url_override:
        patch.linear_url_override !== undefined ? patch.linear_url_override : existing?.linear_url_override ?? null,
      ...(patch.hub_state ? { state_changed_at: new Date().toISOString() } : {}),
      ...(patch.hub_state === "customer_notified" ? { notified_at: new Date().toISOString() } : {}),
    };
    const { data, error } = await supabase
      .from("dev_escalations")
      .upsert(payload, { onConflict: "intercom_conversation_id" })
      .select()
      .single();
    setSaving(null);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    setEscalations((prev) => {
      const next = new Map(prev);
      next.set(conversationId, data as Escalation);
      return next;
    });
    setDetail((d) =>
      d && d.ticket.intercom_conversation_id === conversationId
        ? { ...d, esc: data as Escalation, hubState: (data as Escalation).hub_state as HubState }
        : d,
    );
  };

  const hubSelect = (r: EscalationRow, className = "h-7 text-xs") => (
    <Select
      value={r.hubState}
      onValueChange={(v) => upsert(r.ticket.intercom_conversation_id, { hub_state: v as HubState })}
      disabled={!canEdit || saving === r.ticket.intercom_conversation_id}
    >
      <SelectTrigger className={`${className} border ${HUB_META[r.hubState].pill}`} onClick={(e) => e.stopPropagation()}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HUB_STATES.map((s) => <SelectItem key={s} value={s}>{HUB_META[s].label}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const columns: IssueColumn<EscalationRow>[] = [
    idColumn<EscalationRow>((r) => r.ticket.intercom_conversation_id),
    subjectColumn<EscalationRow>((r) => displaySubject(r.ticket), undefined, {
      conversationId: (r) => r.ticket.intercom_conversation_id,
      subjectRow: (r) => r.ticket,
      onSaved: (r, next) =>
        setTickets((prev) =>
          prev.map((x) => (x.id === r.ticket.id ? { ...x, subject_override: next } : x)),
        ),
    }),
    customerColumn<EscalationRow>((r) => r.ticket.customer_key, accountLabel),
    {
      key: "type",
      header: "Type",
      width: "w-[120px]",
      cell: (r) => (
        <Badge variant={r.type === "Bug" ? "destructive" : "secondary"} className="text-[10px]">{r.type}</Badge>
      ),
    },
    {
      key: "linear",
      header: "Linear",
      width: "w-[190px]",
      cellClassName: "text-xs",
      cell: (r) => {
        if (r.linear.url) {
          return (
            <div className="min-w-0">
              <a
                href={r.linear.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:underline"
              >
                {r.linear.key ?? "Linear issue"}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              {r.esc?.linear_synced_at && r.esc?.linear_key === r.linear.key && (
                <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                  {r.esc.linear_state || "—"}
                  {r.esc.linear_assignee ? ` · ${r.esc.linear_assignee}` : ""}
                </div>
              )}
            </div>
          );
        }
        if (r.linear.raw) {
          return <span className="text-muted-foreground truncate block max-w-[170px]" title={r.linear.raw}>{r.linear.raw}</span>;
        }
        return <span className="text-destructive">Missing</span>;
      },
    },
    {
      key: "hub_state",
      header: "Hub state",
      width: "w-[180px]",
      cell: (r) => <div onClick={(e) => e.stopPropagation()}>{hubSelect(r)}</div>,
    },
    ageColumn<EscalationRow>((r) => r.createdMs),
  ];

  const detailNotes = detail ? notes.get(detail.ticket.id) ?? [] : [];

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Dev escalations</h1>
              <Badge variant="outline" className="text-[10px]">Hub-owned state</Badge>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground">
                    <Info className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[380px] text-xs text-muted-foreground space-y-2">
                  <p>
                    Intercom tickets typed <code>Bug</code> or <code>Feature Request</code>, tracked against their Linear
                    escalation until the customer has been notified. Oldest first.
                  </p>
                  <p>
                    Board state is independent of Intercom — a closed conversation stays here until it is marked
                    <span className="font-medium text-foreground"> Customer notified</span> or
                    <span className="font-medium text-foreground"> Won't do</span>. Qualifying tickets appear automatically
                    at <span className="font-medium text-foreground">Open</span>.
                  </p>
                  <p>
                    Linear title, state and assignee are mirrored read-only once a day (and on demand via
                    <span className="font-medium text-foreground"> Sync Linear</span>) — Linear is never written to from the Hub.
                  </p>
                  <p>
                    Notes are stored on the ticket itself, so they stay visible wherever the ticket is opened.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-sm text-muted-foreground">
              Which escalations still need a Linear issue, and where the linked ones stand.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {dataAsOf ? `Data as of ${format(new Date(dataAsOf), "HH:mm")}` : "—"}
            </span>
            {canEdit && (
              <Button onClick={syncLinear} size="sm" variant="outline" disabled={syncingLinear}>
                {syncingLinear ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Sync Linear
              </Button>
            )}
            <Button onClick={load} size="sm" variant="outline" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {([
              ["needs_linear", "Needs Linear", needsLinear.length],
              ["linked", "Linked", linked.length],
              ["all", "All", filtered.length],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setQueue(key)}
                className={`px-3 py-1.5 text-xs border-r border-border last:border-r-0 ${
                  queue === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {label} · <span className="font-semibold">{count}</span>
              </button>
            ))}
          </div>

          <Input
            placeholder="Search subject, contact, Intercom ID, Linear, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[300px] text-xs"
          />
          <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
            <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">State: active only</SelectItem>
              <SelectItem value="all">State: all</SelectItem>
              {HUB_STATES.map((s) => <SelectItem key={s} value={s}>{HUB_META[s].label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                More filters
                {[typeFilter, ownerFilter, customerFilter].filter((v) => v !== ANY).length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    {[typeFilter, ownerFilter, customerFilter].filter((v) => v !== ANY).length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] space-y-2">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Type: any</SelectItem>
                  <SelectItem value="Bug">Bug</SelectItem>
                  <SelectItem value="Feature Request">Feature Request</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Owner: any</SelectItem>
                  {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Customer: any</SelectItem>
                  {customerOpts.map((k) => <SelectItem key={k} value={k as string}>{accountLabel(k)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => { setTypeFilter(ANY); setOwnerFilter(ANY); setCustomerFilter(ANY); }}
              >
                Clear
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        {queue === "needs_linear" && (
          <p className="text-xs text-muted-foreground">
            Every bug and feature request should have a Linear issue. These do not — link one from the row detail.
          </p>
        )}

        <IssueTable<EscalationRow>
          rows={visible}
          columns={columns}
          getRowKey={(r) => r.ticket.id}
          loading={loading}
          emptyMessage={
            queue === "needs_linear"
              ? "Every escalation in scope has a Linear issue."
              : "No escalations match these filters."
          }
          onRowClick={(r) => { setDetail(r); setEditingLink(false); setLinkDraft(r.esc?.linear_url_override ?? ""); }}
        />
      </div>

      <IssueDetailSheet
        open={!!detail}
        onOpenChange={(o) => { if (!o) setDetail(null); }}
        title={detail ? displaySubject(detail.ticket) : ""}
        conversationId={detail?.ticket.intercom_conversation_id ?? null}
      >
        {detail && (
          <>
            <IssueField label="Type" value={detail.type} />
            <IssueField label="Contact" value={detail.ticket.contact_name} />
            <IssueField label="Email" value={detail.ticket.contact_email} />
            <IssueField label="Customer" value={accountLabel(detail.ticket.customer_key)} />
            <IssueField label="Owner" value={detail.ticket.owner} />
            <IssueField
              label="Intercom state"
              value={
                detail.ticket.lifecycle_status === "finalized"
                  ? "Closed"
                  : detail.ticket.state || detail.ticket.lifecycle_status || "—"
              }
            />
            <IssueField
              label="Created"
              value={detail.createdMs ? format(new Date(detail.createdMs), "d MMM yyyy HH:mm") : "—"}
            />

            <div className="pt-2 border-t border-border" />

            <IssueField
              label="Hub state"
              value={<div className="w-[200px]">{hubSelect(detail, "h-8 text-xs")}</div>}
            />
            <IssueField
              label="Linear issue"
              value={
                editingLink ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      className="h-8 text-xs"
                      placeholder="Linear URL or KEY-123"
                      value={linkDraft}
                      onChange={(e) => setLinkDraft(e.target.value)}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      disabled={saving === detail.ticket.intercom_conversation_id}
                      onClick={async () => {
                        await upsert(detail.ticket.intercom_conversation_id, {
                          linear_url_override: linkDraft.trim() || null,
                        });
                        setEditingLink(false);
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingLink(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {detail.linear.url ? (
                      <a href={detail.linear.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                        {detail.linear.key ?? "Linear issue"} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : detail.linear.raw ? (
                      <span className="text-muted-foreground break-all">{detail.linear.raw}</span>
                    ) : (
                      <span className="text-destructive">Missing</span>
                    )}
                    {canEdit && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditingLink(true)}>
                        {detail.esc?.linear_url_override ? "Edit link" : "Link"}
                      </Button>
                    )}
                  </div>
                )
              }
            />
            {detail.esc?.linear_synced_at && detail.esc?.linear_key === detail.linear.key && (
              <>
                <IssueField label="Linear title" value={detail.esc.linear_title} />
                <IssueField label="Linear state" value={detail.esc.linear_state} />
                <IssueField label="Linear assignee" value={detail.esc.linear_assignee} />
                <IssueField
                  label="Linear synced"
                  value={format(new Date(detail.esc.linear_synced_at), "d MMM yyyy HH:mm")}
                />
              </>
            )}

            <div className="pt-3 border-t border-border">
              <div className="text-xs text-muted-foreground mb-2">Notes</div>
              <TicketNotes
                ticketId={detail.ticket.id}
                initialNotes={detailNotes}
                canEdit={canEdit}
                onChange={(next) =>
                  setNotes((prev) => {
                    const m = new Map(prev);
                    m.set(detail.ticket.id, next);
                    return m;
                  })
                }
              />
            </div>
          </>
        )}
      </IssueDetailSheet>
    </AppLayout>
  );
}
