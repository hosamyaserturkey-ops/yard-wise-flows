import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";

type StatColor = "maritime" | "warning" | "success" | "container";

// Static class maps so Tailwind can see the full class strings (no runtime
// interpolation, which the JIT compiler can't detect).
const COLOR: Record<StatColor, { chip: string; accent: string }> = {
  maritime: { chip: "bg-maritime/10 text-maritime", accent: "bg-maritime" },
  warning: { chip: "bg-warning/10 text-warning", accent: "bg-warning" },
  success: { chip: "bg-success/10 text-success", accent: "bg-success" },
  container: { chip: "bg-container/10 text-container", accent: "bg-container" },
};

export const StatCard = ({
  label,
  value,
  color,
  icon,
  loading,
  hint,
}: {
  label: string;
  value: number | string;
  color: string;
  icon: React.ReactNode;
  loading?: boolean;
  hint?: string;
}) => {
  // Count numeric stats up on mount / change; strings ("—", "5d") render as-is.
  const numeric = typeof value === "number";
  const counted = useCountUp(numeric ? value : 0);
  const palette = COLOR[(color as StatColor)] ?? COLOR.maritime;
  // "8,416.000 JOD" is too long to sit beside the icon in a narrow card and
  // broke across two lines; give money the card's full width instead.
  const money = typeof value === "string" ? /^(.+?)\s+(JOD|USD)$/.exec(value) : null;

  if (money) {
    return (
      <Card className="group relative overflow-hidden transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]">
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-1 opacity-80 transition-opacity group-hover:opacity-100",
            palette.accent,
          )}
        />
        <div className="space-y-2 p-5 pl-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/50",
                palette.chip,
              )}
            >
              {icon}
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : (
            <p className="flex flex-wrap items-baseline gap-x-1 leading-none">
              <span className="whitespace-nowrap text-2xl font-bold tracking-tight tabular-nums text-foreground">{money[1]}</span>
              <span className="text-sm font-semibold text-muted-foreground">{money[2]}</span>
            </p>
          )}
          {hint && !loading && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </Card>
    );
  }

  return (
    <Card className="group relative overflow-hidden transition-all duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]">
      {/* Left accent rail — subtle, brand-tinted */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1 opacity-80 transition-opacity group-hover:opacity-100",
          palette.accent,
        )}
      />
      <div className="flex items-start justify-between gap-3 p-5 pl-6">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <p className="text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">
              {numeric ? counted.toLocaleString() : value}
            </p>
          )}
          {hint && !loading && (
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-border/50",
            palette.chip,
          )}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
};
