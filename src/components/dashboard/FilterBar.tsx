import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  describeFilters,
  hasActiveFilters,
  type DashboardFilters,
  type FilterDimension,
} from "@/lib/dashboardFilters";

/**
 * Removable chips for the dashboard's active cross-filters. Renders nothing
 * when no filter is set, so the header stays quiet in the default view.
 */
export const FilterBar = ({
  filters,
  matchCount,
  onClear,
  onClearAll,
}: {
  filters: DashboardFilters;
  matchCount: number;
  onClear: (key: FilterDimension) => void;
  onClearAll: () => void;
}) => {
  if (!hasActiveFilters(filters)) return null;

  const chips = describeFilters(filters);

  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <span className="text-xs font-medium text-muted-foreground">Filtered:</span>

      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="gap-1 pr-1 font-normal">
          <span className="text-muted-foreground">{chip.label}:</span>
          <span className="font-medium">{chip.value}</span>
          <button
            type="button"
            onClick={() => onClear(chip.key)}
            aria-label={`Clear ${chip.label} filter`}
            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      <span className="text-xs tabular-nums text-muted-foreground">
        {matchCount} {matchCount === 1 ? "container" : "containers"}
      </span>

      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onClearAll}>
        Clear all
      </Button>
    </div>
  );
};
