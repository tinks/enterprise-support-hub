import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * People — a READ-ONLY join of the two people registries. Nothing here writes.
 *
 *  - Access:      hub_members + user_roles (via list_users_with_roles)   -> can they sign in, what may they change
 *  - Attribution: teammates                                             -> whose work is it, does their reply stop the FRT clock
 *
 * Joined on lowercased email. Rows that exist on only one side are kept and
 * labelled as drift rather than hidden — that drift is the whole point of the page.
 * Edits still happen on their owning surfaces (Users / Settings > Teammates).
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
}

interface PersonRow {
  key: string;
  email: string | null;
  name: string | null;
  // access side
  hasAccess: boolean;
  accessStatus: string | null;
  roles: string[];
  // attribution side
  teammate: TeammateRow | null;
  drift: string[];
}

const roleBadge = (r: string) =>
  r === "admin" ? "default" : r === "editor" ? "secondary" : "outline";

const TEAM_ROLES = ["support", "csm", "other", "ai"] as const;

const People = () => {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [authUsers, setAuthUsers] = useState<AuthUserRow[]>([]);
  const [teammates, setTeammates] = useState<TeammateRow[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [confirmBlock, setConfirmBlock] = useState<PersonRow | null>(null);

  const callAccess = async (action: "block" | "unblock", r: PersonRow) => {
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
      await load();
    } catch (e) {
      toast.error("Could not update roster: " + (e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };


  const load = async () => {
    setLoading(true);
    const [{ data: m, error: mErr }, { data: u, error: uErr }, { data: t, error: tErr }] =
      await Promise.all([
        supabase.from("hub_members").select("email,user_id,status,note").order("email"),
        supabase.rpc("list_users_with_roles"),
        supabase
          .from("teammates")
          .select("id,name,email,role,active,show_dashboard,intercom_admin_id,slack_user_id")
          .order("name"),
      ]);
    if (mErr) toast.error("Failed to load access roster: " + mErr.message);
    if (uErr) toast.error("Failed to load accounts: " + uErr.message);
    if (tErr) toast.error("Failed to load teammates: " + tErr.message);
    setMembers((m ?? []) as MemberRow[]);
    setAuthUsers((u ?? []) as AuthUserRow[]);
    setTeammates((t ?? []) as TeammateRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
    else if (!adminLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, adminLoading]);

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
          roles: [],
          teammate: null,
          drift: [],
        };
        byKey.set(key, r);
      }
      return r;
    };

    const rolesByEmail = new Map<string, string[]>();
    for (const a of authUsers) {
      const k = norm(a.email);
      if (k) rolesByEmail.set(k, a.roles ?? []);
    }

    for (const m of members) {
      const k = norm(m.email);
      const r = ensure(k, m.email);
      r.hasAccess = true;
      r.accessStatus = m.status;
      r.roles = rolesByEmail.get(k) ?? [];
    }
    // auth accounts with no roster row
    for (const a of authUsers) {
      const k = norm(a.email);
      if (!k || byKey.has(k)) continue;
      const r = ensure(k, a.email);
      r.hasAccess = true;
      r.accessStatus = "untracked";
      r.roles = a.roles ?? [];
    }

    for (const t of teammates) {
      const k = norm(t.email) || `teammate:${t.id}`;
      const r = ensure(k, t.email);
      r.teammate = t;
      r.name = t.name;
    }

    for (const r of byKey.values()) {
      const t = r.teammate;
      if (!r.hasAccess && t) r.drift.push("No Hub login");
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

  return (
    <AppLayout>
      <div className="bg-background p-6">
        <div className="mx-auto max-w-[1700px] space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground">People</h1>
              <p className="text-sm text-muted-foreground">
                One row per person: Hub access on the left, ticket attribution on the right.
                Read-only — edit access under{" "}
                <Link to="/users" className="underline">
                  Users
                </Link>{" "}
                and attribution under{" "}
                <Link to="/settings" className="underline">
                  Settings &rsaquo; Teammates
                </Link>
                .
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
                        <TableHead className="w-[260px] text-left">Person</TableHead>
                        <TableHead className="w-[120px] text-left">ESH access</TableHead>
                        <TableHead className="w-[160px] text-left">ESH roles</TableHead>
                        <TableHead className="w-[140px] text-left">Team</TableHead>
                        <TableHead className="w-[140px] text-left">Intercom ID</TableHead>
                        <TableHead className="w-[140px] text-left">Slack ID</TableHead>
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
                        return (
                          <TableRow key={r.key}>
                            <TableCell className="text-left">
                              <div className="font-medium">{r.name ?? r.email ?? "—"}</div>
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
                                  <span className="text-xs text-muted-foreground">no login</span>
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
                              {r.roles.length ? (
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

                            <TableCell className="text-left font-mono text-xs">
                              {t?.intercom_admin_id ?? "—"}
                            </TableCell>
                            <TableCell className="text-left font-mono text-xs">
                              {t?.slack_user_id ?? "—"}
                            </TableCell>
                            <TableCell className="text-left text-xs">
                              {t ? (t.show_dashboard ? "shown" : "hidden") : "—"}
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
