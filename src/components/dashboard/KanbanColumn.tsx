import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Container as ContainerType } from "@/types/container";
import { daysInYard } from "@/lib/dashboardStats";

export interface DemurrageInfo {
  paidJOD?: number;
  owedJOD?: number;
}

interface KanbanCardProps {
  container: ContainerType;
  demurrage?: DemurrageInfo;
  onClick: () => void;
  onReserve?: (e: React.MouseEvent) => void;
}

const ACCENT_STYLES: Record<string, { header: string; border: string; badge: string }> = {
  blue: {
    header: "text-maritime",
    border: "border-l-maritime",
    badge: "bg-maritime/10 text-maritime border-maritime/30",
  },
  amber: {
    header: "text-warning",
    border: "border-l-warning",
    badge: "bg-warning/10 text-warning border-warning/30",
  },
  gray: {
    header: "text-muted-foreground",
    border: "border-l-muted-foreground",
    badge: "bg-muted text-muted-foreground border-border",
  },
};

export const KanbanColumn = ({
  title,
  count,
  accent,
  containers,
  demurrageMap,
  loading,
  onCardClick,
  onReserve,
}: {
  title: string;
  count: number;
  accent: "blue" | "amber" | "gray";
  containers: ContainerType[];
  demurrageMap: Record<string, DemurrageInfo>;
  loading: boolean;
  onCardClick: (c: ContainerType) => void;
  onReserve?: (c: ContainerType) => void;
}) => {
  const styles = ACCENT_STYLES[accent];

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold text-sm ${styles.header}`}>{title}</h3>
          <Badge variant="outline" className={`text-xs font-mono ${styles.badge}`}>
            {count}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 overflow-y-auto" style={{ maxHeight: "70vh" }}>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : containers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No containers
          </div>
        ) : (
          <div className="space-y-2">
            {containers.map((c) => (
              <ContainerKanbanCard
                key={c.id}
                container={c}
                demurrage={demurrageMap[c.containerNumber]}
                onClick={() => onCardClick(c)}
                onReserve={
                  onReserve && (c.status === "in-yard" || c.status === "reserved")
                    ? (e) => {
                        e.stopPropagation();
                        onReserve(c);
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ── ContainerKanbanCard ──────────────────────────────────────────────────────

const STATUS_BORDER: Record<string, string> = {
  "in-yard": "border-l-maritime",
  reserved: "border-l-warning",
  out: "border-l-muted-foreground",
};

const ContainerKanbanCard = ({ container: c, demurrage, onClick, onReserve }: KanbanCardProps) => {
  const borderColor = STATUS_BORDER[c.status] ?? "border-l-border";
  const days = daysInYard(c.gateInTime);

  let demurrageBadge: { label: string; tone: "paid" | "owed" } | null = null;
  if (demurrage?.paidJOD != null && demurrage.paidJOD > 0) {
    demurrageBadge = { label: `paid ${demurrage.paidJOD.toFixed(2)} JOD`, tone: "paid" };
  } else if (demurrage?.owedJOD != null && demurrage.owedJOD > 0) {
    demurrageBadge = { label: `${demurrage.owedJOD.toFixed(2)} JOD at gate-in`, tone: "owed" };
  }

  return (
    <div
      className={`rounded-lg border border-l-4 ${borderColor} bg-card p-3 cursor-pointer
        transition-all duration-150 hover:shadow-md hover:-translate-y-0.5`}
      onClick={onClick}
    >
      {/* Container number + shipping line */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="font-mono font-semibold text-sm leading-tight hover:text-maritime transition-colors">
          {c.containerNumber}
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 font-normal">
          {c.shippingLine}
        </Badge>
      </div>

      {/* Driver + truck */}
      <div className="text-xs text-muted-foreground truncate mb-1.5">
        {c.driverName} · {c.truckNumber}
      </div>

      {/* Days in yard */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground">
          {c.status === "out"
            ? c.gateOutTime
              ? `Out ${c.gateOutTime.toLocaleDateString()}`
              : "Out"
            : `${days}d in yard`}
        </span>

        {/* Demurrage chip */}
        {demurrageBadge && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
              demurrageBadge.tone === "paid"
                ? "bg-success/10 text-success border-success/30"
                : "bg-warning/10 text-warning border-warning/30"
            }`}
          >
            {demurrageBadge.label}
          </span>
        )}
      </div>

      {/* Reserve / Unreserve button */}
      {onReserve && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] px-2"
            onClick={onReserve}
          >
            {c.status === "reserved" ? "Unreserve" : "Reserve"}
          </Button>
        </div>
      )}
    </div>
  );
};
