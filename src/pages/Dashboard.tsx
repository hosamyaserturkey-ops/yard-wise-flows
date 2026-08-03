import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Container, Ship, Clock, Users, Calendar, Search, TrendingUp, BarChart3, Timer, PackageCheck, LogIn, LogOut as LogOutIcon, FilterX } from "lucide-react";
import { Container as ContainerType } from "@/types/container";
import { useAuth } from "@/hooks/useAuth";
import ReserveContainerDialog from "@/components/ReserveContainerDialog";
import ContainerDetailDialog from "@/components/ContainerDetailDialog";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { KanbanColumn } from "@/components/dashboard/KanbanColumn";
import { ActivityItem } from "@/components/dashboard/ActivityItem";
import { AgingRow } from "@/components/dashboard/AgingRow";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { SortHeader } from "@/components/dashboard/SortHeader";
import { useTableSort } from "@/hooks/useTableSort";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  AGING_BUCKETS,
  computeAgingBuckets,
  computeDailyTrend,
  computeLineDistribution,
  computeStockByLine,
  computeTodayActivity,
  daysInYard,
  lastNDayLabels,
  dayKey,
  type SizeBucket,
} from "@/lib/dashboardStats";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  scopeContainers,
  toggleFilter,
  type DashboardFilters,
  type FilterDimension,
} from "@/lib/dashboardFilters";
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
import { CHART_SERIES, chartColorAt } from "@/lib/chartColors";

const LINE_COLORS = CHART_SERIES;

/** Opacity applied to chart marks that aren't the active selection. */
const DIMMED = 0.28;

const TREND_RANGES = [7, 14, 30] as const;
type TrendRange = (typeof TREND_RANGES)[number];
type TrendSeries = "in" | "out" | "both";

