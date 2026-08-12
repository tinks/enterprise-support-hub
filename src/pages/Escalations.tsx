import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, ExternalLink, Info, Check, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { IssueTable, type IssueColumn } from "@/components/issues/IssueTable";
import { idColumn, subjectColumn, contactColumn, customerColumn, ownerColumn, ageColumn } from "@/components/issues/issueColumns";
import { useCustomerLabels } from "@/hooks/useCustomerLabels";

type Ticket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
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

export default function Escalations() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [escalations, setEscalations] = useState<Map<string, Escalation>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"active" | "all" | HubState>("active");
  const [typeFilter, setTypeFilter] = useState(ANY);
  const [ownerFilter, setOwnerFilter] = useState(ANY);
  const [customerFilter, setCustomerFilter] = useState(ANY);

  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; field: "note" | "link" } | null>(null);

  const { accountLabel } = useCustomerLabels();

  const load = async () => {
    setLoading(true);
    const [t, e] = await Promise.all([
      supabase
        .from("intercom_tickets_v3")
        .select(
          "id,intercom_conversation_id,subject,contact_name,contact_email,owner,customer_key,customer_resolution_method,lifecycle_status,state,custom_attributes,intercom_created_at,last_synced_at",
        )
        .limit(2000),
      supabase.from("dev_escalations").select("*"),
    ]);
    if (!t.error) setTickets((t.data ?? []) as Ticket[]);
    if (!e.error) {
      const m = new Map<string, Escalation>();
      for (const row of (e.data ?? []) as Escalation[]) m.set(row.intercom_conversation_id, row);
      setEscalations(m);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    return tickets
      .filter((t) => {
        const tt = ticketType(t.custom_attributes);
        if (tt !== "Bug" && tt !== "Feature Request") return false;
        if (t.lifecycle_status === "transferred_out") return false;
        if (t.customer_resolution_method === "not_enterprise") return false;
        return true;
      })
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
          type: ticketType(t.custom_attributes) as "Bug" | "Feature Request",
          createdMs,
          ageDays: createdMs == null ? null : Math.floor((Date.now() - createdMs) / 86_400_000),
        };
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
          r.ticket.subject, r.ticket.contact_name, r.ticket.contact_email,
          r.ticket.intercom_conversation_id, r.linear.raw, r.esc?.note,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, stateFilter, typeFilter, ownerFilter, customerFilter]);

  const counts = useMemo(() => {
    const c: Record<HubState, number> = {
      open: 0, in_progress: 0, fix_shipped: 0, customer_notified: 0, wont_do: 0,
    };
    for (const r of rows) c[r.hubState] += 1;
    return c;
  }, [rows]);

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
      note: patch.note !== undefined ? patch.note : existing?.note ?? null,
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
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Dev escalations</h1>
              <Badge variant="outline" className="text-[10px]">Hub-owned state</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Intercom tickets typed <code className="text-xs">Bug</code> or <code className="text-xs">Feature Request</code>,
              tracked against their Linear escalation until the customer has been notified. Oldest first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {dataAsOf ? `Data as of ${format(new Date(dataAsOf), "HH:mm")}` : "—"}
            </span>
            <Button onClick={load} size="sm" variant="outline" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            The board state is independent of Intercom — a closed conversation stays here until it is marked
            <span className="font-medium text-foreground"> Customer notified</span> or <span className="font-medium text-foreground">Won't do</span>.
            Qualifying tickets appear automatically at <span className="font-medium text-foreground">Open</span>; nothing is
            written until you change a state, link, or note. Linear is link-only for now — issue title, state, and assignee
            stay blank until the Linear connector sync is added.
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {HUB_STATES.map((s) => (
            <div key={s} className={`rounded-md border px-3 py-1.5 text-xs ${HUB_META[s].pill}`}>
              <span className="font-semibold">{counts[s]}</span> {HUB_META[s].label}
            </div>
          ))}
          <div className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{filtered.length}</span> shown
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search subject, contact, Linear, note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[280px] text-xs"
          />
          <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
            <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">State: active only</SelectItem>
              <SelectItem value="all">State: all</SelectItem>
              {HUB_STATES.map((s) => <SelectItem key={s} value={s}>{HUB_META[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Type: any</SelectItem>
              <SelectItem value="Bug">Bug</SelectItem>
              <SelectItem value="Feature Request">Feature Request</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Owner: any</SelectItem>
              {ownerOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="h-9 w-[200px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Customer: any</SelectItem>
              {customerOpts.map((k) => <SelectItem key={k} value={k as string}>{accountLabel(k)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <IssueTable<EscalationRow>
          rows={filtered}
          columns={columns}
          getRowKey={(r) => r.ticket.id}
          loading={loading}
          emptyMessage="No escalations match these filters."
        />
      </div>
    </AppLayout>
  );
}
