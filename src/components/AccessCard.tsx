import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { RefreshCw, UserPlus, ShieldX, Undo2, AlertTriangle } from "lucide-react";
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

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

const AccessCard = () => {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [authUsers, setAuthUsers] = useState<AuthUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [confirmBlock, setConfirmBlock] = useState<MemberRow | null>(null);

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

  if (adminLoading || !isAdmin) return null;

  const rosterEmails = new Set(members.map((m) => m.email));
  const untracked = authUsers.filter((u) => u.email && !rosterEmails.has(u.email.toLowerCase()));
  const authIds = new Set(authUsers.map((u) => u.id));
  const missing = members.filter((m) => m.status === "active" && (!m.user_id || !authIds.has(m.user_id)));
  const rolesFor = (userId: string | null) =>
    authUsers.find((u) => u.id === userId)?.roles ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Access</CardTitle>
          <CardDescription>
            Who can sign in to the Hub. Add a <code>@lovable.dev</code> address, provision the account,
            and they sign in with their Lovable workspace identity — no password, no invite email.
            Self-signup stays closed, so this roster is the only way in.
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
                {untracked.length} account(s) with no roster row: {untracked.map((u) => u.email).join(", ")}
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
            {members.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  No members yet
                </TableCell>
              </TableRow>
            )}
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.email}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      m.status === "active" ? "default" : m.status === "blocked" ? "destructive" : "secondary"
                    }
                  >
                    {m.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {rolesFor(m.user_id).length === 0 ? (
                      <span className="text-xs text-muted-foreground">none</span>
                    ) : (
                      rolesFor(m.user_id).map((r) => (
                        <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                          {r}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmt(m.created_at)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmt(m.provisioned_at)}</TableCell>
                <TableCell className="text-right space-x-2">
                  {m.status === "pending" && (
                    <Button size="sm" disabled={busy === m.email} onClick={() => call("provision", m.email)}>
                      <UserPlus className="h-3 w-3 mr-1" />
                      Provision
                    </Button>
                  )}
                  {m.status === "blocked" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === m.email}
                      onClick={() => call("unblock", m.email)}
                    >
                      <Undo2 className="h-3 w-3 mr-1" />
                      Unblock
                    </Button>
                  )}
                  {m.status !== "blocked" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === m.email}
                      onClick={() => setConfirmBlock(m)}
                    >
                      <ShieldX className="h-3 w-3 mr-1" />
                      Remove access
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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

export default AccessCard;
