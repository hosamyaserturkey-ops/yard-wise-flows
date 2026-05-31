import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Container, Ship, Clock, Users, Calendar, Search, TrendingUp, BarChart3 } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import ReserveContainerDialog from "@/components/ReserveContainerDialog";
import ContainerDetailDialog from "@/components/ContainerDetailDialog";
import { calculateDemurrage, hasDemurrageRules } from "@/lib/demurrage";
import { PageHeader } from "@/components/PageHeader";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  PieChart,
  Pie,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ── Types ────────────────────────────────────────────────────────────────────

interface DemurrageInfo {
  paidJOD?: number;
  owedJOD?: number;
}

interface KanbanCardProps {
  container: ContainerType;
  demurrage?: { paidJOD?: number; owedJOD?: number };
  onClick: () => void;
  onReserve?: (e: React.MouseEvent) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LINE_COLORS = [
  "#1a56db",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#6366f1",
];

function daysInYard(gateInTime: Date): number {
  const ms = Date.now() - gateInTime.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function last7DayLabels(): { date: Date; label: string }[] {
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
    return { date: d, label };
  });
}

// ── Main component ────────────────────────────────────────────────────────────

const Dashboard = () => {
  const { profile, currentYardId } = useAuth();
  const navigate = useNavigate();
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [demurrageMap, setDemurrageMap] = useState<Record<string, DemurrageInfo>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // dialogs
  const [reserveDialogOpen, setReserveDialogOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<ContainerType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContainer, setDetailContainer] = useState<ContainerType | null>(null);

  // search
  const [search, setSearch] = useState("");

  // Redirect inspectors to their page
  useEffect(() => {
    if (profile?.role === "inspector") {
      navigate("/inspector", { replace: true });
    }
  }, [profile, navigate]);

  const fetchContainers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("containers")
        .select("*")
        .order("gate_in_time", { ascending: false });

      if (error) throw error;

      const formatted: ContainerType[] = (data ?? []).map((c) => ({
        id: c.id,
        containerNumber: c.container_number,
        containerType: c.container_type,
        shippingLine: c.shipping_line as ShippingLine,
        driverName: c.driver_name,
        truckNumber: c.truck_number,
        gateInTime: new Date(c.gate_in_time),
        gateOutTime: c.gate_out_time ? new Date(c.gate_out_time) : undefined,
        status: c.status as "in-yard" | "out" | "reserved",
        bookingNumber: c.booking_number,
        bookingId: c.booking_id,
        fees: c.fees ? Number(c.fees) : undefined,
      }));

      setContainers(formatted);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Error fetching containers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  // Batch-load demurrage info
  useEffect(() => {
    if (containers.length === 0) {
      setDemurrageMap({});
      return;
    }

    const numbers = containers.map((c) => c.containerNumber);

    (async () => {
      const [portRes, payRes] = await Promise.all([
        supabase
          .from("container_port_data")
          .select("container_number, port_arrival_date, shipping_line")
          .in("container_number", numbers),
        supabase
          .from("demurrage_payments")
          .select("container_number, total_collected")
          .in("container_number", numbers),
      ]);

      const portByNum = new Map(
        (portRes.data ?? []).map((r) => [r.container_number, r]),
      );
      const paidByNum = new Map<string, number>();
      (payRes.data ?? []).forEach((p) =>
        paidByNum.set(
          p.container_number,
          (paidByNum.get(p.container_number) ?? 0) + Number(p.total_collected ?? 0),
        ),
      );

      const map: Record<string, DemurrageInfo> = {};
      for (const c of containers) {
        const paid = paidByNum.get(c.containerNumber);
        const port = portByNum.get(c.containerNumber);

        let owed: number | undefined;
        if (port?.port_arrival_date && hasDemurrageRules(c.shippingLine)) {
          const r = calculateDemurrage(
            c.shippingLine,
            c.containerType,
            port.port_arrival_date,
            c.gateInTime,
          );
          owed = r.totalJOD;
        }

        if (paid != null || owed != null) {
          map[c.containerNumber] = { paidJOD: paid, owedJOD: owed };
        }
      }
      setDemurrageMap(map);
    })();
  }, [containers]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("dashboard_containers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "containers" },
        () => fetchContainers(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchContainers]);

  // Counts
  const inYardCount = containers.filter((c) => c.status === "in-yard").length;
  const reservedCount = containers.filter((c) => c.status === "reserved").length;
  const outCount = containers.filter((c) => c.status === "out").length;

  // Filtered containers for kanban search
  const filteredContainers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return containers;
    return containers.filter(
      (c) =>
        c.containerNumber.toLowerCase().includes(q) ||
        c.driverName?.toLowerCase().includes(q) ||
        c.truckNumber?.toLowerCase().includes(q) ||
        c.shippingLine?.toLowerCase().includes(q),
    );
  }, [containers, search]);

  const inYard = filteredContainers.filter((c) => c.status === "in-yard");
  const reserved = filteredContainers.filter((c) => c.status === "reserved");
  const out = filteredContainers.filter((c) => c.status === "out");

  // Activity feed: last 10 by gate_in_time desc
  const activityFeed = useMemo(
    () => [...containers].sort((a, b) => b.gateInTime.getTime() - a.gateInTime.getTime()).slice(0, 10),
    [containers],
  );

  // Daily trend: last 7 days
  const dailyTrend = useMemo(() => {
    const days = last7DayLabels();
    return days.map(({ date, label }) => {
      const next = new Date(date);
      next.setDate(next.getDate() + 1);
      const count = containers.filter(
        (c) => c.gateInTime >= date && c.gateInTime < next,
      ).length;
      return { label, count };
    });
  }, [containers]);

  // Shipping line donut
  const lineData = useMemo(() => {
    const map = new Map<string, number>();
    containers.forEach((c) => {
      map.set(c.shippingLine, (map.get(c.shippingLine) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [containers]);

  const openDetail = (c: ContainerType) => {
    setDetailContainer(c);
    setDetailOpen(true);
  };

  const openReserve = (c: ContainerType) => {
    setSelectedContainer(c);
    setReserveDialogOpen(true);
  };

  const barChartConfig: ChartConfig = {
    count: { label: "Gate-ins", color: "#1a56db" },
  };

  const pieChartConfig: ChartConfig = Object.fromEntries(
    lineData.map((d, i) => [
      d.name,
      { label: d.name, color: LINE_COLORS[i % LINE_COLORS.length] },
    ]),
  );

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8 animate-in fade-in-0 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between">
          <PageHeader icon={BarChart3} title="Dashboard" subtitle={`Last updated ${lastUpdated.toLocaleTimeString()}`} />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Containers In Yard"
            value={inYardCount}
            color="maritime"
            icon={<Container className="h-4 w-4 text-maritime" />}
            loading={loading}
          />
          <StatCard
            label="Reserved"
            value={reservedCount}
            color="warning"
            icon={<Calendar className="h-4 w-4 text-warning" />}
            loading={loading}
          />
          <StatCard
            label="Containers Out"
            value={outCount}
            color="success"
            icon={<Ship className="h-4 w-4 text-success" />}
            loading={loading}
          />
          <StatCard
            label="Total Containers"
            value={containers.length}
            color="container"
            icon={<Users className="h-4 w-4 text-container" />}
            loading={loading}
          />
        </div>

        {/* Charts + Activity feed row */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Bar chart — daily gate-in trend */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-maritime" />
                Daily Gate-In (last 7 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ChartContainer config={barChartConfig} className="h-48">
                  <BarChart data={dailyTrend} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" name="Gate-ins" radius={[4, 4, 0, 0]} fill="#1a56db" />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Donut — containers by shipping line */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Ship className="h-4 w-4 text-maritime" />
                By Shipping Line
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-48 w-full" />
              ) : lineData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                  No data
                </div>
              ) : (
                <ChartContainer config={pieChartConfig} className="h-48">
                  <PieChart>
                    <Pie
                      data={lineData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="45%"
                      outerRadius="70%"
                    >
                      {lineData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={LINE_COLORS[index % LINE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend
                      iconSize={8}
                      wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                    />
                  </PieChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* Activity feed — right sidebar, hidden on mobile */}
          <Card className="hidden lg:flex lg:col-span-1 flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-maritime" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-48 space-y-2 pr-2">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))
              ) : activityFeed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                activityFeed.map((c) => (
                  <ActivityItem key={c.id} container={c} />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Kanban section */}
        <div className="space-y-3">
          {/* Search above kanban */}
          <div className="flex items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-sm bg-background/80"
                placeholder="Search container, driver…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <KanbanColumn
              title="In Yard"
              count={inYard.length}
              accent="blue"
              containers={inYard}
              demurrageMap={demurrageMap}
              loading={loading}
              onCardClick={openDetail}
              onReserve={openReserve}
            />
            <KanbanColumn
              title="Reserved"
              count={reserved.length}
              accent="amber"
              containers={reserved}
              demurrageMap={demurrageMap}
              loading={loading}
              onCardClick={openDetail}
              onReserve={openReserve}
            />
            <KanbanColumn
              title="Out"
              count={out.length}
              accent="gray"
              containers={out}
              demurrageMap={demurrageMap}
              loading={loading}
              onCardClick={openDetail}
            />
          </div>
        </div>

      {/* Dialogs */}
      <ReserveContainerDialog
        open={reserveDialogOpen}
        onOpenChange={setReserveDialogOpen}
        container={selectedContainer}
        onReserved={() => {
          fetchContainers();
          setSelectedContainer(null);
        }}
      />

      <ContainerDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        container={detailContainer}
      />
    </div>
  );
};

// ── KanbanColumn ─────────────────────────────────────────────────────────────

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

const KanbanColumn = ({
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

// ── ActivityItem ─────────────────────────────────────────────────────────────

const STATUS_ACTIVITY_BADGE: Record<string, { label: string; cls: string }> = {
  "in-yard": { label: "IN", cls: "bg-maritime/10 text-maritime border-maritime/30" },
  reserved: { label: "RES", cls: "bg-warning/10 text-warning border-warning/30" },
  out: { label: "OUT", cls: "bg-muted text-muted-foreground border-border" },
};

const ActivityItem = ({ container: c }: { container: ContainerType }) => {
  const badge = STATUS_ACTIVITY_BADGE[c.status] ?? STATUS_ACTIVITY_BADGE["out"];

  return (
    <div className="flex items-start gap-2 text-xs py-1 border-b last:border-0">
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

// ── StatCard ─────────────────────────────────────────────────────────────────

const StatCard = ({
  label,
  value,
  color,
  icon,
  loading,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  loading?: boolean;
}) => (
  <Card className={`border-l-4 border-l-${color}`}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{label}</CardTitle>
      {icon}
    </CardHeader>
    <CardContent>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <div className={`text-2xl font-bold text-${color}`}>{value}</div>
      )}
    </CardContent>
  </Card>
);

export default Dashboard;
