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
import { Loader2, Users, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Building2, Hash, Ban, Shield } from "lucide-react";
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
  pct_attributed: number;
  m_override: number;
  m_slack_channel: number;
  m_domain: number;
  m_workspace_id: number;
  m_unresolved: number;
};

type Snapshot = Coverage & { snapshot_date: string };

type GroupRow = {
  group_kind: "domain" | "channel" | "workspace" | "no_signal";
  group_key: string;
  ticket_count: number;
};

type AccountOpt = { account_key: string; label: string; domains: string[] };

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

function intercomUrl(id: string) {
  return `https://app.intercom.com/a/inbox/teb21d17/inbox/conversation/${id}?view=List`;
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export default function Customers() {
  const { isAdmin } = useIsAdmin();
  const [tab, setTab] = useState<"coverage" | "unattributed">("coverage");

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
          </TabsList>
          <TabsContent value="coverage" className="pt-4">
            <CoverageTab isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="unattributed" className="pt-4">
            <UnattributedTab isAdmin={isAdmin} />
          </TabsContent>
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

  const chartData = snaps.map(s => ({
    date: s.snapshot_date,
    pct: Number(s.pct_attributed),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Attributed</CardDescription>
            <CardTitle className="text-3xl">{Number(cov.pct_attributed).toFixed(1)}%</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {cov.attributed} of {cov.total_tickets} tickets
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unattributed</CardDescription>
            <CardTitle className="text-3xl">{cov.unattributed}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Awaiting reclaim
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total tickets</CardDescription>
            <CardTitle className="text-3xl">{cov.total_tickets}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            in intercom_tickets_v3
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Actions</CardDescription>
          </CardHeader>
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
          <CardDescription>How the currently-attributed tickets were resolved.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Bucket label="Override" value={cov.m_override} tone="default" />
            <Bucket label="Slack channel" value={cov.m_slack_channel} tone="default" />
            <Bucket label="Domain" value={cov.m_domain} tone="default" />
            <Bucket label="Workspace ID" value={cov.m_workspace_id} tone="default" />
            <Bucket label="Unresolved" value={cov.m_unresolved} tone="warn" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coverage trend</CardTitle>
          <CardDescription>Daily snapshot of % attributed. Auto-captured at 06:00 UTC.</CardDescription>
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

function Bucket({ label, value, tone }: { label: string; value: number; tone: "default" | "warn" }) {
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

  // Dialog state
  const [dialog, setDialog] = useState<null | { kind: "domain-new" | "domain-attach" | "channel-map" | "channel-internal" | "workspace-seed" | "ticket-assign" | "bulk-assign"; group?: GroupRow; ticketIds?: string[] }>(null);

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
    // Query filter depends on group_kind
    let q = sb.from("intercom_tickets_v3")
      .select("id,intercom_conversation_id,subject,contact_email,contact_domain,slack_channel_id_detected,workspace_id_detected,intercom_created_at")
      .eq("customer_key", "unattributed")
      .order("intercom_created_at", { ascending: false })
      .limit(500);
    if (g.group_kind === "domain") q = q.eq("contact_domain", g.group_key);
    else if (g.group_kind === "channel") q = q.eq("slack_channel_id_detected", g.group_key);
    else if (g.group_kind === "workspace") q = q.eq("workspace_id_detected", g.group_key);
    // no_signal handled below by filtering client-side against the group definition
    const { data, error } = await q;
    if (error) { console.error(error); toast.error("Failed to load tickets"); return; }
    let rows = (data ?? []) as UnTicket[];
    if (g.group_kind === "no_signal") {
      // Filter to tickets that classify as no_signal
      const domSet = new Set(accounts.flatMap(a => a.domains));
      rows = rows.filter(r => {
        const hasDomain = r.contact_domain && r.contact_domain !== "" && r.contact_domain !== "lovable.dev" && !domSet.has(r.contact_domain);
        // Cannot cheaply reproduce personal/internal/mapped tables here — approximate:
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
                        {g.group_key || <span className="text-muted-foreground italic">no signal</span>}
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
                                        <Checkbox
                                          checked={sel.has(t.id)}
                                          onCheckedChange={() => toggleSelect(gid, t.id)}
                                        />
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

/* ---------------- Action dialog ---------------- */

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

  useEffect(() => {
    setLabel(""); setAccountKey(""); setReason("");
  }, [state]);

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
    } finally {
      setSaving(false);
    }
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
              {kind === "domain-new" && label && (
                <p className="text-xs text-muted-foreground">account_key: <code>{slugify(label)}</code></p>
              )}
            </div>
          )}
          {needsAccountPicker && (
            <div className="space-y-1">
              <Label>Account</Label>
              <Select value={accountKey} onValueChange={setAccountKey}>
                <SelectTrigger><SelectValue placeholder="Pick an account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.account_key} value={a.account_key}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(kind === "ticket-assign" || kind === "bulk-assign" || kind === "channel-internal") && (
            <div className="space-y-1">
              <Label>Reason (optional)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
