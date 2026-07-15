import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Container, Ship, Clock, Users, Calendar, Search, TrendingUp, BarChart3, Timer, PackageCheck, LogIn, LogOut as LogOutIcon } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { useAuth } from "@/hooks/useAuth";
import ReserveContainerDialog from "@/components/ReserveContainerDialog";
import ContainerDetailDialog from "@/components/ContainerDetailDialog";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { KanbanColumn } from "@/components/dashboard/KanbanColumn";
import { ActivityItem } from "@/components/dashboard/ActivityItem";
import { AgingRow } from "@/components/dashboard/AgingRow";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  computeAgingBuckets,
  computeDailyTrend,
  computeLineDistribution,
  computeStockByLine,
  computeTodayActivity,
  daysInYard,
} from "@/lib/dashboardStats";
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
} from "recharts";

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

const Dashboard = () => {
  const { profile, currentYardId } = useAuth();
  const navigate = useNavigate();
  const { containers, demurrageMap, loading, lastUpdated, fetchContainers } =
    useDashboardData(currentYardId);

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

  const dailyTrend = useMemo(() => computeDailyTrend(containers), [containers]);
  const lineData = useMemo(() => computeLineDistribution(containers), [containers]);
  const stockByLine = useMemo(() => computeStockByLine(containers), [containers]);
  const today = useMemo(() => computeTodayActivity(containers), [containers]);
  const aging = useMemo(() => computeAgingBuckets(containers), [containers]);

  const topAging = useMemo(() => {
    return [...containers]
      .filter((c) => c.status === "in-yard")
      .sort((a, b) => a.gateInTime.getTime() - b.gateInTime.getTime())
      .slice(0, 10);
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

        {/* Today's activity */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Gate-ins Today"
            value={today.gateIn}
            color="maritime"
            icon={<LogIn className="h-4 w-4 text-maritime" />}
            loading={loading}
          />
          <StatCard
            label="Gate-outs Today"
            value={today.gateOut}
            color="success"
            icon={<LogOutIcon className="h-4 w-4 text-success" />}
            loading={loading}
          />
          <StatCard
            label="Currently Reserved"
            value={today.reserved}
            color="warning"
            icon={<PackageCheck className="h-4 w-4 text-warning" />}
            loading={loading}
          />
          <StatCard
            label="Oldest (in-yard)"
            value={topAging.length > 0 ? daysInYard(topAging[0].gateInTime) : 0}
            color="container"
            icon={<Timer className="h-4 w-4 text-container" />}
            loading={loading}
          />
        </div>

        {/* Stock by line + Aging */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Ship className="h-4 w-4 text-maritime" />
                Live Stock by Shipping Line (in-yard)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : stockByLine.length === 0 ? (
                <p className="text-sm text-muted-foreground">No containers in yard.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left py-2">Line</th>
                        <th className="text-right py-2">20FT</th>
                        <th className="text-right py-2">40FT</th>
                        <th className="text-right py-2">40HC/45</th>
                        <th className="text-right py-2">Reefer</th>
                        <th className="text-right py-2 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockByLine.map((r) => (
                        <tr key={r.line} className="border-t">
                          <td className="py-1.5 font-medium">{r.line}</td>
                          <td className="text-right">{r.small}</td>
                          <td className="text-right">{r.large}</td>
                          <td className="text-right">{r.hc}</td>
                          <td className="text-right">{r.reefer}</td>
                          <td className="text-right font-semibold">{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Timer className="h-4 w-4 text-warning" />
                Aging (in-yard)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <ul className="space-y-2 text-sm">
                  <AgingRow label="0–7 days" count={aging.fresh} tone="bg-green-500" />
                  <AgingRow label="8–14 days" count={aging.week} tone="bg-blue-500" />
                  <AgingRow label="15–21 days" count={aging.twoWeeks} tone="bg-yellow-500" />
                  <AgingRow label="22–30 days" count={aging.threeWeeks} tone="bg-orange-500" />
                  <AgingRow label="30+ days" count={aging.stale} tone="bg-red-500" />
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top aging table */}
        {topAging.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Timer className="h-4 w-4 text-warning" />
                Oldest containers in yard
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left py-2">Container</th>
                      <th className="text-left py-2">Line</th>
                      <th className="text-left py-2">Type</th>
                      <th className="text-left py-2">Gate-in</th>
                      <th className="text-right py-2">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAging.map((c) => (
                      <tr
                        key={c.id}
                        className="border-t hover:bg-muted/50 cursor-pointer"
                        onClick={() => openDetail(c)}
                      >
                        <td className="py-1.5 font-mono">{c.containerNumber}</td>
                        <td className="py-1.5">{c.shippingLine}</td>
                        <td className="py-1.5">{c.containerType}</td>
                        <td className="py-1.5">{c.gateInTime.toLocaleDateString("en-GB")}</td>
                        <td className="py-1.5 text-right font-semibold">{daysInYard(c.gateInTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

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

export default Dashboard;
