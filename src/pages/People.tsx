import { useEffect, useMemo, useState } from "react";

import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, UserPlus, Check, X, Pencil } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * People — the SINGLE pane for both people registries.
 *
 *  - Access:      hub_members + user_roles (via list_users_with_roles)   -> can they sign in, what may they change
 *  - Attribution: teammates                                             -> whose work is it, does their reply stop the FRT clock
 *
 * Joined on lowercased email. Rows that exist on only one side are kept and
 * labelled as drift rather than hidden — that drift is the whole point of the page.
 *
 * Everything is editable here: add a person, grant/revoke admin+editor, provision
 * or remove Hub access, set team, edit Intercom / Slack IDs, toggle dashboard.
 *
 * Any write that touches `intercom_admin_id` or a teammate name re-mirrors the
 * FULL roster (active AND inactive — historical attribution must keep resolving)
 * into `settings.admin_owner_map`, which is still read by intercom-webhook,
 * poll-intercom-inbox, sync-v3-open/closed, reconcile-v3-open,
 * backfill-enterprise-inbox, esh-write-action and AnalyticsV3.
 */

interface MemberRow {
  email: string;
  user_id: string | null;
  status: string;
  note: string | null;
}

interface AuthUserRow {
  id: string;
  email: string | null;
  roles: string[];
}

interface TeammateRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  active: boolean;
  show_dashboard: boolean;
  intercom_admin_id: string | null;
  slack_user_id: string | null;
  /** false = intentionally attribution-only; suppresses the "No Hub login" drift flag. */
  hub_access_expected: boolean;
}

interface PersonRow {
  key: string;
  email: string | null;
  name: string | null;
  // access side
  hasAccess: boolean;
  accessStatus: string | null;
  userId: string | null;
  roles: string[];
  // attribution side
  teammate: TeammateRow | null;
  drift: string[];
}

const roleBadge = (r: string) =>
  r === "admin" ? "default" : r === "editor" ? "secondary" : "outline";

const TEAM_ROLES = ["support", "csm", "other", "ai"] as const;
/** Roles that never need an Intercom admin id (relay-only, never counted for FRT). */
const RELAY_ONLY_ROLES = new Set<string>(["csm", "other"]);

