import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortState } from "@/hooks/useTableSort";

/** A clickable `<th>` that shows and toggles this column's sort direction. */
export const SortHeader = <K extends string>({
  column,
  sort,
  onSort,
  align = "left",
  className,
  children,
}: {
  column: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) => {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={cn("py-2", align === "right" ? "text-right" : "text-left", className)}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon className={cn("h-3 w-3 shrink-0", !active && "opacity-40")} />
      </button>
    </th>
  );
};
