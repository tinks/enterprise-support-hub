import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { compare, type SortValue } from "@/components/issues/IssueTable";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir } | null;

/**
 * Sorting for hand-rolled `<Table>` surfaces (the ones not yet on `IssueTable`).
 * Same contract as the shared issue table: click cycles asc -> desc -> the
 * view's own default order, and nullish/empty values always sort last.
 */
export function useTableSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
  defaultSort: SortState = null,
) {
  const [sort, setSort] = useState<SortState>(defaultSort);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = accessors[sort.key];
    if (!get) return rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    const isNullish = (v: SortValue) => v === null || v === undefined || v === "";
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      // Nullish rows stay pinned to the bottom in both directions.
      if (isNullish(av) && isNullish(bv)) return 0;
      if (isNullish(av)) return 1;
      if (isNullish(bv)) return -1;
      return compare(av, bv) * sign;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  function toggle(key: string) {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return defaultSort && defaultSort.key === key ? defaultSort : null;
    });
  }

  return { sorted, sort, toggle };
}

export function SortableHead({
  sortKey,
  sort,
  onToggle,
  className,
  children,
}: {
  sortKey?: string;
  sort: SortState;
  onToggle: (key: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (!sortKey) return <TableHead className={className}>{children}</TableHead>;
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort!.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          active ? "text-foreground" : "",
        )}
      >
        {children}
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </TableHead>
  );
}
