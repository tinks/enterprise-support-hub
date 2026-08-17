import { Eye } from "lucide-react";
import { useCanEdit } from "@/hooks/useCanEdit";

/**
 * Shown on pages that a read-only account CAN view but not change, so a failed
 * save is never the first hint that the account lacks the editor role.
 * Renders nothing for editors/admins.
 */
const ReadOnlyBanner = ({ className = "" }: { className?: string }) => {
  const { canEdit, isLoading } = useCanEdit();
  if (isLoading || canEdit) return null;

  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground ${className}`}
    >
      <Eye className="h-3.5 w-3.5 shrink-0" />
      Read-only account — you can view everything here, but edits are blocked. Ask a Hub admin for
      the editor role.
    </div>
  );
};

export default ReadOnlyBanner;
