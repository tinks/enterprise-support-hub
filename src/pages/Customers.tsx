import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, Users, RefreshCw, ChevronDown, ChevronRight, ExternalLink,
  Building2, Hash, Ban, Shield, AlertTriangle, Plus, Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { format } from "date-fns";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";

const sb = supabase as any;

type Coverage = {
  total_tickets: number;
  attributed: number;
  unattributed: number;
  orphan_overrides: number;
  pct_attributed: number;
  m_override: number;
  m_orphan_override: number;
  m_slack_channel: number;
  m_domain: number;
  m_workspace_id: number;
  m_unresolved: number;
};

type Snapshot = {
  snapshot_date: string;
  total_tickets: number;
  attributed: number;
  unattributed: number;
  pct_attributed: number;
  m_override: number;
  m_orphan_override: number | null;
  m_slack_channel: number;
  m_domain: number;
  m_workspace_id: number;
  m_unresolved: number;
};

type GroupRow = {
  group_kind: "domain" | "channel" | "workspace" | "no_signal";
  group_key: string;
  display_name: string | null;
  ticket_count: number;
};

type AccountOpt = {
  account_key: string;
  label: string;
  domains: string[];
  aliases?: string[] | null;
  tier?: string | null;
  csm_owner?: string | null;
  status?: string | null;
  notes?: string | null;
};

type UnTicket = {
  id: string;
  intercom_conversation_id: string;
  subject: string | null;
  contact_email: string | null;
  contact_domain: string | null;
  slack_channel_id_detected: string | null;
  workspace_id_detected: string | null;
  intercom_created_at: string | null;
};

type ChannelRow = {
  slack_channel_id: string;
  channel_name: string | null;
  ticket_count: number;
  status: "mapped" | "internal" | "unmapped";
  account_key: string | null;
  account_label: string | null;
};

type WorkspaceMapRow = {
  workspace_id: string;
  account_key: string;
  workspace_name: string | null;
  tier: string | null;
  source: string | null;
};

type InternalChannelRow = {
  slack_channel_id: string;
  channel_name: string | null;
  note: string | null;
};

type OrphanRow = { customer_key: string; ticket_count: number };

type OrphanSuggestion = {
  orphan_key: string;
  ticket_count: number;
  suggested_account_key: string | null;
  suggested_label: string | null;
  match_kind: "exact_normalized" | "fuzzy" | "none";
};

type ChannelProposal = {
  slack_channel_id: string;
  channel_name: string | null;
  proposed_account_key: string;
  account_label: string;
  evidence: string;
  confidence: "high" | "medium";
  ticket_count: number;
};

function intercomUrl(id: string) {
  return `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function channelLabel(id: string, name: string | null) {
  return name ? `#${name} (${id})` : id;
}

