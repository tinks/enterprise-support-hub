import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Users, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { toast } from "sonner";

type TeammateRole = "support" | "csm" | "other" | "ai";

interface Teammate {
  id: string;
  intercom_admin_id: string | null;
  email: string | null;
  name: string;
  /** Slack member ID (U…), used to @-mention on float coverage shifts. */
  slack_user_id: string | null;
  role: TeammateRole;
  active: boolean;
  show_dashboard: boolean;
}

interface SettingsData {
  id: string;
  monitored_channels: string;
  intercom_inbox_id: string;
  intercom_assignee_id: string;
  slack_bot_user_id: string;
  testing_mode: boolean;
  test_intercom_inbox_id: string;
  auto_mark_employee_test: boolean;
  product_areas: string;
}

interface AdminMappingCardProps {
  settings: SettingsData | null;
  setSettings: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  onSave: () => void;
}

const ROLES: TeammateRole[] = ["support", "csm", "other", "ai"];

/**
 * Roles that are relay-only: on the roster so Slack replies resolve to a known
 * person (no Action Center identity gap), but with no Intercom admin id and —
 * critically — never counted for First Response. Only role='support' drives the
 * FRT clock (see useSlaBatch).
 */
const RELAY_ONLY_ROLES = new Set<TeammateRole>(["csm", "other"]);

