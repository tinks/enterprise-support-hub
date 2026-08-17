import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { toast } from "sonner";
import {
  RefreshCw,
  UserPlus,
  ShieldX,
  Undo2,
  AlertTriangle,
  Pencil,
  PencilOff,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

interface MemberRow {
  id: string;
  email: string;
  user_id: string | null;
  status: string;
  note: string | null;
  provisioned_at: string | null;
  blocked_at: string | null;
  created_at: string;
}

interface AuthUserRow {
  id: string;
  email: string | null;
  created_at: string;
  roles: string[];
}

/** A roster row, or a synthetic row for an auth account with no roster row. */
interface PersonRow extends MemberRow {
  untracked?: boolean;
}

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

/**
 * Single Users table: the Hub access roster (`hub_members`) merged with the
 * role assignments (`user_roles` via `list_users_with_roles`).
 *
 * Keyed by email. Drift is shown as real rows, never hidden:
 *  - an auth account with no roster row renders with status `untracked`
 *  - an active roster row whose backend account is gone is called out in the banner
 *
 * Role actions need a backend account (`user_id`), so they are disabled for
 * `pending` / `blocked` rows.
 */
const UsersCard = () => {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [authUsers, setAuthUsers] = useState<AuthUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [confirmBlock, setConfirmBlock] = useState<PersonRow | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSelfId(data.session?.user?.id ?? null));
  }, []);

  const load = async () => {
    setLoading(true);
    const [{ data: m, error: mErr }, { data: u, error: uErr }] = await Promise.all([
      supabase.from("hub_members").select("*").order("email"),
      supabase.rpc("list_users_with_roles"),
    ]);
    if (mErr) toast.error("Failed to load members: " + mErr.message);
    if (uErr) toast.error("Failed to load accounts: " + uErr.message);
    setMembers((m ?? []) as MemberRow[]);
    setAuthUsers((u ?? []) as AuthUserRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const call = async (action: string, email: string) => {
    setBusy(email);
    const { data, error } = await supabase.functions.invoke("hub-access-manage", {
      body: { action, email },
    });
    const errMsg = error?.message ?? (data as any)?.error;
    if (errMsg) toast.error(`${action} failed: ${errMsg}`);
    else {
      toast.success(`${action} complete for ${email}`);
      await load();
    }
    setBusy(null);
  };

  const addMember = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (email.split("@")[1] !== "lovable.dev") {
      toast.error("Only @lovable.dev addresses can be added");
      return;
    }
    setBusy(email);
    const { data: session } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("hub_members")
      .insert({ email, status: "pending", added_by: session.session?.user?.id ?? null });
    if (error) toast.error("Add failed: " + error.message);
    else {
      toast.success(`${email} added — click Provision to create their account`);
      setNewEmail("");
      await load();
    }
    setBusy(null);
  };

  const setRole = async (
    email: string,
    userId: string,
    role: "admin" | "editor",
    grant: boolean,
  ) => {
    setBusy(email);
    const { error } = grant
      ? await supabase.from("user_roles").insert({ user_id: userId, role })
      : await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) toast.error(`${grant ? "Grant" : "Revoke"} failed: ` + error.message);
    else {
      toast.success(`${role === "admin" ? "Admin" : "Editor"} ${grant ? "granted" : "revoked"}`);
      await load();
    }
    setBusy(null);
  };

  if (adminLoading || !isAdmin) return null;

  const rosterEmails = new Set(members.map((m) => m.email.toLowerCase()));
  const untracked = authUsers.filter((u) => u.email && !rosterEmails.has(u.email.toLowerCase()));
  const authIds = new Set(authUsers.map((u) => u.id));
  const missing = members.filter(
    (m) => m.status === "active" && (!m.user_id || !authIds.has(m.user_id)),
  );
  const rolesFor = (userId: string | null) => authUsers.find((u) => u.id === userId)?.roles ?? [];
  const adminCount = authUsers.filter((u) => u.roles.includes("admin")).length;

  const rows: PersonRow[] = [
    ...members,
    ...untracked.map<PersonRow>((u) => ({
      id: `untracked-${u.id}`,
      email: (u.email ?? "").toLowerCase(),
      user_id: u.id,
      status: "untracked",
      note: null,
      provisioned_at: null,
      blocked_at: null,
      created_at: u.created_at,
      untracked: true,
    })),
  ].sort((a, b) => a.email.localeCompare(b.email));

  const statusVariant = (s: string) =>
    s === "active" ? "default" : s === "blocked" ? "destructive" : s === "untracked" ? "outline" : "secondary";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Roster &amp; roles</CardTitle>
          <CardDescription>

            Who can sign in to the Hub, and what they may do. Add a <code>@lovable.dev</code> address,
            provision the account, and they sign in with their Lovable workspace identity — self-signup
            stays closed, so this roster is the only way in. Editor allows changing data (tickets, notes,
            registry, settings); without it an account is read-only. Admin adds role and access management.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="person@lovable.dev"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
            className="max-w-xs"
          />
          <Button onClick={addMember} disabled={!!busy || !newEmail.trim()}>
            <UserPlus className="h-3 w-3 mr-1" />
            Add to roster
          </Button>
        </div>

        {(untracked.length > 0 || missing.length > 0) && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Roster drift
            </div>
            {untracked.length > 0 && (
              <p className="text-muted-foreground">
                {untracked.length} account(s) with no roster row — listed below as{" "}
                <span className="font-medium">untracked</span>.
              </p>
            )}
            {missing.length > 0 && (
              <p className="text-muted-foreground">
                {missing.length} active row(s) with no backend account:{" "}
                {missing.map((m) => m.email).join(", ")}
              </p>
            )}
          </div>
        )}

        <TooltipProvider delayDuration={150}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Provisioned</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    No users yet
                  </TableCell>
                </TableRow>
              )}
              {rows.map((m) => {
                const roles = rolesFor(m.user_id);
                const hasAccount = !!m.user_id && authIds.has(m.user_id);
                const hasAdmin = roles.includes("admin");
                const isSelf = !!m.user_id && m.user_id === selfId;
                const isLastAdmin = hasAdmin && adminCount === 1;
                const rowBusy = busy === m.email;

                const revokeButton = (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rowBusy || isLastAdmin}
                    onClick={() => setRole(m.email, m.user_id!, "admin", false)}
                  >
                    <ShieldOff className="h-3 w-3 mr-1" />
                    Revoke admin
                  </Button>
                );

                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {m.email}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(m.status) as any}>{m.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">none</span>
                        ) : (
                          roles.map((r) => (
                            <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                              {r}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmt(m.created_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmt(m.provisioned_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {/* Access actions */}
                        {m.status === "pending" && (
                          <Button size="sm" disabled={rowBusy} onClick={() => call("provision", m.email)}>
                            <UserPlus className="h-3 w-3 mr-1" />
                            Provision
                          </Button>
                        )}
                        {m.status === "blocked" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowBusy}
                            onClick={() => call("unblock", m.email)}
                          >
                            <Undo2 className="h-3 w-3 mr-1" />
                            Unblock
                          </Button>
                        )}
                        {m.status !== "blocked" && !m.untracked && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowBusy}
                            onClick={() => setConfirmBlock(m)}
                          >
                            <ShieldX className="h-3 w-3 mr-1" />
                            Remove access
                          </Button>
                        )}

                        {/* Role actions — need a backend account */}
                        {!hasAccount ? (
                          <span className="text-xs text-muted-foreground self-center">
                            no account yet
                          </span>
                        ) : (
                          <>
                            {hasAdmin ? (
                              <span className="text-xs text-muted-foreground self-center">
                                editor implied
                              </span>
                            ) : roles.includes("editor") ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={rowBusy}
                                onClick={() => setRole(m.email, m.user_id!, "editor", false)}
                              >
                                <PencilOff className="h-3 w-3 mr-1" />
                                Make read-only
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={rowBusy}
                                onClick={() => setRole(m.email, m.user_id!, "editor", true)}
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Grant editor
                              </Button>
                            )}
                            {hasAdmin ? (
                              isLastAdmin ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span tabIndex={0}>{revokeButton}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>Cannot remove the last admin</TooltipContent>
                                </Tooltip>
                              ) : (
                                revokeButton
                              )
                            ) : (
                              <Button
                                variant="default"
                                size="sm"
                                disabled={rowBusy}
                                onClick={() => setRole(m.email, m.user_id!, "admin", true)}
                              >
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Grant admin
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TooltipProvider>
      </CardContent>

      <AlertDialog open={!!confirmBlock} onOpenChange={(o) => !o && setConfirmBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove access for {confirmBlock?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes their Hub account and marks the roster row blocked. They can no longer sign
              in, even while they remain in the Lovable workspace. The row stays as a record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const email = confirmBlock!.email;
                setConfirmBlock(null);
                call("block", email);
              }}
            >
              Remove access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default UsersCard;