const People = () => {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [authUsers, setAuthUsers] = useState<AuthUserRow[]>([]);
  const [teammates, setTeammates] = useState<TeammateRow[]>([]);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [confirmBlock, setConfirmBlock] = useState<PersonRow | null>(null);

  // inline id editing
  const [editing, setEditing] = useState<{ key: string; field: "intercom" | "slack" } | null>(null);
  const [editValue, setEditValue] = useState("");

  // add person dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [fName, setFName] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fTeam, setFTeam] = useState<string>("support");
  const [fSlack, setFSlack] = useState("");
  const [fIntercom, setFIntercom] = useState("");
  const [fLogin, setFLogin] = useState(false);
  const [fEditor, setFEditor] = useState(false);
  const [fAdmin, setFAdmin] = useState(false);
  const [fDashboard, setFDashboard] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSelfId(data.session?.user?.id ?? null));
  }, []);

  const load = async () => {
    setLoading(true);
    const [
      { data: m, error: mErr },
      { data: u, error: uErr },
      { data: t, error: tErr },
      { data: s },
    ] = await Promise.all([
      supabase.from("hub_members").select("email,user_id,status,note").order("email"),
      supabase.rpc("list_users_with_roles"),
      supabase
        .from("teammates")
        .select(
          "id,name,email,role,active,show_dashboard,intercom_admin_id,slack_user_id,hub_access_expected",
        )
        .order("name"),
      supabase.from("settings").select("id").limit(1).maybeSingle(),
    ]);
    if (mErr) toast.error("Failed to load access roster: " + mErr.message);
    if (uErr) toast.error("Failed to load accounts: " + uErr.message);
    if (tErr) toast.error("Failed to load teammates: " + tErr.message);
    setMembers((m ?? []) as MemberRow[]);
    setAuthUsers((u ?? []) as AuthUserRow[]);
    setTeammates((t ?? []) as TeammateRow[]);
    setSettingsId(s?.id ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
    else if (!adminLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, adminLoading]);

  /** Re-mirror the full roster into settings.admin_owner_map (legacy source of truth). */
  const syncOwnerMap = async () => {
    if (!settingsId) return;
    const { data } = await supabase.from("teammates").select("name,intercom_admin_id");
    const map: Record<string, string> = {};
    for (const r of (data ?? []) as { name: string; intercom_admin_id: string | null }[]) {
      if (r.intercom_admin_id && r.name) map[r.intercom_admin_id] = r.name;
    }
    const { error } = await supabase
      .from("settings")
      .update({ admin_owner_map: JSON.stringify(map) } as any)
      .eq("id", settingsId);
    if (error) toast.error("Owner map sync failed: " + error.message);
  };

  /** Close any open Slack relay identity gaps this person now answers for. */
  const resolveRelayGaps = async (email: string | null, slackId: string | null) => {
    const stamp = new Date().toISOString();
    try {
      if (slackId) {
        await (supabase.from("relay_attribution_gaps" as any) as any)
          .update({ resolved_at: stamp })
          .is("resolved_at", null)
          .eq("slack_user_id", slackId);
      }
      if (email) {
        await (supabase.from("relay_attribution_gaps" as any) as any)
          .update({ resolved_at: stamp })
          .is("resolved_at", null)
          .eq("slack_email", email);
      }
    } catch {
      /* non-fatal: the gap card simply stays until the next relay event */
    }
  };

  const callAccess = async (action: "block" | "unblock" | "provision", r: PersonRow) => {
    if (!r.email) return;
    setSavingKey(r.key);
    const { data, error } = await supabase.functions.invoke("hub-access-manage", {
      body: { action, email: r.email },
    });
    const errMsg = error?.message ?? (data as any)?.error;
    if (errMsg) toast.error(`${action} failed: ${errMsg}`);
    else {
      toast.success(`${action} complete for ${r.email}`);
      await load();
    }
    setSavingKey(null);
  };

  const setTeam = async (r: PersonRow, value: string) => {
    const t = r.teammate;
    setSavingKey(r.key);
    try {
      if (value === "none") {
        if (!t) return;
        const { error } = await supabase.from("teammates").update({ active: false }).eq("id", t.id);
        if (error) throw error;
        toast.success(`${t.name} marked inactive on the roster`);
      } else if (t) {
        const { error } = await supabase
          .from("teammates")
          .update({ role: value, active: true })
          .eq("id", t.id);
        if (error) throw error;
        toast.success(`${t.name} set to ${value}`);
      } else {
        if (!r.email) return;
        const local = r.email.split("@")[0].replace(/[._]/g, " ");
        const name = local.replace(/\b\w/g, (c) => c.toUpperCase());
        const { error } = await supabase
          .from("teammates")
          .insert({ name, email: r.email, role: value, active: true, show_dashboard: false });
        if (error) throw error;
        toast.success(`${name} added to the roster as ${value}`);
      }
      await syncOwnerMap();
      await load();
    } catch (e) {
      toast.error("Could not update roster: " + (e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  const saveIdentity = async (r: PersonRow, field: "intercom" | "slack", raw: string) => {
    const t = r.teammate;
    if (!t) {
      toast.error("Assign a team first — identities live on the attribution roster");
      return;
    }
    const value = raw.trim() || null;
    setSavingKey(r.key);
    const patch =
      field === "intercom" ? { intercom_admin_id: value } : { slack_user_id: value };
    const { error } = await supabase.from("teammates").update(patch).eq("id", t.id);
    if (error) {
      toast.error("Save failed: " + error.message);
    } else {
      toast.success(`${field === "intercom" ? "Intercom ID" : "Slack ID"} saved for ${t.name}`);
      if (field === "intercom") await syncOwnerMap();
      if (field === "slack") await resolveRelayGaps(t.email, value);
      await load();
    }
    setEditing(null);
    setSavingKey(null);
  };

  const toggleDashboard = async (r: PersonRow, next: boolean) => {
    const t = r.teammate;
    if (!t) return;
    setSavingKey(r.key);
    const { error } = await supabase
      .from("teammates")
      .update({ show_dashboard: next })
      .eq("id", t.id);
    if (error) toast.error("Save failed: " + error.message);
    else {
      toast.success(`${t.name} dashboard ${next ? "shown" : "hidden"}`);
      await load();
    }
    setSavingKey(null);
  };

  /**
   * Mark a teammate as intentionally attribution-only (no Hub login ever) or
   * back to expected-to-log-in. Purely a drift-expectation flag — it grants and
   * revokes nothing.
   */
  const toggleAccessExpected = async (r: PersonRow, expected: boolean) => {
    const t = r.teammate;
    if (!t) return;
    setSavingKey(r.key);
    const { error } = await supabase
      .from("teammates")
      .update({ hub_access_expected: expected })
      .eq("id", t.id);
    if (error) toast.error("Save failed: " + error.message);
    else {
      toast.success(
        expected
          ? `${t.name} expected to have ESH access`
          : `${t.name} marked internal, no Hub login`,
      );
      await load();
    }
    setSavingKey(null);
  };

  /** Create the access roster row (if missing) and provision the ESH account. */
  const grantAccess = async (r: PersonRow) => {
    const email = r.email?.trim().toLowerCase();
    if (!email) return toast.error("This person has no email on the roster");
    if (email.split("@")[1] !== "lovable.dev")
      return toast.error("Only @lovable.dev addresses can be granted ESH access");
    setSavingKey(r.key);
    try {
      const { data: session } = await supabase.auth.getSession();
      const { error: mErr } = await supabase
        .from("hub_members")
        .insert({ email, status: "pending", added_by: session.session?.user?.id ?? null });
      if (mErr && !mErr.message.toLowerCase().includes("duplicate"))
        throw new Error("Access roster insert failed: " + mErr.message);

      const { data, error } = await supabase.functions.invoke("hub-access-manage", {
        body: { action: "provision", email },
      });
      const msg = error?.message ?? (data as any)?.error;
      if (msg) throw new Error(msg);
      toast.success(`ESH access granted to ${email}`);
      await load();
    } catch (e) {
      toast.error("Grant access failed: " + (e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  const setRole = async (r: PersonRow, role: "admin" | "editor", grant: boolean) => {
    if (!r.userId) return;
    setSavingKey(r.key);
    const { error } = grant
      ? await supabase.from("user_roles").insert({ user_id: r.userId, role })
      : await supabase.from("user_roles").delete().eq("user_id", r.userId).eq("role", role);
    if (error) toast.error(`${grant ? "Grant" : "Revoke"} failed: ` + error.message);
    else {
      toast.success(`${role === "admin" ? "Admin" : "Editor"} ${grant ? "granted" : "revoked"}`);
      await load();
    }
    setSavingKey(null);
  };

  const resetAddForm = () => {
    setFName("");
    setFEmail("");
    setFTeam("support");
    setFSlack("");
    setFIntercom("");
    setFLogin(false);
    setFEditor(false);
    setFAdmin(false);
    setFDashboard(false);
  };

  const addPerson = async () => {
    const name = fName.trim();
    const email = fEmail.trim().toLowerCase();
    const slack = fSlack.trim() || null;
    const intercom = fIntercom.trim() || null;
    if (!name) return toast.error("Name is required");
    if (!email) return toast.error("Email is required");
    if (email.split("@")[1] !== "lovable.dev") return toast.error("Only @lovable.dev addresses");
    if (!intercom && !RELAY_ONLY_ROLES.has(fTeam) && fTeam !== "ai")
      return toast.error("Support teammates need an Intercom Admin ID");

    setAddBusy(true);
    try {
      const { error: tErr } = await supabase.from("teammates").insert({
        name,
        email,
        role: fTeam,
        slack_user_id: slack,
        intercom_admin_id: intercom,
        active: true,
        show_dashboard: fDashboard,
        // No login requested and not an AI identity? Then they are attribution
        // only and should not be flagged for a missing Hub account.
        hub_access_expected: fLogin,
      });
      if (tErr) throw new Error("Roster insert failed: " + tErr.message);

      if (fLogin) {
        const { data: session } = await supabase.auth.getSession();
        const { error: mErr } = await supabase
          .from("hub_members")
          .insert({ email, status: "pending", added_by: session.session?.user?.id ?? null });
        if (mErr && !mErr.message.includes("duplicate"))
          throw new Error("Access roster insert failed: " + mErr.message);

        const { data: pData, error: pErr } = await supabase.functions.invoke("hub-access-manage", {
          body: { action: "provision", email },
        });
        const pMsg = pErr?.message ?? (pData as any)?.error;
        if (pMsg) throw new Error("Provision failed: " + pMsg);

        const userId = (pData as any)?.user_id as string | undefined;
        if (userId) {
          const wanted: ("admin" | "editor")[] = [];
          if (fAdmin) wanted.push("admin");
          if (fEditor) wanted.push("editor");
          for (const role of wanted) {
            const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
            if (error) toast.error(`Could not grant ${role}: ${error.message}`);
          }
        }
      }

      await syncOwnerMap();
      await resolveRelayGaps(email, slack);
      toast.success(`${name} added`);
      setAddOpen(false);
      resetAddForm();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  };

  const rows = useMemo<PersonRow[]>(() => {
    const byKey = new Map<string, PersonRow>();
    const norm = (e: string | null | undefined) => (e ? e.trim().toLowerCase() : "");

    const ensure = (key: string, email: string | null): PersonRow => {
      let r = byKey.get(key);
      if (!r) {
        r = {
          key,
          email,
          name: null,
          hasAccess: false,
          accessStatus: null,
          userId: null,
          roles: [],
          teammate: null,
          drift: [],
        };
        byKey.set(key, r);
      }
      return r;
    };

    const rolesByEmail = new Map<string, string[]>();
    const idByEmail = new Map<string, string>();
    for (const a of authUsers) {
      const k = norm(a.email);
      if (k) {
        rolesByEmail.set(k, a.roles ?? []);
        idByEmail.set(k, a.id);
      }
    }

    for (const m of members) {
      const k = norm(m.email);
      const r = ensure(k, m.email);
      r.hasAccess = true;
      r.accessStatus = m.status;
      r.roles = rolesByEmail.get(k) ?? [];
      r.userId = m.user_id ?? idByEmail.get(k) ?? null;
    }
    // auth accounts with no roster row
    for (const a of authUsers) {
      const k = norm(a.email);
      if (!k || byKey.has(k)) continue;
      const r = ensure(k, a.email);
      r.hasAccess = true;
      r.accessStatus = "untracked";
      r.roles = a.roles ?? [];
      r.userId = a.id;
    }

    for (const t of teammates) {
      const k = norm(t.email) || `teammate:${t.id}`;
      const r = ensure(k, t.email);
      r.teammate = t;
      r.name = t.name;
    }

    for (const r of byKey.values()) {
      const t = r.teammate;
      // A missing Hub login is only drift when this person is *expected* to sign
      // in. AI identities (Sam) never can, and humans can be marked attribution
      // only (hub_access_expected = false) when a login is deliberate-never.
      if (!r.hasAccess && t && t.role !== "ai" && t.hub_access_expected)
        r.drift.push("No Hub login");
      if (r.hasAccess && !t) r.drift.push("Not on attribution roster");
      if (r.accessStatus === "untracked") r.drift.push("Account not on access roster");
      if (t?.active && t.role === "support" && !t.slack_user_id) r.drift.push("Support, no Slack ID");
      if (t?.active && t.role === "support" && !t.intercom_admin_id)
        r.drift.push("Support, no Intercom ID");
      if (t && !t.active && r.accessStatus === "active") r.drift.push("Inactive teammate, active login");
    }

    let list = Array.from(byKey.values());
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (r) =>
          (r.email ?? "").toLowerCase().includes(term) ||
          (r.name ?? "").toLowerCase().includes(term) ||
          (r.teammate?.role ?? "").toLowerCase().includes(term),
      );
    }
    return list.sort((a, b) => {
      if (a.drift.length !== b.drift.length) return b.drift.length - a.drift.length;
      return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "");
    });
  }, [members, authUsers, teammates, q]);

  const driftCount = rows.filter((r) => r.drift.length > 0).length;
  const adminCount = authUsers.filter((u) => u.roles.includes("admin")).length;

  const IdCell = ({ r, field }: { r: PersonRow; field: "intercom" | "slack" }) => {
    const t = r.teammate;
    const current = field === "intercom" ? t?.intercom_admin_id : t?.slack_user_id;
    const isEditing = editing?.key === r.key && editing.field === field;
    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveIdentity(r, field, editValue);
              if (e.key === "Escape") setEditing(null);
            }}
            className="h-7 w-[120px] font-mono text-xs"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => saveIdentity(r, field, editValue)}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <button
        type="button"
        disabled={!t || savingKey === r.key}
        onClick={() => {
          setEditValue(current ?? "");
          setEditing({ key: r.key, field });
        }}
        className="group inline-flex items-center gap-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span>{current ?? "—"}</span>
        {t && <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />}
      </button>
    );
  };

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-[1700px] space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground">People</h1>
              <p className="text-sm text-muted-foreground">
                One row per person, and the only place people are managed: Hub access and roles on
                the left, ticket attribution and identities on the right.
              </p>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, email, role"
                  className="h-9 w-64"
                />
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add person
                </Button>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            )}
          </div>

          {adminLoading || loading ? (
            <Skeleton className="h-96 w-full" />
          ) : !isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Admin access required</CardTitle>
                <CardDescription>
                  Only Hub admins can view the people registries. Ask an admin if you need access.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {rows.length} {rows.length === 1 ? "person" : "people"}
                </CardTitle>
                <CardDescription>
                  {driftCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {driftCount} with drift between the two registries
                    </span>
                  ) : (
                    "No drift between access and attribution."
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TooltipProvider>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[240px] text-left">Person</TableHead>
                        <TableHead className="w-[130px] text-left">ESH access</TableHead>
                        <TableHead className="w-[190px] text-left">ESH roles</TableHead>
                        <TableHead className="w-[130px] text-left">Team</TableHead>
                        <TableHead className="w-[150px] text-left">Intercom ID</TableHead>
                        <TableHead className="w-[150px] text-left">Slack ID</TableHead>
                        <TableHead className="w-[110px] text-left">Dashboard</TableHead>
                        <TableHead className="text-left">Drift</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-sm text-muted-foreground">
                            No people match this search.
                          </TableCell>
                        </TableRow>
                      )}
                      {rows.map((r) => {
                        const t = r.teammate;
                        const hasAdmin = r.roles.includes("admin");
                        const hasEditor = r.roles.includes("editor");
                        const isLastAdmin = hasAdmin && adminCount === 1;
                        const canRole = !!r.userId && r.accessStatus !== "blocked";
                        return (
                          <TableRow key={r.key}>
                            <TableCell className="text-left">
                              <div className="font-medium">
                                {r.name ?? r.email ?? "—"}
                                {r.userId && r.userId === selfId && (
                                  <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                                )}
                              </div>
                              {r.name && r.email && (
                                <div className="text-xs text-muted-foreground">{r.email}</div>
                              )}
                              {!r.email && (
                                <div className="text-xs text-muted-foreground">no email on roster</div>
                              )}
                            </TableCell>
                            <TableCell className="text-left">
                              <div className="flex flex-col items-start gap-1">
                                {r.hasAccess ? (
                                  <Badge
                                    variant={
                                      r.accessStatus === "active"
                                        ? "default"
                                        : r.accessStatus === "blocked"
                                          ? "destructive"
                                          : "outline"
                                    }
                                  >
                                    {r.accessStatus}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    {t?.role === "ai"
                                      ? "no login (AI)"
                                      : t && !t.hub_access_expected
                                        ? "Internal, no login"
                                        : "no login"}
                                  </span>
                                )}
                                {!r.hasAccess && r.email?.endsWith("@lovable.dev") && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    disabled={savingKey === r.key}
                                    onClick={() => grantAccess(r)}
                                  >
                                    Grant access
                                  </Button>
                                )}
                                {!r.hasAccess && t && t.role !== "ai" && (
                                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Checkbox
                                      checked={!t.hub_access_expected}
                                      disabled={savingKey === r.key}
                                      onCheckedChange={(v) => toggleAccessExpected(r, !v)}
                                    />
                                    Internal, no Hub login
                                  </label>
                                )}
                                {r.email && r.accessStatus === "pending" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    disabled={savingKey === r.key}
                                    onClick={() => callAccess("provision", r)}
                                  >
                                    Provision
                                  </Button>
                                )}
                                {r.email && r.hasAccess && r.accessStatus !== "blocked" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    disabled={savingKey === r.key}
                                    onClick={() => setConfirmBlock(r)}
                                  >
                                    Remove access
                                  </Button>
                                )}
                                {r.email && r.accessStatus === "blocked" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-xs"
                                    disabled={savingKey === r.key}
                                    onClick={() => callAccess("unblock", r)}
                                  >
                                    Unblock
                                  </Button>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="text-left">
                              {canRole ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="flex items-center gap-1 text-xs">
                                    <Checkbox
                                      checked={hasEditor}
                                      disabled={savingKey === r.key}
                                      onCheckedChange={(v) => setRole(r, "editor", !!v)}
                                    />
                                    editor
                                  </label>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <label className="flex items-center gap-1 text-xs">
                                        <Checkbox
                                          checked={hasAdmin}
                                          disabled={savingKey === r.key || isLastAdmin}
                                          onCheckedChange={(v) => setRole(r, "admin", !!v)}
                                        />
                                        admin
                                      </label>
                                    </TooltipTrigger>
                                    {isLastAdmin && (
                                      <TooltipContent>
                                        Last admin — grant admin to someone else first.
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </div>
                              ) : r.roles.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {r.roles.map((role) => (
                                    <Badge key={role} variant={roleBadge(role)}>
                                      {role}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-left">
                              <div className="flex items-center gap-1">
                                <Select
                                  value={t?.role ?? "none"}
                                  disabled={savingKey === r.key || !r.email}
                                  onValueChange={(v) => setTeam(r, v)}
                                >
                                  <SelectTrigger className="h-8 w-[110px]">
                                    <SelectValue placeholder="—" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">—</SelectItem>
                                    {TEAM_ROLES.map((role) => (
                                      <SelectItem key={role} value={role}>
                                        {role}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {t && !t.active && (
                                  <span className="text-xs text-muted-foreground">inactive</span>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="text-left">
                              <IdCell r={r} field="intercom" />
                            </TableCell>
                            <TableCell className="text-left">
                              <IdCell r={r} field="slack" />
                            </TableCell>
                            <TableCell className="text-left">
                              {t ? (
                                <Switch
                                  checked={t.show_dashboard}
                                  disabled={savingKey === r.key}
                                  onCheckedChange={(v) => toggleDashboard(r, v)}
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-left">
                              {r.drift.length === 0 ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {r.drift.map((d) => (
                                    <Tooltip key={d}>
                                      <TooltipTrigger asChild>
                                        <Badge
                                          variant="outline"
                                          className="border-amber-500/40 text-amber-600"
                                        >
                                          {d}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Present in one registry but not matched in the other, or
                                        missing an identity its role needs.
                                      </TooltipContent>
                                    </Tooltip>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TooltipProvider>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => (o ? setAddOpen(true) : (setAddOpen(false), resetAddForm()))}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add person</DialogTitle>
            <DialogDescription>
              Creates the attribution roster entry. Tick Hub login to also create their ESH account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Alex K" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  placeholder="person@lovable.dev"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Team</Label>
                <Select value={fTeam} onValueChange={setFTeam}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Slack ID</Label>
                <Input value={fSlack} onChange={(e) => setFSlack(e.target.value)} placeholder="U0…" />
              </div>
              <div className="space-y-1">
                <Label>Intercom ID</Label>
                <Input
                  value={fIntercom}
                  onChange={(e) => setFIntercom(e.target.value)}
                  placeholder="10765619"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Support teammates need an Intercom Admin ID — only their replies stop the first-response
              clock. CSM / other are relay-only.
            </p>
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={fDashboard} onCheckedChange={(v) => setFDashboard(!!v)} />
                Show a dashboard entry for them
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={fLogin} onCheckedChange={(v) => setFLogin(!!v)} />
                Create a Hub login (provisions the account)
              </label>
              {!fLogin && (
                <p className="ml-6 text-xs text-muted-foreground">
                  Left off, this person is attribution only — no "No Hub login" warning. You can
                  grant access later from their row.
                </p>
              )}
              {fLogin && (
                <div className="ml-6 flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={fEditor} onCheckedChange={(v) => setFEditor(!!v)} />
                    editor
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={fAdmin} onCheckedChange={(v) => setFAdmin(!!v)} />
                    admin
                  </label>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetAddForm(); }}>
              Cancel
            </Button>
            <Button onClick={addPerson} disabled={addBusy}>
              {addBusy ? "Adding…" : "Add person"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmBlock} onOpenChange={(o) => !o && setConfirmBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove ESH access for {confirmBlock?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their Hub account is deleted and the roster row is marked blocked. Attribution history
              and their roster entry are untouched. This can be undone with Unblock, which requires
              re-provisioning.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const r = confirmBlock!;
                setConfirmBlock(null);
                callAccess("block", r);
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
};

export default People;