export default function Customers() {
  const { isAdmin } = useIsAdmin();
  const [tab, setTab] = useState<"coverage" | "unattributed" | "channels" | "registry">("coverage");

  return (
    <AppLayout>
      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Customers</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Customer attribution coverage and reclaim queue for v3 tickets.
        </p>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="coverage">Coverage</TabsTrigger>
            <TabsTrigger value="unattributed">Unattributed queue</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="registry">Registry</TabsTrigger>
          </TabsList>
          <TabsContent value="coverage" className="pt-4"><CoverageTab isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="unattributed" className="pt-4"><UnattributedTab isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="channels" className="pt-4"><ChannelsTab isAdmin={isAdmin} /></TabsContent>
          <TabsContent value="registry" className="pt-4"><RegistryTab isAdmin={isAdmin} /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

/* ---------------- Coverage tab ---------------- */

function CoverageTab({ isAdmin }: { isAdmin: boolean }) {
  const [cov, setCov] = useState<Coverage | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapping, setSnapping] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: c, error: e1 }, { data: s, error: e2 }] = await Promise.all([
      sb.rpc("v3_coverage_current"),
      sb.from("v3_coverage_snapshots").select("*").order("snapshot_date", { ascending: true }),
    ]);
    if (e1) { console.error("v3_coverage_current failed", e1); toast.error("Failed to load coverage"); }
    if (e2) { console.error("snapshots load failed", e2); }
    setCov(Array.isArray(c) ? c[0] : c);
    setSnaps((s ?? []) as Snapshot[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const snapshotNow = async () => {
    setSnapping(true);
    const { error } = await sb.rpc("v3_capture_coverage_snapshot");
    setSnapping(false);
    if (error) { console.error(error); toast.error("Snapshot failed: " + error.message); return; }
    toast.success("Snapshot recorded");
    load();
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!cov) return <p className="text-sm text-muted-foreground">No data.</p>;

  const chartData = snaps.map(s => ({ date: s.snapshot_date, pct: Number(s.pct_attributed) }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Verified attributed</CardDescription>
            <CardTitle className="text-3xl">{Number(cov.pct_attributed).toFixed(1)}%</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {cov.attributed} of {cov.total_tickets} → known registry account
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unattributed</CardDescription>
            <CardTitle className="text-3xl">{cov.unattributed}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Awaiting reclaim</CardContent>
        </Card>
        <Card className={cov.orphan_overrides > 0 ? "border-yellow-500/40 bg-yellow-500/5" : ""}>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              {cov.orphan_overrides > 0 && <AlertTriangle className="h-3 w-3 text-yellow-600" />}
              Orphan overrides
            </CardDescription>
            <CardTitle className="text-3xl">{cov.orphan_overrides}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Overrides pointing at a missing account_key
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Actions</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            <Button size="sm" variant="outline" onClick={load} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={snapshotNow} disabled={snapping} className="w-full">
                {snapping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Snapshot now
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Method distribution</CardTitle>
          <CardDescription>
            How verified-attributed tickets were resolved. Orphan overrides are counted separately — they resolve to
            an account_key that no longer exists in the registry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Bucket label="Override (verified)" value={cov.m_override} />
            <Bucket label="Orphan / needs reconciliation" value={cov.m_orphan_override} tone="warn" />
            <Bucket label="Slack channel" value={cov.m_slack_channel} />
            <Bucket label="Domain" value={cov.m_domain} />
            <Bucket label="Workspace ID" value={cov.m_workspace_id} />
            <Bucket label="Unresolved" value={cov.m_unresolved} tone="warn" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verified coverage trend</CardTitle>
          <CardDescription>Daily snapshot of % verified-attributed. Auto-captured at 06:00 UTC.</CardDescription>
        </CardHeader>
        <CardContent style={{ height: 280 }}>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <RTooltip formatter={(v: any) => `${v}%`} />
                <Line type="monotone" dataKey="pct" stroke="hsl(var(--primary))" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "warn" ? "border-yellow-500/40 bg-yellow-500/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

/* ---------------- Unattributed tab ---------------- */

function UnattributedTab({ isAdmin }: { isAdmin: boolean }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedTickets, setExpandedTickets] = useState<Record<string, UnTicket[]>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [dialog, setDialog] = useState<null | { kind: string; group?: GroupRow; ticketIds?: string[] }>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: g, error: e1 }, { data: a, error: e2 }] = await Promise.all([
      sb.rpc("v3_unattributed_groups"),
      sb.from("v3_customer_accounts").select("account_key,label,domains").order("label"),
    ]);
    if (e1) { console.error(e1); toast.error("Failed to load groups"); }
    if (e2) { console.error(e2); }
    setGroups((g ?? []) as GroupRow[]);
    setAccounts((a ?? []) as AccountOpt[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const groupId = (g: GroupRow) => `${g.group_kind}::${g.group_key}`;

  const loadTickets = async (g: GroupRow) => {
    const gid = groupId(g);
    if (expandedTickets[gid]) return;
    let q = sb.from("intercom_tickets_v3")
      .select("id,intercom_conversation_id,subject,contact_email,contact_domain,slack_channel_id_detected,workspace_id_detected,intercom_created_at")
      .eq("customer_key", "unattributed")
      .order("intercom_created_at", { ascending: false })
      .limit(500);
    if (g.group_kind === "domain") q = q.eq("contact_domain", g.group_key);
    else if (g.group_kind === "channel") q = q.eq("slack_channel_id_detected", g.group_key);
    else if (g.group_kind === "workspace") q = q.eq("workspace_id_detected", g.group_key);
    const { data, error } = await q;
    if (error) { console.error(error); toast.error("Failed to load tickets"); return; }
    let rows = (data ?? []) as UnTicket[];
    if (g.group_kind === "no_signal") {
      const domSet = new Set(accounts.flatMap(a => a.domains));
      rows = rows.filter(r => {
        const hasDomain = r.contact_domain && r.contact_domain !== "" && r.contact_domain !== "lovable.dev" && !domSet.has(r.contact_domain);
        const hasChan = !!r.slack_channel_id_detected;
        const hasWs = !!r.workspace_id_detected;
        return !hasDomain && !hasChan && !hasWs;
      });
    }
    setExpandedTickets(prev => ({ ...prev, [gid]: rows }));
  };

  const toggle = async (g: GroupRow) => {
    const gid = groupId(g);
    if (expanded === gid) { setExpanded(null); return; }
    setExpanded(gid);
    await loadTickets(g);
  };

  const toggleSelect = (gid: string, tid: string) => {
    setSelected(prev => {
      const cur = new Set(prev[gid] ?? []);
      if (cur.has(tid)) cur.delete(tid); else cur.add(tid);
      return { ...prev, [gid]: cur };
    });
  };

  const iconFor = (kind: GroupRow["group_kind"]) => {
    if (kind === "domain") return <Building2 className="h-4 w-4" />;
    if (kind === "channel") return <Hash className="h-4 w-4" />;
    if (kind === "workspace") return <Shield className="h-4 w-4" />;
    return <Ban className="h-4 w-4" />;
  };

  const groupActions = (g: GroupRow) => {
    if (!isAdmin) return null;
    if (g.group_kind === "domain") {
      return (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "domain-new", group: g })}>Add account</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "domain-attach", group: g })}>Attach to existing</Button>
        </div>
      );
    }
    if (g.group_kind === "channel") {
      return (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "channel-map", group: g })}>Map to account</Button>
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "channel-internal", group: g })}>Mark internal</Button>
        </div>
      );
    }
    if (g.group_kind === "workspace") {
      return <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "workspace-seed", group: g })}>Seed to account</Button>;
    }
    return null;
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;

  const total = groups.reduce((a, g) => a + g.ticket_count, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total} unattributed ticket{total === 1 ? "" : "s"} in {groups.length} group{groups.length === 1 ? "" : "s"}.
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(g => {
                const gid = groupId(g);
                const open = expanded === gid;
                const tickets = expandedTickets[gid] ?? [];
                const sel = selected[gid] ?? new Set<string>();
                const signalLabel = g.group_kind === "channel"
                  ? channelLabel(g.group_key, g.display_name)
                  : (g.group_key || "");
                return (
                  <>
                    <TableRow key={gid} className="cursor-pointer" onClick={() => toggle(g)}>
                      <TableCell>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {iconFor(g.group_kind)}
                          <Badge variant="outline">{g.group_kind}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {signalLabel || <span className="text-muted-foreground italic">no signal</span>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{g.ticket_count}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>{groupActions(g)}</TableCell>
                    </TableRow>
                    {open && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30">
                          {tickets.length === 0 ? (
                            <p className="text-sm text-muted-foreground p-3">Loading…</p>
                          ) : (
                            <div className="space-y-2 p-2">
                              {sel.size > 0 && (
                                <div className="flex items-center gap-2 p-2 rounded-md border bg-background">
                                  <span className="text-sm">{sel.size} selected</span>
                                  <Button size="sm" onClick={() => setDialog({ kind: "bulk-assign", ticketIds: Array.from(sel) })}>
                                    Assign to account
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setSelected(p => ({ ...p, [gid]: new Set() }))}>Clear</Button>
                                </div>
                              )}
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-8"></TableHead>
                                    <TableHead>Subject</TableHead>
                                    <TableHead>Contact</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {tickets.map(t => (
                                    <TableRow key={t.id}>
                                      <TableCell>
                                        <Checkbox checked={sel.has(t.id)} onCheckedChange={() => toggleSelect(gid, t.id)} />
                                      </TableCell>
                                      <TableCell className="max-w-md truncate">{t.subject || "—"}</TableCell>
                                      <TableCell className="text-xs">{t.contact_email || "—"}</TableCell>
                                      <TableCell className="text-xs">{t.intercom_created_at ? format(new Date(t.intercom_created_at), "yyyy-MM-dd") : "—"}</TableCell>
                                      <TableCell className="flex gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "ticket-assign", ticketIds: [t.id] })}>Assign</Button>
                                        <a href={intercomUrl(t.intercom_conversation_id)} target="_blank" rel="noreferrer">
                                          <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button>
                                        </a>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
              {groups.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nothing unattributed. 🎉</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ActionDialog
        state={dialog}
        accounts={accounts}
        onClose={() => setDialog(null)}
        onDone={() => { setDialog(null); setSelected({}); setExpandedTickets({}); load(); }}
      />
    </div>
  );
}

/* ---------------- Channels tab ---------------- */

function ChannelsTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<null | { kind: "map" | "internal"; row: ChannelRow }>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: r, error: e1 }, { data: a }] = await Promise.all([
      sb.rpc("v3_channels_usage"),
      sb.from("v3_customer_accounts").select("account_key,label,domains").order("label"),
    ]);
    if (e1) { console.error(e1); toast.error("Failed to load channels"); }
    setRows((r ?? []) as ChannelRow[]);
    setAccounts((a ?? []) as AccountOpt[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const unmap = async (row: ChannelRow) => {
    if (!confirm(`Unmap ${channelLabel(row.slack_channel_id, row.channel_name)} from ${row.account_label}? Tickets will re-attribute.`)) return;
    const { error } = await sb.from("v3_channel_account_map").delete().eq("slack_channel_id", row.slack_channel_id);
    if (error) { toast.error(error.message); return; }
    toast.success("Unmapped");
    load();
  };

  const unmarkInternal = async (row: ChannelRow) => {
    if (!confirm(`Unmark ${channelLabel(row.slack_channel_id, row.channel_name)} as internal?`)) return;
    const { error } = await sb.from("v3_internal_channels").delete().eq("slack_channel_id", row.slack_channel_id);
    if (error) { toast.error(error.message); return; }
    toast.success("Unmarked");
    load();
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;

  const unmapped = rows.filter(r => r.status === "unmapped").length;
  const mapped = rows.filter(r => r.status === "mapped").length;
  const internal = rows.filter(r => r.status === "internal").length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Total customer channels" value={rows.length} />
        <StatCard label="Mapped" value={mapped} />
        <StatCard label="Internal" value={internal} />
        <StatCard label="Unmapped" value={unmapped} tone={unmapped > 0 ? "warn" : undefined} />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.slack_channel_id}>
                  <TableCell className="font-mono text-xs">{channelLabel(r.slack_channel_id, r.channel_name)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "unmapped" ? "outline" : "secondary"}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>{r.account_label || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right font-semibold">{r.ticket_count}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <div className="flex gap-2">
                        {r.status === "unmapped" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "map", row: r })}>Map</Button>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "internal", row: r })}>Mark internal</Button>
                          </>
                        )}
                        {r.status === "mapped" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "map", row: r })}>Remap</Button>
                            <Button size="sm" variant="ghost" onClick={() => unmap(r)}><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                        {r.status === "internal" && (
                          <Button size="sm" variant="ghost" onClick={() => unmarkInternal(r)}>Unmark</Button>
                        )}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">read-only</span>}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No customer channels detected.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialog && (
        <ChannelDialog
          state={dialog}
          accounts={accounts}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}

