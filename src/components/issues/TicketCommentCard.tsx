import { useState } from "react";
import { format } from "date-fns";
import { COMMENT_CAP, type TicketComment } from "@/lib/ticketComments";

/**
 * One capped, expandable message card. Display only — read straight off the
 * persisted Intercom payload, never fetched and never written back.
 */
export function TicketCommentCard({ comment, label }: { comment: TicketComment; label: string }) {
  const [open, setOpen] = useState(false);
  const long = comment.text.length > COMMENT_CAP;
  const shown = open || !long ? comment.text : `${comment.text.slice(0, COMMENT_CAP).trimEnd()}…`;

  return (
    <div className="rounded-md border p-3 space-y-1.5 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-xs font-medium">{comment.author}</span>
        {comment.authorType ? (
          <span className="text-[10px] text-muted-foreground">({comment.authorType})</span>
        ) : null}
        {comment.atMs ? (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {format(new Date(comment.atMs), "d MMM yyyy HH:mm")}
          </span>
        ) : null}
      </div>
      <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">{shown}</p>
      {long ? (
        <button
          type="button"
          className="text-[10px] text-primary underline"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
