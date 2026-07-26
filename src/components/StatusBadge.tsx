import { cn } from "@/lib/utils";

type ContainerStatus = "in-yard" | "reserved" | "out";

/**
 * Canonical status colours for a container, shared across the app so the same
 * status always reads the same way (dashboard, reports, activity feed…).
 *   in-yard  → maritime (blue)
 *   reserved → warning  (amber)
 *   out      → muted    (neutral)
 */
const STATUS: Record<
  ContainerStatus,
  { label: string; short: string; cls: string; dot: string }
> = {
  "in-yard": {
    label: "In Yard",
    short: "IN",
    cls: "bg-maritime/10 text-maritime border-maritime/30",
    dot: "bg-maritime",
  },
  reserved: {
    label: "Reserved",
    short: "RES",
    cls: "bg-warning/10 text-warning border-warning/30",
    dot: "bg-warning",
  },
  out: {
    label: "Out",
    short: "OUT",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

export function StatusBadge({
  status,
  short = false,
  dot = false,
  className,
}: {
  status: string;
  /** Use the compact label (IN / RES / OUT). */
  short?: boolean;
  /** Show a leading colour dot. */
  dot?: boolean;
  className?: string;
}) {
  const s = STATUS[(status as ContainerStatus)] ?? STATUS.out;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold",
        s.cls,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />}
      {short ? s.short : s.label}
    </span>
  );
}