/** Compact section label to break the dashboard into scannable zones. */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
    {children}
  </h2>
);

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

  // cross-filters + chart controls
  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [trendRange, setTrendRange] = useState<TrendRange>(7);
  const [trendSeries, setTrendSeries] = useState<TrendSeries>("in");
  const [agingExpanded, setAgingExpanded] = useState(false);

  const filtersActive = hasActiveFilters(filters);

  const clearFilter = useCallback(
    (key: FilterDimension) => setFilters((f) => ({ ...f, [key]: null })),
    [],
  );
  const clearAllFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const toggleLine = (line: string) => setFilters((f) => toggleFilter(f, "line", line));
  const toggleDay = (day: string) => setFilters((f) => toggleFilter(f, "day", day));
  const toggleBucket = (bucket: (typeof AGING_BUCKETS)[number]["key"]) =>
    setFilters((f) => toggleFilter(f, "bucket", bucket));

  // A stock cell means "this line AND this size" — toggled as one unit.
  const toggleStockCell = (line: string, size: SizeBucket) =>
    setFilters((f) =>
      f.line === line && f.size === size
        ? { ...f, line: null, size: null }
        : { ...f, line, size },
    );

  // Changing the trend window can strand a selected day outside it; drop the
  // day filter rather than leaving an unreachable chip behind.
  const changeTrendRange = (next: TrendRange) => {
    setTrendRange(next);
    setFilters((f) => {
      if (f.day === null) return f;
      const visible = lastNDayLabels(next).some(({ date }) => dayKey(date) === f.day);
      return visible ? f : { ...f, day: null };
    });
  };

  // Redirect inspectors to their page
  useEffect(() => {
    if (profile?.role === "inspector") {
      navigate("/inspector", { replace: true });
    }
  }, [profile, navigate]);

  // ── Scoped views ────────────────────────────────────────────────────────
  // `scoped` drives the KPIs, tables and board. Each chart is scoped by every
  // dimension *except* its own, so clicking a mark filters the page without
  // collapsing the chart it came from.
  const scoped = useMemo(() => scopeContainers(containers, filters), [containers, filters]);

  // The trend chart and the aging card both read gate-in time, so they form a
  // single dimension: filtering to "15–21 days old" would otherwise empty a
  // 7-day gate-in chart, and picking a day would collapse the age bands.
  const scopedForGateInTime = useMemo(
    () => scopeContainers(containers, filters, { exclude: ["day", "bucket"] }),
    [containers, filters],
  );
  const scopedForLine = useMemo(
    () => scopeContainers(containers, filters, { exclude: "line" }),
    [containers, filters],
  );
  const scopedForStock = useMemo(
    () => scopeContainers(containers, filters, { exclude: ["line", "size"] }),
    [containers, filters],
  );

  // Counts
  const inYardCount = scoped.filter((c) => c.status === "in-yard").length;
  const reservedCount = scoped.filter((c) => c.status === "reserved").length;
  const outCount = scoped.filter((c) => c.status === "out").length;

  // Filtered containers for kanban search
  const filteredContainers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (c) =>
        c.containerNumber.toLowerCase().includes(q) ||
        c.driverName?.toLowerCase().includes(q) ||
        c.truckNumber?.toLowerCase().includes(q) ||
        c.shippingLine?.toLowerCase().includes(q),
    );
  }, [scoped, search]);

  const inYard = filteredContainers.filter((c) => c.status === "in-yard");
  const reserved = filteredContainers.filter((c) => c.status === "reserved");
  const out = filteredContainers.filter((c) => c.status === "out");

  // Activity feed: last 10 by gate_in_time desc
  const activityFeed = useMemo(
    () => [...scoped].sort((a, b) => b.gateInTime.getTime() - a.gateInTime.getTime()).slice(0, 10),
    [scoped],
  );

  const dailyTrend = useMemo(
    () => computeDailyTrend(scopedForGateInTime, trendRange),
    [scopedForGateInTime, trendRange],
  );
  const lineData = useMemo(() => computeLineDistribution(scopedForLine), [scopedForLine]);
  const stockByLine = useMemo(() => computeStockByLine(scopedForStock), [scopedForStock]);
  const today = useMemo(() => computeTodayActivity(scoped), [scoped]);
  const aging = useMemo(() => computeAgingBuckets(scopedForGateInTime), [scopedForGateInTime]);

  // In-yard containers behind the "oldest" table, oldest first.
  const agingRows = useMemo(
    () =>
      scoped
        .filter((c) => c.status === "in-yard")
        .sort((a, b) => a.gateInTime.getTime() - b.gateInTime.getTime()),
    [scoped],
  );

  // The genuine oldest container, independent of how the table is sorted.
  const oldestInYard = agingRows[0];

  const {
    sort: stockSort,
    toggle: toggleStockSort,
    sorted: sortedStock,
  } = useTableSort(
    stockByLine,
    (r) => ({
      line: r.line,
      small: r.small,
      large: r.large,
      hc: r.hc,
      reefer: r.reefer,
      total: r.total,
    }),
    { key: "total", direction: "desc" },
  );

  const {
    sort: agingSort,
    toggle: toggleAgingSort,
    sorted: sortedAging,
  } = useTableSort(
    agingRows,
    (c) => ({
      containerNumber: c.containerNumber,
      shippingLine: c.shippingLine,
      containerType: c.containerType,
      // Gate-in time and days-in-yard are the same ordering, inverted: sorting
      // ascending by gate-in puts the oldest (highest day count) first.
      gateIn: c.gateInTime.getTime(),
      days: -c.gateInTime.getTime(),
    }),
    { key: "days", direction: "desc" },
  );

  const visibleAging = agingExpanded ? sortedAging : sortedAging.slice(0, 10);

  const openDetail = (c: ContainerType) => {
    setDetailContainer(c);
    setDetailOpen(true);
  };

  const openReserve = (c: ContainerType) => {
    setSelectedContainer(c);
    setReserveDialogOpen(true);
  };

  const barChartConfig: ChartConfig = {
    gateIn: { label: "Gate-ins", color: chartColorAt(0) },
    gateOut: { label: "Gate-outs", color: chartColorAt(2) },
  };

  const pieChartConfig: ChartConfig = Object.fromEntries(
    lineData.map((d, i) => [
      d.name,
      { label: d.name, color: LINE_COLORS[i % LINE_COLORS.length] },
    ]),
  );

  const showGateIn = trendSeries === "in" || trendSeries === "both";
  const showGateOut = trendSeries === "out" || trendSeries === "both";

  // Recharts hands back the hovered column's payload on click.
  const handleTrendClick = (state: { activePayload?: { payload?: { dayKey?: string } }[] }) => {
    const key = state?.activePayload?.[0]?.payload?.dayKey;
    if (key) toggleDay(key);
  };

  const noMatches = filtersActive && scoped.length === 0 && containers.length > 0;

  return (
    <div className="space-y-8 p-4 md:p-6 lg:p-8 animate-in fade-in-0 duration-300">
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <PageHeader
              icon={BarChart3}
              title="Dashboard"
              subtitle={
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                  Live · updated {lastUpdated.toLocaleTimeString()}
                </span>
              }
            />
          </div>

          <FilterBar
            filters={filters}
            matchCount={scoped.length}
            onClear={clearFilter}
            onClearAll={clearAllFilters}
          />
        </div>

        {/* ── Overview ─────────────────────────────────── */}
        <section className="space-y-3">
          <SectionTitle>Overview</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Containers In Yard"
              value={inYardCount}
              color="maritime"
              icon={<Container className="h-5 w-5 text-maritime" />}
              loading={loading}
              hint={`${today.gateIn} gated in today`}
            />
            <StatCard
              label="Reserved"
              value={reservedCount}
              color="warning"
              icon={<Calendar className="h-5 w-5 text-warning" />}
              loading={loading}
              hint={reservedCount > 0 ? "Awaiting pickup" : "None reserved"}
            />
            <StatCard
              label="Containers Out"
              value={outCount}
              color="success"
              icon={<Ship className="h-5 w-5 text-success" />}
              loading={loading}
              hint={`${today.gateOut} gated out today`}
            />
            <StatCard
              label="Total Containers"
              value={scoped.length}
              color="container"
              icon={<Users className="h-5 w-5 text-container" />}
              loading={loading}
              hint={
                oldestInYard
                  ? `Oldest ${daysInYard(oldestInYard.gateInTime)}d in yard`
                  : "All clear"
              }
            />
          </div>
        </section>

        {/* ── Analytics ────────────────────────────────── */}
        <section className="space-y-3">
        <SectionTitle>Analytics</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Bar chart — daily gate-in trend */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-maritime" />
                  Daily Movements
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={trendSeries}
                    onValueChange={(v) => v && setTrendSeries(v as TrendSeries)}
                    aria-label="Trend series"
                  >
                    <ToggleGroupItem value="in" className="h-7 px-2 text-xs">In</ToggleGroupItem>
                    <ToggleGroupItem value="out" className="h-7 px-2 text-xs">Out</ToggleGroupItem>
                    <ToggleGroupItem value="both" className="h-7 px-2 text-xs">Both</ToggleGroupItem>
                  </ToggleGroup>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={String(trendRange)}
                    onValueChange={(v) => v && changeTrendRange(Number(v) as TrendRange)}
                    aria-label="Trend range"
                  >
                    {TREND_RANGES.map((r) => (
                      <ToggleGroupItem key={r} value={String(r)} className="h-7 px-2 text-xs">
                        {r}d
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <ChartContainer config={barChartConfig} className="h-48">
                  <BarChart
                    data={dailyTrend}
                    margin={{ top: 4, right: 8, bottom: 4, left: -16 }}
                    onClick={handleTrendClick}
                    className="cursor-pointer"
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                      minTickGap={8}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {showGateIn && (
                      <Bar dataKey="gateIn" name="Gate-ins" radius={[4, 4, 0, 0]} fill={chartColorAt(0)}>
                        {dailyTrend.map((d) => (
                          <Cell
                            key={d.dayKey}
                            fillOpacity={
                              filters.day === null || filters.day === d.dayKey ? 1 : DIMMED
                            }
                          />
                        ))}
                      </Bar>
                    )}
                    {showGateOut && (
                      <Bar dataKey="gateOut" name="Gate-outs" radius={[4, 4, 0, 0]} fill={chartColorAt(2)}>
                        {dailyTrend.map((d) => (
                          <Cell
                            key={d.dayKey}
                            fillOpacity={
                              filters.day === null || filters.day === d.dayKey ? 1 : DIMMED
                            }
                          />
                        ))}
                      </Bar>
                    )}
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
                      className="cursor-pointer focus:outline-none"
                    >
                      {lineData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={LINE_COLORS[index % LINE_COLORS.length]}
                          fillOpacity={
                            filters.line === null || filters.line === entry.name ? 1 : DIMMED
                          }
                          onClick={() => toggleLine(entry.name)}
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
                  <ActivityItem key={c.id} container={c} onClick={() => openDetail(c)} />
                ))
              )}
            </CardContent>
          </Card>
        </div>
        </section>

        {/* ── Today ────────────────────────────────────── */}
        <section className="space-y-3">
          <SectionTitle>Today</SectionTitle>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {[
                { label: "Gate-ins today", value: today.gateIn, icon: <LogIn className="h-4 w-4 text-maritime" /> },
                { label: "Gate-outs today", value: today.gateOut, icon: <LogOutIcon className="h-4 w-4 text-success" /> },
                { label: "Currently reserved", value: today.reserved, icon: <PackageCheck className="h-4 w-4 text-warning" /> },
                {
                  label: "Oldest in yard",
                  value: oldestInYard ? `${daysInYard(oldestInYard.gateInTime)}d` : "—",
                  icon: <Timer className="h-4 w-4 text-container" />,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="flex items-center gap-3 border-b border-r p-4 last:border-r-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r sm:[&:nth-child(-n+4)]:border-b-0"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {m.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-muted-foreground">{m.label}</p>
                    {loading ? (
                      <Skeleton className="mt-1 h-6 w-10" />
                    ) : (
                      <p className="text-xl font-bold leading-tight tabular-nums">{m.value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* ── Details ──────────────────────────────────── */}
        <section className="space-y-3">
        <SectionTitle>Stock &amp; aging</SectionTitle>
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
              ) : sortedStock.length === 0 ? (
                <p className="text-sm text-muted-foreground">No containers in yard.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <SortHeader column="line" sort={stockSort} onSort={toggleStockSort}>
                          Line
                        </SortHeader>
                        <SortHeader column="small" sort={stockSort} onSort={toggleStockSort} align="right">
                          20FT
                        </SortHeader>
                        <SortHeader column="large" sort={stockSort} onSort={toggleStockSort} align="right">
                          40FT
                        </SortHeader>
                        <SortHeader column="hc" sort={stockSort} onSort={toggleStockSort} align="right">
                          40HC/45
                        </SortHeader>
                        <SortHeader column="reefer" sort={stockSort} onSort={toggleStockSort} align="right">
                          Reefer
                        </SortHeader>
                        <SortHeader
                          column="total"
                          sort={stockSort}
                          onSort={toggleStockSort}
                          align="right"
                          className="font-semibold"
                        >
                          Total
                        </SortHeader>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedStock.map((r) => {
                        const lineSelected = filters.line === r.line;
                        return (
                          <tr
                            key={r.line}
                            className={`border-t transition-colors ${lineSelected ? "bg-muted/60" : "hover:bg-muted/30"}`}
                          >
                            <td className="py-1.5 font-medium">
                              <button
                                type="button"
                                onClick={() => toggleLine(r.line)}
                                aria-pressed={lineSelected}
                                className="rounded px-1 -mx-1 hover:text-maritime hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {r.line}
                              </button>
                            </td>
                            {(
                              [
                                ["small", r.small],
                                ["large", r.large],
                                ["hc", r.hc],
                                ["reefer", r.reefer],
                              ] as [SizeBucket, number][]
                            ).map(([bucket, count]) => (
                              <td key={bucket} className="text-right">
                                <button
                                  type="button"
                                  onClick={() => toggleStockCell(r.line, bucket)}
                                  disabled={count === 0}
                                  aria-pressed={lineSelected && filters.size === bucket}
                                  className={`rounded px-1.5 py-0.5 tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent ${
                                    lineSelected && filters.size === bucket
                                      ? "bg-maritime/15 font-semibold text-maritime"
                                      : "hover:bg-muted"
                                  }`}
                                >
                                  {count}
                                </button>
                              </td>
                            ))}
                            <td className="text-right font-semibold tabular-nums pr-1.5">{r.total}</td>
                          </tr>
                        );
                      })}
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
                <ul className="space-y-1 text-sm">
                  {AGING_BUCKETS.map((b) => (
                    <AgingRow
                      key={b.key}
                      label={b.label}
                      count={aging[b.key]}
                      tone={b.tone}
                      selected={filters.bucket === b.key}
                      onClick={() => toggleBucket(b.key)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top aging table */}
        {sortedAging.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <Timer className="h-4 w-4 text-warning" />
                  Oldest containers in yard
                </CardTitle>
                {sortedAging.length > 10 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setAgingExpanded((v) => !v)}
                  >
                    {agingExpanded ? "Show less" : `Show all ${sortedAging.length}`}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <SortHeader column="containerNumber" sort={agingSort} onSort={toggleAgingSort}>
                        Container
                      </SortHeader>
                      <SortHeader column="shippingLine" sort={agingSort} onSort={toggleAgingSort}>
                        Line
                      </SortHeader>
                      <SortHeader column="containerType" sort={agingSort} onSort={toggleAgingSort}>
                        Type
                      </SortHeader>
                      <SortHeader column="gateIn" sort={agingSort} onSort={toggleAgingSort}>
                        Gate-in
                      </SortHeader>
                      <SortHeader column="days" sort={agingSort} onSort={toggleAgingSort} align="right">
                        Days
                      </SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAging.map((c) => (
                      <tr
                        key={c.id}
                        className="border-t hover:bg-muted/50 cursor-pointer"
                        onClick={() => openDetail(c)}
                      >
                        <td className="py-1.5 font-mono">{c.containerNumber}</td>
                        <td className="py-1.5">{c.shippingLine}</td>
                        <td className="py-1.5">{c.containerType}</td>
                        <td className="py-1.5">{c.gateInTime.toLocaleDateString("en-GB")}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums">{daysInYard(c.gateInTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
        </section>

        {/* ── Live board ───────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>Live board</SectionTitle>
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-sm bg-background/80"
                placeholder="Search container, driver…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search containers"
              />
            </div>
          </div>

          {noMatches ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <FilterX className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No containers match the current filters</p>
                  <p className="text-xs text-muted-foreground">
                    Try removing a filter to widen the view.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={clearAllFilters}>
                  Clear all filters
                </Button>
              </CardContent>
            </Card>
          ) : (
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
          )}
        </section>

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
