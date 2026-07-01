import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

interface UserRow {
  id: string;
  email: string | null;
  created_at: string;
  roles: string[];
}

const RolesCard = () => {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSelfId(data.session?.user?.id ?? null));
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_users_with_roles");
    if (error) {
      toast.error("Failed to load users: " + error.message);
      setUsers([]);
    } else {
      setUsers((data ?? []) as UserRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const adminCount = users.filter((u) => u.roles.includes("admin")).length;

  const grantAdmin = async (userId: string) => {
    setBusyId(userId);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: "admin" });
    if (error) toast.error("Grant failed: " + error.message);
    else {
      toast.success("Admin granted");
      await load();
    }
    setBusyId(null);
  };

  const revokeAdmin = async (userId: string) => {
    setBusyId(userId);
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "admin");
    if (error) toast.error("Revoke failed: " + error.message);
    else {
      toast.success("Admin revoked");
      await load();
    }
    setBusyId(null);
  };

  if (adminLoading) return null;
  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Roles &amp; permissions</CardTitle>
          <CardDescription>
            Grant or revoke the admin role. Admin unlocks role management and future admin-gated features.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={150}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                    No users
                  </TableCell>
                </TableRow>
              )}
              {users.map((u) => {
                const hasAdmin = u.roles.includes("admin");
                const isSelf = u.id === selfId;
                const isLastAdmin = hasAdmin && adminCount === 1;
                const revokeDisabled = busyId === u.id || (isSelf && isLastAdmin) || isLastAdmin;

                const revokeButton = (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokeDisabled}
                    onClick={() => revokeAdmin(u.id)}
                  >
                    <ShieldOff className="h-3 w-3 mr-1" />
                    Revoke admin
                  </Button>
                );

                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.email ?? <span className="text-muted-foreground">—</span>}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
                        {u.roles.map((r) => (
                          <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
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
                          disabled={busyId === u.id}
                          onClick={() => grantAdmin(u.id)}
                        >
                          <ShieldCheck className="h-3 w-3 mr-1" />
                          Grant admin
                        </Button>
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
  );
};

export default RolesCard;
