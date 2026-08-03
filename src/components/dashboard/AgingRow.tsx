import { cn } from "@/lib/utils";

/**
 * One age band in the aging card. Acts as a toggle for the dashboard's age
 * filter — `selected` reflects whether this band is the active filter.
 */
export const AgingRow = ({
  label,
  count,
  tone,
  selected = false,
  onClick,
}: {
  label: string;
  count: number;
  tone: string;
  selected?: boolean;
  onClick?: () => void;
}) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={!onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors",
        onClick && "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-muted ring-1 ring-inset ring-border",
        !onClick && "cursor-default",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", tone)} />
        {label}
      </span>
      <span className="font-semibold tabular-nums">{count}</span>
    </button>
  </li>
);
