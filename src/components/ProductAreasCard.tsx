import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus, Tag } from "lucide-react";

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

interface ProductAreasCardProps {
  settings: SettingsData | null;
  setSettings: React.Dispatch<React.SetStateAction<SettingsData | null>>;
  onSave?: () => void;
}

const ProductAreasCard = ({ settings, setSettings, onSave }: ProductAreasCardProps) => {
  const [newArea, setNewArea] = useState("");

  const areas = (settings?.product_areas || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => {
      if (a.toLowerCase() === "other") return 1;
      if (b.toLowerCase() === "other") return -1;
      return a.localeCompare(b);
    });

  const addArea = () => {
    const trimmed = newArea.trim();
    if (!trimmed) {
      setNewArea("");
      return;
    }
    setSettings((s) => {
      if (!s) return s;
      const current = (s.product_areas || "").split(",").map(x => x.trim()).filter(Boolean);
      if (current.includes(trimmed)) return s;
      return { ...s, product_areas: [...current, trimmed].join(",") };
    });
    setNewArea("");
    setTimeout(() => onSave?.(), 0);
  };

  const removeArea = (area: string) => {
    setSettings((s) => {
      if (!s) return s;
      const current = (s.product_areas || "").split(",").map(x => x.trim()).filter(Boolean);
      const updated = current.filter((a) => a !== area).join(",");
      return { ...s, product_areas: updated };
    });
    setTimeout(() => onSave?.(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addArea();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Tag className="h-5 w-5" />
          Product areas
        </CardTitle>
        <CardDescription>
          Manage the product area options available in conversations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 min-h-[44px]">
          {areas.length === 0 && (
            <span className="text-sm text-muted-foreground">No product areas defined</span>
          )}
          {areas.map((area) => (
            <Badge key={area} variant="secondary" className="gap-1 pr-1">
              {area}
              <button
                onClick={() => removeArea(area)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="New product area..."
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={addArea} className="gap-1 h-10">
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes are saved automatically
        </p>
      </CardContent>
    </Card>
  );
};

export default ProductAreasCard;