const AdminMappingCard = ({ settings, setSettings }: AdminMappingCardProps) => {
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<Teammate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newAdminId, setNewAdminId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newSlackId, setNewSlackId] = useState("");
  const [newRole, setNewRole] = useState<TeammateRole>("support");

  const load = async () => {
    const { data, error } = await supabase
      .from("teammates")
      .select("id, intercom_admin_id, email, name, slack_user_id, role, active, show_dashboard")
      .order("name");
    if (error) {
      toast.error("Failed to load teammates: " + error.message);
    } else {
      setRows((data || []) as Teammate[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Dual-write: `settings.admin_owner_map` is still the source of truth for
   * owner auto-attribution in intercom-webhook, poll-intercom-inbox,
   * sync-v3-open/closed, backfill-enterprise-inbox and
   * AnalyticsV3. Until those are repointed at `teammates`, every teammates
   * mutation mirrors the full roster (active AND inactive — historical
   * attribution must keep resolving) back into the JSON blob.
   */
  const syncBlob = async (next: Teammate[]) => {
    if (!settings) return;
    const map: Record<string, string> = {};
    for (const r of next) {
      if (r.intercom_admin_id && r.name) map[r.intercom_admin_id] = r.name;
    }
    const json = JSON.stringify(map);
    setSettings((s) => (s ? ({ ...s, admin_owner_map: json } as any) : s));
    const { error } = await supabase
      .from("settings")
      .update({ admin_owner_map: json } as any)
      .eq("id", settings.id);
    if (error) toast.error("Failed to sync owner map: " + error.message);
  };

  const addRow = async () => {
    const intercom_admin_id = newAdminId.trim();
    const name = newName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    if (!intercom_admin_id && !RELAY_ONLY_ROLES.has(newRole)) {
      toast.error("Admin ID is required for this role");
      return;
    }
    if (!intercom_admin_id && !newSlackId.trim() && !newEmail.trim()) {
      toast.error("A relay-only teammate needs a Slack ID or email");
      return;
    }
    setBusyId("new");
    const { data, error } = await supabase
      .from("teammates")
      .insert({
        intercom_admin_id: intercom_admin_id || null,
        email: newEmail.trim() || null,
        name,
        slack_user_id: newSlackId.trim() || null,
        role: newRole,
      })
      .select("id, intercom_admin_id, email, name, slack_user_id, role, active, show_dashboard")
      .single();
    setBusyId(null);
    if (error) {
      toast.error("Failed to add teammate: " + error.message);
      return;
    }
    const next = [...rows, data as Teammate].sort((a, b) => a.name.localeCompare(b.name));
    setRows(next);
    setNewAdminId("");
    setNewEmail("");
    setNewName("");
    setNewSlackId("");
    setNewRole("support");
    await syncBlob(next);
    toast.success(`${name} added`);
  };

  const patchLocal = (id: string, patch: Partial<Teammate>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const saveRow = async (row: Teammate) => {
    const adminId = (row.intercom_admin_id ?? "").trim();
    if (!row.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!adminId && !RELAY_ONLY_ROLES.has(row.role)) {
      toast.error("Admin ID is required for this role");
      return;
    }
    setBusyId(row.id);
    const { error } = await supabase
      .from("teammates")
      .update({
        intercom_admin_id: adminId || null,
        email: row.email?.trim() || null,
        name: row.name.trim(),
        slack_user_id: row.slack_user_id?.trim() || null,
        role: row.role,
        active: row.active,
      })
      .eq("id", row.id);
    setBusyId(null);
    if (error) {
      toast.error("Failed to save: " + error.message);
      return;
    }
    await syncBlob(rows.map((r) => (r.id === row.id ? row : r)));
    toast.success(`${row.name} saved`);
  };

  const toggleActive = async (row: Teammate, active: boolean) => {
    patchLocal(row.id, { active });
    setBusyId(row.id);
    const { error } = await supabase.from("teammates").update({ active }).eq("id", row.id);
    setBusyId(null);
    if (error) {
      patchLocal(row.id, { active: row.active });
      toast.error("Failed to update: " + error.message);
    }
  };

  /** Controls whether this person gets an entry in the Dashboards nav flyout. */
  const toggleDashboard = async (row: Teammate, show_dashboard: boolean) => {
    patchLocal(row.id, { show_dashboard });
    setBusyId(row.id);
    const { error } = await supabase
      .from("teammates")
      .update({ show_dashboard } as any)
      .eq("id", row.id);
    setBusyId(null);
    if (error) {
      patchLocal(row.id, { show_dashboard: row.show_dashboard });
      toast.error("Failed to update: " + error.message);
    }
  };



  const removeRow = async (row: Teammate) => {
    setBusyId(row.id);
    const { error } = await supabase.from("teammates").delete().eq("id", row.id);
    setBusyId(null);
    if (error) {
      toast.error("Failed to remove: " + error.message);
      return;
    }
    const next = rows.filter((r) => r.id !== row.id);
    setRows(next);
    await syncBlob(next);
    toast.success(`${row.name} removed`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Teammates (admin → owner)
        </CardTitle>
        <CardDescription>
          Canonical roster of Intercom admins. Used to auto-assign the owner when a conversation is
          assigned in Intercom. <span className="font-medium">Active</span> is roster status only —
          historical replies always count towards SLA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading teammates…
          </div>
        ) : rows.length === 0 ? (
          <span className="text-sm text-muted-foreground">No teammates configured</span>
        ) : (
          <div className="space-y-2">
            <div className="hidden lg:grid grid-cols-[110px_minmax(0,1.3fr)_minmax(90px,1fr)_110px_100px_56px_74px_120px] gap-2 text-xs text-muted-foreground px-2 border border-transparent">
              <span className="truncate">Intercom admin ID</span>
              <span className="truncate">Email</span>
              <span className="truncate">Name</span>
              <span className="truncate">Slack ID</span>
              <span className="truncate">Role</span>
              <span className="text-center">Active</span>
              <span className="text-center">Dashboard</span>
              <span />
            </div>
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-1 lg:grid-cols-[110px_minmax(0,1.3fr)_minmax(90px,1fr)_110px_100px_56px_74px_120px] gap-2 items-center rounded-md border p-2"
              >

                <Input
                  className="min-w-0"
                  value={row.intercom_admin_id ?? ""}
                  placeholder={RELAY_ONLY_ROLES.has(row.role) ? "— relay only" : ""}
                  disabled={!isAdmin}
                  onChange={(e) => patchLocal(row.id, { intercom_admin_id: e.target.value })}
                />
                <Input
                  className="min-w-0"
                  value={row.email ?? ""}
                  placeholder="—"
                  disabled={!isAdmin}
                  onChange={(e) => patchLocal(row.id, { email: e.target.value })}
                />
                <Input
                  className="min-w-0"
                  value={row.name}
                  disabled={!isAdmin}
                  onChange={(e) => patchLocal(row.id, { name: e.target.value })}
                />
                <Input
                  className="min-w-0"
                  value={row.slack_user_id ?? ""}
                  placeholder="U…"
                  disabled={!isAdmin}
                  onChange={(e) => patchLocal(row.id, { slack_user_id: e.target.value })}
                />
                {isAdmin ? (
                  <Select
                    value={row.role}
                    onValueChange={(v) => patchLocal(row.id, { role: v as TeammateRole })}
                  >
                    <SelectTrigger className="min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary" className="justify-self-start">
                    {row.role}
                  </Badge>
                )}
                <div className="flex justify-center">
                  <Switch
                    checked={row.active}
                    disabled={!isAdmin || busyId === row.id}
                    onCheckedChange={(v) => toggleActive(row, v)}
                    aria-label={`Active roster status for ${row.name}`}
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={row.show_dashboard}
                    disabled={!isAdmin || busyId === row.id || row.role === "ai"}
                    onCheckedChange={(v) => toggleDashboard(row, v)}
                    aria-label={`Show ${row.name} in Dashboards menu`}
                  />
                </div>
                {isAdmin && (

                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      disabled={busyId === row.id}
                      onClick={() => saveRow(row)}
                    >
                      {busyId === row.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => removeRow(row)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isAdmin && (
           <div className="grid grid-cols-1 lg:grid-cols-[110px_minmax(0,1.3fr)_minmax(90px,1fr)_110px_100px_202px] gap-2 items-end border-t pt-4 px-2">
            <div className="space-y-1">
              <Label className="text-xs">Admin ID</Label>
              <Input placeholder="9985999" value={newAdminId} onChange={(e) => setNewAdminId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                placeholder="name@lovable.dev"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input placeholder="Kristina" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slack ID</Label>
              <Input
                placeholder="U0B7TCDJRTQ"
                value={newSlackId}
                onChange={(e) => setNewSlackId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as TeammateRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={addRow} disabled={busyId === "new"} className="h-9 gap-1">
              {busyId === "new" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </Button>
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted-foreground">Read-only — admin role required to edit.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Changes save immediately and are mirrored into the legacy owner map used by the Intercom
          sync functions.
        </p>
      </CardContent>
    </Card>
  );
};

export default AdminMappingCard;
