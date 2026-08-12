import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { IntercomIdChip, type IssueColumn } from "./IssueTable";

/** Column 1 everywhere: the Intercom conversation ID as a link. */
export function idColumn<T>(get: (row: T) => string): IssueColumn<T> {
  return {
    key: "intercom_id",
    header: "Intercom ID",
    width: "w-[150px]",
    cell: (r) => <IntercomIdChip id={get(r)} />,
  };
}

/** Column 2: subject, with an optional muted second line. */
export function subjectColumn<T>(
  get: (row: T) => string | null,
  secondary?: (row: T) => ReactNode,
): IssueColumn<T> {
  return {
    key: "subject",
    header: "Subject",
    cellClassName: "max-w-[380px]",
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate">{get(r) || "Untitled"}</div>
        {secondary ? <div className="text-[10px] text-muted-foreground truncate">{secondary(r)}</div> : null}
      </div>
    ),
  };
}

/** Column 3: contact name over email. */
export function contactColumn<T>(
  getName: (row: T) => string | null,
  getEmail: (row: T) => string | null,
): IssueColumn<T> {
  return {
    key: "contact",
    header: "Contact",
    width: "w-[200px]",
    cellClassName: "text-xs",
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate">{getName(r) || "—"}</div>
        <div className="text-muted-foreground truncate">{getEmail(r) || "—"}</div>
      </div>
    ),
  };
}

/** Column 4: resolved customer account label. */
export function customerColumn<T>(
  getKey: (row: T) => string | null,
  accountLabel: (key: string | null) => string,
): IssueColumn<T> {
  return {
    key: "customer",
    header: "Customer",
    width: "w-[170px]",
    cell: (r) => (
      <Badge variant="secondary" className="text-[10px]">
        {accountLabel(getKey(r))}
      </Badge>
    ),
  };
}

/** Column 5: owner. */
export function ownerColumn<T>(get: (row: T) => string | null): IssueColumn<T> {
  return {
    key: "owner",
    header: "Owner",
    width: "w-[120px]",
    cellClassName: "text-xs",
    cell: (r) => get(r) || "—",
  };
}

/** Trailing column: age in days since creation, with the creation date underneath. */
export function ageColumn<T>(
  getCreatedMs: (row: T) => number | null,
  opts?: { header?: string; width?: string },
): IssueColumn<T> {
  return {
    key: "age",
    header: opts?.header ?? "Age",
    width: opts?.width ?? "w-[110px]",
    cellClassName: "text-xs tabular-nums",
    cell: (r) => {
      const ms = getCreatedMs(r);
      if (ms == null) return "—";
      const days = Math.floor((Date.now() - ms) / 86_400_000);
      return (
        <div>
          <div>{days}d</div>
          <div className="text-[10px] text-muted-foreground">{format(new Date(ms), "d MMM")}</div>
        </div>
      );
    },
  };
}
