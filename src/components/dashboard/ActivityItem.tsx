import { Container as ContainerType } from "@/types/container";
import { timeAgo } from "@/lib/dashboardStats";

const STATUS_ACTIVITY_BADGE: Record<string, { label: string; cls: string }> = {
  "in-yard": { label: "IN", cls: "bg-maritime/10 text-maritime border-maritime/30" },
  reserved: { label: "RES", cls: "bg-warning/10 text-warning border-warning/30" },
  out: { label: "OUT", cls: "bg-muted text-muted-foreground border-border" },
};

export const ActivityItem = ({
  container: c,
  onClick,
}: {
  container: ContainerType;
  onClick?: () => void;
}) => {
  const badge = STATUS_ACTIVITY_BADGE[c.status] ?? STATUS_ACTIVITY_BADGE["out"];

  return (
    <div
      className={`flex items-start gap-2 text-xs py-1 border-b last:border-0 ${onClick ? "cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1" : ""}`}
      onClick={onClick}
    >
      <span className={`mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold shrink-0 ${badge.cls}`}>
        {badge.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono font-medium truncate">{c.containerNumber}</div>
        <div className="text-muted-foreground">Gated in {timeAgo(c.gateInTime)}</div>
      </div>
    </div>
  );
};
