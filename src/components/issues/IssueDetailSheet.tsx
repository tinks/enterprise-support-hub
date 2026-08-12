import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExternalLink } from "lucide-react";
import { intercomUrl } from "@/lib/intercom";

export function IssueField({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm break-words ${mono ? "font-mono text-xs" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

/** Shared read-only detail sheet for every issue view. */
export function IssueDetailSheet({
  open,
  onOpenChange,
  title,
  conversationId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  conversationId: string | null;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-auto">
        <SheetHeader>
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription>
            {conversationId ? (
              <a
                href={intercomUrl(conversationId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                Open in Intercom <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <dl className="mt-6 space-y-3 text-sm">{children}</dl>
      </SheetContent>
    </Sheet>
  );
}