function ChannelDialog({ state, accounts, onClose, onDone }: {
  state: { kind: "map" | "internal"; row: ChannelRow };
  accounts: AccountOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [accountKey, setAccountKey] = useState(state.row.account_key ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const run = async () => {
    setSaving(true);
    try {
      if (state.kind === "map") {
        if (!accountKey) throw new Error("Pick an account");
        const { error } = await sb.from("v3_channel_account_map").upsert({
          slack_channel_id: state.row.slack_channel_id, account_key: accountKey,
        }, { onConflict: "slack_channel_id" });
        if (error) throw error;
        toast.success("Channel mapped");
      } else {
        const { error } = await sb.from("v3_internal_channels").insert({
          slack_channel_id: state.row.slack_channel_id,
          channel_name: state.row.channel_name,
          note: note || null,
        });
        if (error) throw error;
        toast.success("Channel marked internal");
      }
      onDone();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.kind === "map" ? "Map channel to account" : "Mark channel internal"}
          </DialogTitle>
          <DialogDescription>
            {channelLabel(state.row.slack_channel_id, state.row.channel_name)} · {state.row.ticket_count} tickets
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {state.kind === "map" ? (
            <div className="space-y-1">
              <Label>Account</Label>
              <Select value={accountKey} onValueChange={setAccountKey}>
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <Card className={tone === "warn" ? "border-yellow-500/40 bg-yellow-500/5" : ""}>
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader>
    </Card>
  );
}

/* ---------------- Registry tab ---------------- */

function RegistryTab({ isAdmin }: { isAdmin: boolean }) {
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [workspaces, setWorkspaces] = useState<WorkspaceMapRow[]>([]);
  const [internals, setInternals] = useState<InternalChannelRow[]>([]);
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AccountOpt | null>(null);
  const [creating, setCreating] = useState(false);
  const [wsDialog, setWsDialog] = useState(false);
  const [icDialog, setIcDialog] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: a }, { data: u }, { data: w }, { data: i }, { data: o }] = await Promise.all([
      sb.from("v3_customer_accounts").select("*").order("label"),
      sb.rpc("v3_accounts_usage"),
      sb.from("v3_workspace_customer_map").select("*").order("workspace_id"),
      sb.from("v3_internal_channels").select("slack_channel_id,channel_name,note").order("channel_name"),
      sb.rpc("v3_orphan_overrides"),
    ]);
    setAccounts((a ?? []) as AccountOpt[]);
    const cmap: Record<string, number> = {};
    for (const row of (u ?? []) as { account_key: string; ticket_count: number }[]) cmap[row.account_key] = row.ticket_count;
    setCounts(cmap);
    setWorkspaces((w ?? []) as WorkspaceMapRow[]);
    setInternals((i ?? []) as InternalChannelRow[]);
    setOrphans((o ?? []) as OrphanRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const removeAccount = async (a: AccountOpt) => {
    if (!confirm(`Delete account "${a.label}"? Tickets attached by domain/channel/workspace will re-attribute.`)) return;
    const { error } = await sb.from("v3_customer_accounts").delete().eq("account_key", a.account_key);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    load();
  };

  const removeWs = async (w: WorkspaceMapRow) => {
    if (!confirm(`Remove workspace mapping ${w.workspace_id}?`)) return;
    const { error } = await sb.from("v3_workspace_customer_map").delete().eq("workspace_id", w.workspace_id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const removeInternal = async (row: InternalChannelRow) => {
    if (!confirm(`Unmark ${row.slack_channel_id} as internal?`)) return;
    const { error } = await sb.from("v3_internal_channels").delete().eq("slack_channel_id", row.slack_channel_id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;

  return (
    <div className="space-y-4">
      <OrphanReconciliationPanel
        orphans={orphans}
        accounts={accounts}
        isAdmin={isAdmin}
        onDone={load}
      />


      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Customer accounts</CardTitle>
            <CardDescription>Registry of known customer accounts. Domains/aliases trigger auto-attribution.</CardDescription>
          </div>
          {isAdmin && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />New account</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Domains</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>CSM</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map(a => (
                <TableRow key={a.account_key}>
                  <TableCell className="font-medium">{a.label}</TableCell>
                  <TableCell className="font-mono text-xs">{a.account_key}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      {(a.domains ?? []).map(d => <Badge key={d} variant="outline">{d}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>{a.tier || "—"}</TableCell>
                  <TableCell>{a.csm_owner || "—"}</TableCell>
                  <TableCell>{a.status || "—"}</TableCell>
                  <TableCell className="text-right">{counts[a.account_key] ?? 0}</TableCell>
                  <TableCell>
                    {isAdmin && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(a)}><Pencil className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => removeAccount(a)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Workspace cache</CardTitle>
            <CardDescription>Workspace ID → account overrides.</CardDescription>
          </div>
          {isAdmin && <Button size="sm" onClick={() => setWsDialog(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace ID</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center py-4">Empty.</TableCell></TableRow>
              )}
              {workspaces.map(w => (
                <TableRow key={w.workspace_id}>
                  <TableCell className="font-mono text-xs">{w.workspace_id}</TableCell>
                  <TableCell>{accounts.find(a => a.account_key === w.account_key)?.label || w.account_key}</TableCell>
                  <TableCell>{w.workspace_name || "—"}</TableCell>
                  <TableCell>{w.source || "—"}</TableCell>
                  <TableCell>
                    {isAdmin && <Button size="sm" variant="ghost" onClick={() => removeWs(w)}><Trash2 className="h-3 w-3" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Internal channels</CardTitle>
            <CardDescription>Slack channels excluded from customer attribution.</CardDescription>
          </div>
          {isAdmin && <Button size="sm" onClick={() => setIcDialog(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Note</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {internals.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground text-center py-4">Empty.</TableCell></TableRow>
              )}
              {internals.map(i => (
                <TableRow key={i.slack_channel_id}>
                  <TableCell className="font-mono text-xs">{i.slack_channel_id}</TableCell>
                  <TableCell>{i.channel_name || "—"}</TableCell>
                  <TableCell>{i.note || "—"}</TableCell>
                  <TableCell>
                    {isAdmin && <Button size="sm" variant="ghost" onClick={() => removeInternal(i)}><Trash2 className="h-3 w-3" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(editing || creating) && (
        <AccountEditDialog
          account={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onDone={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
      {wsDialog && (
        <WorkspaceAddDialog accounts={accounts} onClose={() => setWsDialog(false)} onDone={() => { setWsDialog(false); load(); }} />
      )}
      {icDialog && (
        <InternalAddDialog onClose={() => setIcDialog(false)} onDone={() => { setIcDialog(false); load(); }} />
      )}
    </div>
  );
}

function AccountEditDialog({ account, onClose, onDone }: {
  account: AccountOpt | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const editing = !!account;
  const [label, setLabel] = useState(account?.label ?? "");
  const [key, setKey] = useState(account?.account_key ?? "");
  const [domains, setDomains] = useState((account?.domains ?? []).join(", "));
  const [aliases, setAliases] = useState((account?.aliases ?? []).join(", "));
  const [tier, setTier] = useState(account?.tier ?? "");
  const [csm, setCsm] = useState(account?.csm_owner ?? "");
  const [status, setStatus] = useState(account?.status ?? "active");
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing && label) setKey(slugify(label)); }, [label, editing]);

  const run = async () => {
    setSaving(true);
    try {
      const payload: any = {
        account_key: key || slugify(label),
        label: label.trim(),
        domains: domains.split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
        aliases: aliases.split(",").map(s => s.trim()).filter(Boolean),
        tier: tier || null,
        csm_owner: csm || null,
        status: status || null,
        notes: notes || null,
      };
      if (!payload.label || !payload.account_key) throw new Error("Label and key required");
      if (editing) {
        const { account_key, ...rest } = payload;
        const { error } = await sb.from("v3_customer_accounts").update(rest).eq("account_key", account!.account_key);
        if (error) throw error;
      } else {
        const { error } = await sb.from("v3_customer_accounts").insert(payload);
        if (error) throw error;
      }
      toast.success(editing ? "Updated" : "Created");
      onDone();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${account!.label}` : "New account"}</DialogTitle>
          <DialogDescription>Adding domains reclaims matching unattributed tickets automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>account_key</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={editing} />
          </div>
          <div className="space-y-1 col-span-2"><Label>Domains (comma-separated)</Label><Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.io" /></div>
          <div className="space-y-1 col-span-2"><Label>Aliases (comma-separated)</Label><Input value={aliases} onChange={(e) => setAliases(e.target.value)} /></div>
          <div className="space-y-1"><Label>Tier</Label><Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="enterprise / smb / free" /></div>
          <div className="space-y-1"><Label>CSM owner</Label><Input value={csm} onChange={(e) => setCsm(e.target.value)} /></div>
          <div className="space-y-1"><Label>Status</Label><Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="active / churned" /></div>
          <div className="space-y-1"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceAddDialog({ accounts, onClose, onDone }: {
  accounts: AccountOpt[]; onClose: () => void; onDone: () => void;
}) {
  const [wsId, setWsId] = useState("");
  const [name, setName] = useState("");
  const [accountKey, setAccountKey] = useState("");
  const [saving, setSaving] = useState(false);
  const run = async () => {
    setSaving(true);
    try {
      if (!wsId || !accountKey) throw new Error("workspace_id and account required");
      const { error } = await sb.from("v3_workspace_customer_map").insert({
        workspace_id: wsId.trim(), account_key: accountKey, workspace_name: name || null, source: "manual",
      });
      if (error) throw error;
      toast.success("Added");
      onDone();
    } catch (e: any) { console.error(e); toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add workspace mapping</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Workspace ID</Label><Input value={wsId} onChange={e => setWsId(e.target.value)} placeholder="workspace_xxx" /></div>
          <div className="space-y-1"><Label>Workspace name (optional)</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Account</Label>
            <Select value={accountKey} onValueChange={setAccountKey}>
              <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map(a => <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InternalAddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const run = async () => {
    setSaving(true);
    try {
      if (!id) throw new Error("channel id required");
      const { error } = await sb.from("v3_internal_channels").insert({
        slack_channel_id: id.trim(), channel_name: name || null, note: note || null,
      });
      if (error) throw error;
      toast.success("Added");
      onDone();
    } catch (e: any) { console.error(e); toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add internal channel</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Slack channel ID</Label><Input value={id} onChange={e => setId(e.target.value)} placeholder="C0XXXXXXX" /></div>
          <div className="space-y-1"><Label>Channel name (optional)</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Note (optional)</Label><Input value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Action dialog (unattributed reclaim) ---------------- */

function ActionDialog({ state, accounts, onClose, onDone }: {
  state: null | { kind: string; group?: GroupRow; ticketIds?: string[] };
  accounts: AccountOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [label, setLabel] = useState("");
  const [accountKey, setAccountKey] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setLabel(""); setAccountKey(""); setReason(""); }, [state]);

  if (!state) return null;
  const { kind, group, ticketIds } = state;

  const run = async () => {
    setSaving(true);
    try {
      if (kind === "domain-new") {
        const key = slugify(label);
        if (!key || !group?.group_key) throw new Error("Label required");
        const { error } = await sb.from("v3_customer_accounts").insert({
          account_key: key, label: label.trim(), domains: [group.group_key],
        });
        if (error) throw error;
        toast.success(`Account "${label}" created; ${group.ticket_count} tickets reclaimed.`);
      } else if (kind === "domain-attach") {
        if (!accountKey || !group?.group_key) throw new Error("Pick an account");
        const acc = accounts.find(a => a.account_key === accountKey);
        if (!acc) throw new Error("Account not found");
        const newDomains = Array.from(new Set([...(acc.domains ?? []), group.group_key.toLowerCase()]));
        const { error } = await sb.from("v3_customer_accounts").update({ domains: newDomains }).eq("account_key", accountKey);
        if (error) throw error;
        toast.success(`Domain attached; ${group.ticket_count} tickets reclaimed.`);
      } else if (kind === "channel-map") {
        if (!accountKey || !group?.group_key) throw new Error("Pick an account");
        const { error } = await sb.from("v3_channel_account_map").insert({
          slack_channel_id: group.group_key, account_key: accountKey,
        });
        if (error) throw error;
        toast.success(`Channel mapped; ${group.ticket_count} tickets reclaimed.`);
      } else if (kind === "channel-internal") {
        if (!group?.group_key) throw new Error("Missing channel");
        const { error } = await sb.from("v3_internal_channels").insert({
          slack_channel_id: group.group_key, channel_name: label.trim() || null, note: reason || null,
        });
        if (error) throw error;
        toast.success("Channel marked internal.");
      } else if (kind === "workspace-seed") {
        if (!accountKey || !group?.group_key) throw new Error("Pick an account");
        const { error } = await sb.from("v3_workspace_customer_map").insert({
          workspace_id: group.group_key, account_key: accountKey, source: "manual",
        });
        if (error) throw error;
        toast.success(`Workspace seeded; ${group.ticket_count} tickets reclaimed.`);
      } else if (kind === "ticket-assign" || kind === "bulk-assign") {
        if (!accountKey) throw new Error("Pick an account");
        if (!ticketIds?.length) throw new Error("No tickets selected");
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id ?? null;
        const patch: any = {
          customer_override_key: accountKey,
          customer_override_by: uid,
          customer_override_at: new Date().toISOString(),
          customer_override_reason: reason || null,
        };
        const { error } = await sb.from("intercom_tickets_v3").update(patch).in("id", ticketIds);
        if (error) throw error;
        toast.success(`${ticketIds.length} ticket(s) assigned.`);
      }
      onDone();
    } catch (e: any) {
      console.error("action failed", e);
      toast.error(e.message || "Action failed");
    } finally { setSaving(false); }
  };

  const title =
    kind === "domain-new" ? `Create account for ${group?.group_key}` :
    kind === "domain-attach" ? `Attach ${group?.group_key} to existing account` :
    kind === "channel-map" ? `Map channel ${group?.group_key} to account` :
    kind === "channel-internal" ? `Mark channel ${group?.group_key} internal` :
    kind === "workspace-seed" ? `Seed workspace ${group?.group_key} to account` :
    kind === "bulk-assign" ? `Assign ${ticketIds?.length ?? 0} tickets to account` :
    "Assign ticket to account";

  const needsAccountPicker = ["domain-attach", "channel-map", "workspace-seed", "ticket-assign", "bulk-assign"].includes(kind);
  const needsLabel = kind === "domain-new" || kind === "channel-internal";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {kind.startsWith("domain") || kind.startsWith("channel") || kind === "workspace-seed"
              ? "Writes to the lookup table; existing tickets in this group re-attribute automatically."
              : "Writes an override on the selected ticket(s)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {needsLabel && (
            <div className="space-y-1">
              <Label>{kind === "domain-new" ? "Account label" : "Channel name (optional)"}</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "domain-new" ? "e.g. Acme Corp" : "e.g. #internal-support"} />
              {kind === "domain-new" && label && <p className="text-xs text-muted-foreground">account_key: <code>{slugify(label)}</code></p>}
            </div>
          )}
          {needsAccountPicker && (
            <div className="space-y-1">
              <Label>Account</Label>
              <Select value={accountKey} onValueChange={setAccountKey}>
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {(kind === "ticket-assign" || kind === "bulk-assign" || kind === "channel-internal") && (
            <div className="space-y-1"><Label>Reason (optional)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Orphan reconciliation ---------------- */

function OrphanReconciliationPanel({
  orphans, accounts, isAdmin, onDone,
}: {
  orphans: OrphanRow[];
  accounts: AccountOpt[];
  isAdmin: boolean;
  onDone: () => void;
}) {
  const [suggestions, setSuggestions] = useState<OrphanSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await sb.rpc("v3_orphan_override_suggestions");
    if (error) { console.error(error); toast.error("Failed to load suggestions"); }
    setSuggestions((data ?? []) as OrphanSuggestion[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orphans.length]);

  if (orphans.length === 0) return null;

  const rewriteOverride = async (orphanKey: string, newKey: string, reason: string) => {
    setBusy(orphanKey);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      const { error } = await sb
        .from("intercom_tickets_v3")
        .update({
          customer_override_key: newKey,
          customer_override_by: uid,
          customer_override_at: new Date().toISOString(),
          customer_override_reason: reason,
        })
        .eq("customer_override_key", orphanKey);
      if (error) throw error;
      toast.success(`Reconciled "${orphanKey}" → ${newKey}`);
      onDone();
      load();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed");
    } finally { setBusy(null); }
  };

  const confirmSuggestion = (s: OrphanSuggestion) => {
    if (!s.suggested_account_key) return;
    rewriteOverride(s.orphan_key, s.suggested_account_key, `reconciled via ${s.match_kind}`);
  };

  const confirmPicked = (s: OrphanSuggestion) => {
    const picked = override[s.orphan_key];
    if (!picked) { toast.error("Pick an account first"); return; }
    rewriteOverride(s.orphan_key, picked, "reconciled via manual pick");
  };

  const dismiss = async (s: OrphanSuggestion) => {
    if (!confirm(`Dismiss "${s.orphan_key}"? Its ${s.ticket_count} ticket(s) will lose their override and re-attribute via the resolver rules.`)) return;
    setBusy(s.orphan_key);
    try {
      const { error } = await sb
        .from("intercom_tickets_v3")
        .update({
          customer_override_key: null,
          customer_override_by: null,
          customer_override_at: null,
          customer_override_reason: null,
        })
        .eq("customer_override_key", s.orphan_key);
      if (error) throw error;
      toast.success(`Cleared override for "${s.orphan_key}"`);
      onDone();
      load();
    } catch (e: any) {
      console.error(e); toast.error(e.message || "Failed");
    } finally { setBusy(null); }
  };

  const acceptAllExact = async () => {
    if (!suggestions) return;
    const exact = suggestions.filter(s => s.match_kind === "exact_normalized" && s.suggested_account_key);
    if (exact.length === 0) return;
    if (!confirm(`Accept ${exact.length} exact-match suggestion(s)?`)) return;
    setBusy("__bulk__");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      for (const s of exact) {
        const { error } = await sb
          .from("intercom_tickets_v3")
          .update({
            customer_override_key: s.suggested_account_key!,
            customer_override_by: uid,
            customer_override_at: new Date().toISOString(),
            customer_override_reason: "reconciled via exact_normalized (bulk)",
          })
          .eq("customer_override_key", s.orphan_key);
        if (error) throw error;
      }
      toast.success(`Reconciled ${exact.length} orphan(s).`);
      onDone();
      load();
    } catch (e: any) {
      console.error(e); toast.error(e.message || "Bulk failed");
    } finally { setBusy(null); }
  };

  const exactCount = suggestions?.filter(s => s.match_kind === "exact_normalized").length ?? 0;

  return (
    <Card className="border-yellow-500/40 bg-yellow-500/5">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            Unrecognized override keys ({orphans.length})
          </CardTitle>
          <CardDescription>
            Suggestions match each orphan key to an existing account by normalized name or token. Confirming rewrites the override on all affected tickets.
          </CardDescription>
        </div>
        {isAdmin && exactCount > 0 && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={acceptAllExact}>
            Accept all {exactCount} exact matches
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading || !suggestions ? (
          <div className="p-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orphan key</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Suggestion</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map(s => (
                <TableRow key={s.orphan_key}>
                  <TableCell className="font-mono text-xs">{s.orphan_key}</TableCell>
                  <TableCell className="text-right">{s.ticket_count}</TableCell>
                  <TableCell>
                    <Badge variant={s.match_kind === "exact_normalized" ? "default" : s.match_kind === "fuzzy" ? "secondary" : "outline"}>
                      {s.match_kind}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {s.suggested_account_key ? (
                      <span><span className="font-medium">{s.suggested_label}</span> <span className="text-xs text-muted-foreground font-mono">({s.suggested_account_key})</span></span>
                    ) : <span className="text-muted-foreground">no match</span>}
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <div className="flex flex-wrap gap-1 items-center">
                        {s.suggested_account_key && (
                          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => confirmSuggestion(s)}>Confirm</Button>
                        )}
                        <Select value={override[s.orphan_key] ?? ""} onValueChange={(v) => setOverride(o => ({ ...o, [s.orphan_key]: v }))}>
                          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Pick different…" /></SelectTrigger>
                          <SelectContent>
                            {accounts.map(a => <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {override[s.orphan_key] && (
                          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => confirmPicked(s)}>Apply pick</Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => dismiss(s)}>Dismiss</Button>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">read-only</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Channel proposals ---------------- */

export function ChannelProposalsSection({
  accounts, isAdmin, onDone,
}: {
  accounts: AccountOpt[];
  isAdmin: boolean;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ChannelProposal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, string>>({});

  const load = async () => {
    const { data, error } = await sb.rpc("v3_channel_proposals_pending");
    if (error) { console.error(error); toast.error("Failed to load proposals"); return; }
    setRows((data ?? []) as ChannelProposal[]);
  };

  useEffect(() => { load(); }, []);

  const regenerate = async () => {
    setBusy("__regen__");
    try {
      const { error } = await sb.rpc("v3_generate_channel_proposals");
      if (error) throw error;
      toast.success("Proposals regenerated");
      await load();
    } catch (e: any) { console.error(e); toast.error(e.message || "Failed"); }
    finally { setBusy(null); }
  };

  const confirmOne = async (p: ChannelProposal, accountKey: string) => {
    setBusy(p.slack_channel_id);
    try {
      const { error: mapErr } = await sb.from("v3_channel_account_map").upsert({
        slack_channel_id: p.slack_channel_id, account_key: accountKey,
      }, { onConflict: "slack_channel_id" });
      if (mapErr) throw mapErr;
      const { error: stErr } = await sb
        .from("v3_channel_account_proposals")
        .update({ status: "confirmed" })
        .eq("slack_channel_id", p.slack_channel_id);
      if (stErr) throw stErr;
      toast.success(`Mapped ${p.channel_name ?? p.slack_channel_id} → ${accountKey}`);
      onDone();
      await load();
    } catch (e: any) { console.error(e); toast.error(e.message || "Failed"); }
    finally { setBusy(null); }
  };

  const reject = async (p: ChannelProposal) => {
    if (!confirm(`Reject suggestion for ${p.channel_name ?? p.slack_channel_id}?`)) return;
    setBusy(p.slack_channel_id);
    try {
      const { error } = await sb
        .from("v3_channel_account_proposals")
        .update({ status: "rejected" })
        .eq("slack_channel_id", p.slack_channel_id);
      if (error) throw error;
      toast.success("Rejected");
      await load();
    } catch (e: any) { console.error(e); toast.error(e.message || "Failed"); }
    finally { setBusy(null); }
  };

  const acceptAllHigh = async () => {
    if (!rows) return;
    const high = rows.filter(r => r.confidence === "high");
    if (high.length === 0) return;
    if (!confirm(`Accept ${high.length} high-confidence proposal(s)?`)) return;
    setBusy("__bulk__");
    try {
      for (const p of high) {
        const { error: mapErr } = await sb.from("v3_channel_account_map").upsert({
          slack_channel_id: p.slack_channel_id, account_key: p.proposed_account_key,
        }, { onConflict: "slack_channel_id" });
        if (mapErr) throw mapErr;
        const { error: stErr } = await sb
          .from("v3_channel_account_proposals")
          .update({ status: "confirmed" })
          .eq("slack_channel_id", p.slack_channel_id);
        if (stErr) throw stErr;
      }
      toast.success(`Confirmed ${high.length} channel(s).`);
      onDone();
      await load();
    } catch (e: any) { console.error(e); toast.error(e.message || "Bulk failed"); }
    finally { setBusy(null); }
  };

  if (rows === null) return <div className="p-2"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (rows.length === 0 && !isAdmin) return null;

  const highCount = rows.filter(r => r.confidence === "high").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Suggested channel mappings ({rows.length})
          </CardTitle>
          <CardDescription>
            Pending suggestions for unmapped, non-internal channels. High = domain co-occurrence, medium = channel-name token.
          </CardDescription>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {highCount > 0 && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={acceptAllHigh}>
                Accept all {highCount} high-confidence
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={regenerate}>
              <RefreshCw className="h-3 w-3 mr-1" />Regenerate
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">No pending suggestions.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Proposed account</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(p => (
                <TableRow key={p.slack_channel_id}>
                  <TableCell className="font-mono text-xs">{channelLabel(p.slack_channel_id, p.channel_name)}</TableCell>
                  <TableCell className="text-right">{p.ticket_count}</TableCell>
                  <TableCell>
                    <Badge variant={p.confidence === "high" ? "default" : "secondary"}>{p.confidence}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{p.account_label}</span>{" "}
                    <span className="text-xs text-muted-foreground font-mono">({p.proposed_account_key})</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">{p.evidence}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <div className="flex flex-wrap gap-1 items-center">
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => confirmOne(p, p.proposed_account_key)}>Confirm</Button>
                        <Select value={override[p.slack_channel_id] ?? ""} onValueChange={(v) => setOverride(o => ({ ...o, [p.slack_channel_id]: v }))}>
                          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Edit…" /></SelectTrigger>
                          <SelectContent>
                            {accounts.map(a => <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {override[p.slack_channel_id] && (
                          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => confirmOne(p, override[p.slack_channel_id])}>Apply</Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => reject(p)}>Reject</Button>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">read-only</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

