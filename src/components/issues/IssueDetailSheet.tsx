import type { ReactNode } from "react";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Check } from "lucide-react";
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
    <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[140px_1fr] gap-3 items-start">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm break-words ${mono ? "font-mono text-xs" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

/** Compact label/value pair for the dense two-column metadata grid. */
export function IssueStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm break-words">{value || "—"}</div>
    </div>
  );
}

/** The Intercom conversation ID, always visible and one click to copy. */
export function ConversationIdChip({ conversationId }: { conversationId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-xs">
      {conversationId}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        title="Copy Intercom conversation ID"
        onClick={() => {
          void navigator.clipboard.writeText(conversationId);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      </Button>
    </span>
  );
}

/** Shared read-only detail sheet for every issue view. */
export function IssueDetailSheet({
  open,
  onOpenChange,
  title,
  conversationId,
  /** Widen the sheet on large monitors — for panels that carry write controls. */
  wide,
  /** Replace the default <dl> body wrapper with raw children. */
  raw,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  conversationId: string | null;
  wide?: boolean;
  raw?: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={
          wide
            ? "w-full p-4 sm:p-6 sm:max-w-[640px] lg:!max-w-[760px] xl:!max-w-[860px] overflow-auto"
            : "w-full sm:w-[480px] sm:max-w-[480px] overflow-auto p-4 sm:p-6"
        }
      >
        <SheetHeader>
          <SheetTitle className="pr-8 leading-snug">{title}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {conversationId ? (
                <>
                  <ConversationIdChip conversationId={conversationId} />
                  <a
                    href={intercomUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    Open in Intercom <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </div>
          </SheetDescription>
        </SheetHeader>
        {raw ? (
          <div className="mt-5">{children}</div>
        ) : (
          <dl className="mt-6 space-y-3 text-sm">{children}</dl>
        )}
      </SheetContent>
    </Sheet>
  );
}
