import { useMemo, useState, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ExternalLink, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { intercomUrl } from "@/lib/intercom";

export type SortValue = string | number | null | undefined;

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
  /**
   * Makes the header click-to-sort. Return a comparable primitive; nullish
   * values always sort last regardless of direction.
   */
  sortValue?: (row: T) => SortValue;
  cell: (row: T) => ReactNode;
};

type SortState = { key: string; dir: "asc" | "desc" };

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
  /**
   * Initial sort. Omit to render `rows` in the order given — each view keeps
   * its own default order until the user clicks a header.
   */
  defaultSort?: SortState;
};

function compare(a: SortValue, b: SortValue): number {
  const aNull = a === null || a === undefined || a === "";
  const bNull = b === null || b === undefined || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nullish always last
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The shared v3 issue table. Owns column layout, density, loading/empty states,
 * row-click behaviour, and header sorting so every issue surface reads identically.
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
  defaultSort,
}: Props<T>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const r = compare(get(a), get(b));
      // Keep nullish rows pinned to the bottom in both directions.
      if (r === 1 && (get(a) === null || get(a) === undefined || get(a) === "")) return 1;
      if (r === -1 && (get(b) === null || get(b) === undefined || get(b) === "")) return -1;
      return r * sign;
    });
  }, [rows, columns, sort]);

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key === key ? (prev.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" },
    );

  return (
    <div className="rounded-md border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => {
              const sortable = !!c.sortValue;
              const active = sort?.key === c.key;
              return (
                <TableHead key={c.key} title={c.headerTitle} className={`text-left ${c.width ?? ""}`}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="group inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === "asc" ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> {loadingMessage}
              </TableCell>
            </TableRow>
          ) : sortedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-sm text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((row) => (
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
