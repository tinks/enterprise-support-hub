import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useShowTestData } from "@/lib/testTickets";

/**
 * Shared escape hatch that reveals Hub-designated test tickets on reporting
 * surfaces. Off by default; the preference is global so all surfaces agree.
 */
export function TestDataToggle({ className }: { className?: string }) {
  const [show, setShow] = useShowTestData();
  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Switch id="show-test-data" checked={show} onCheckedChange={setShow} />
      <Label htmlFor="show-test-data" className="text-xs text-muted-foreground cursor-pointer">
        Show test tickets
      </Label>
    </div>
  );
}
