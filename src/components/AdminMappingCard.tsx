import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Users } from "lucide-react";

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

const AdminMappingCard = ({ settings, setSettings, onSave }: AdminMappingCardProps) => {
  const [newAdminId, setNewAdminId] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");

  const adminMap: Record<string, string> = (() => {
    try {
      const raw = (settings as any)?.admin_owner_map;
      if (!raw || raw === "{}") return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  })();

  const entries = Object.entries(adminMap);

  const addMapping = () => {
    const id = newAdminId.trim();
    const name = newOwnerName.trim();
    if (!id || !name) return;

    const updated = { ...adminMap, [id]: name };
    setSettings((s) =>
      s ? { ...s, admin_owner_map: JSON.stringify(updated) } as any : s
    );
    setNewAdminId("");
    setNewOwnerName("");
  };

  const removeMapping = (adminId: string) => {
    const updated = { ...adminMap };
    delete updated[adminId];
    setSettings((s) =>
      s ? { ...s, admin_owner_map: JSON.stringify(updated) } as any : s
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMapping();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="h-5 w-5" />
          Admin → owner mapping
        </CardTitle>
        <CardDescription>
          Map Intercom admin IDs to owner names. When a conversation is assigned in Intercom, the owner is automatically updated.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {entries.length === 0 && (
            <span className="text-sm text-muted-foreground">No mappings configured</span>
          )}
          {entries.map(([adminId, ownerName]) => (
            <Badge key={adminId} variant="secondary" className="gap-1 pr-1">
              {adminId} → {ownerName}
              <button
                onClick={() => removeMapping(adminId)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Admin ID</Label>
            <Input
              placeholder="9985999"
              value={newAdminId}
              onChange={(e) => setNewAdminId(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Owner name</Label>
            <Input
              placeholder="Kristina"
              value={newOwnerName}
              onChange={(e) => setNewOwnerName(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <Button variant="outline" size="sm" onClick={addMapping} className="h-9 gap-1">
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Changes take effect after saving settings above.
        </p>
      </CardContent>
    </Card>
  );
};

export default AdminMappingCard;
