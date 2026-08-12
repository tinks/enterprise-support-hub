import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ExternalLink } from "lucide-react";
import { intercomUrl } from "@/lib/intercom";

export type IssueColumn<T> = {
  /** Stable key for React. */
  key: string;
  header: ReactNode;
  /** Tailwind width class, e.g. "w-[140px]". Omit for the flexible column (usually Subject). */
  width?: string;
  /** Extra classes applied to the body cell. */
  cellClassName?: string;
  /** Native title tooltip on the header cell. */
  headerTitle?: string;
  cell: (row: T) => ReactNode;
};

type Props<T> = {
  rows: T[];
  columns: IssueColumn<T>[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
  /** Row tint / grading (Triage bands, Escalation state). */
  rowClassName?: (row: T) => string | undefined;
  /** Opens the read-only detail sheet. Interactive cells must stopPropagation. */
  onRowClick?: (row: T) => void;
};

/**
 * The shared v3 issue table. Owns column layout, density, loading/empty states,
 * and row-click behaviour so every issue surface reads identically.
 */
export function IssueTable<T>({
  rows,
  columns,
  getRowKey,
  loading,
  emptyMessage = "No rows match these filters.",
  loadingMessage = "Loading…",
  rowClassName,
  onRowClick,
}: Props<T>) {
  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} title={c.headerTitle} className={`text-left ${c.width ?? ""}`}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> {loadingMessage}
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-sm text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={getRowKey(row)}
                className={`${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={`text-left ${c.cellClassName ?? ""}`}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** The canonical Intercom affordance across every issue view. */
export function IntercomIdChip({ id }: { id: string }) {
  return (
    <a
      href={intercomUrl(id)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open in Intercom"
      className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
    >
      {id}
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}
