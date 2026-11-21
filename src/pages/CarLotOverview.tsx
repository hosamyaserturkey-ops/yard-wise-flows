import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  CalendarClock, Car, ClipboardList, LayoutDashboard, LogIn, LogOut, PauseCircle, RefreshCw, Table2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { useYardKind } from "@/hooks/useYardKind";
import { useToast } from "@/hooks/use-toast";
import { loadOverviewVisits } from "@/lib/carLotData";
import {
  ageBands, awaitingArrivalInspection, carsOnHold, dailyMovements, lotKpis, mostOverFree,
  stockByManufacturer, stockByZone, type LotTrendPoint, type LotVisit,
} from "@/lib/carLotStats";
import { CHART_SERIES } from "@/lib/chartColors";
import { formatDate, formatDayMonth, formatTime, formatWeekdayDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const TREND_DAYS = 30;
const REFRESH_MS = 60_000;
/** A focus or tab switch right after a load does not load again. */
const MIN_GAP_MS = 5_000;
/** Rows shown per "needs attention" list; the Cars list has the rest. */
const LIST_LIMIT = 10;

// Checked with the dataviz palette validator against the card surface, light
// and dark: lightness, chroma, colour-blind separation and 3:1 contrast all
// pass. Blue is the app's chart colour 1; the app's orange (colour 2) is too
// light for the dark-mode band, hence its own steps here.
const MOVEMENT_CONFIG = {
  arrivals: { label: "Arrivals", theme: { light: "#2d69eb", dark: "#468af6" } },
  releases: { label: "Releases", theme: { light: "#d97000", dark: "#d9731a" } },
} satisfies ChartConfig;

/** Ranked bars with their figures printed: one hue, square at the baseline, rounded at the end. */
function BarList({ rows, empty }: { rows: { key: string; label: string; value: number }[]; empty: string }) {
  if (rows.every((r) => r.value === 0)) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </div>
          <div className="h-2" aria-hidden>
            {r.value > 0 && (
              <div className="h-2 rounded-r" style={{ width: `${(r.value / max) * 100}%`, minWidth: 4, background: CHART_SERIES[0] }} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The chart's table twin: the same numbers, for anyone who cannot or would rather not read the bars. */
function MovementsTable({ points }: { points: LotTrendPoint[] }) {
  const days = [...points].reverse().filter((p) => p.arrivals > 0 || p.releases > 0);
  if (days.length === 0) return <p className="text-sm text-muted-foreground py-4">No arrivals or releases in the last {TREND_DAYS} days.</p>;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Arrivals</TableHead>
            <TableHead className="text-right">Releases</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((p) => (
            <TableRow key={p.dayKey}>
              <TableCell className="py-1.5">{formatWeekdayDate(p.dayKey)}</TableCell>
              <TableCell className="py-1.5 text-right tabular-nums">{p.arrivals}</TableCell>
              <TableCell className="py-1.5 text-right tabular-nums">{p.releases}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">Days without arrivals or releases are left out.</p>
    </>
  );
}

interface AttentionItem { key: string; vin: string; detail: string; to: string; }

/** A short list of cars that need someone, each a large tap target to where it is dealt with. */
function AttentionCard({ title, icon: Icon, items, total, empty }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: AttentionItem[];
  total: number;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" /> {title}</span>
          <Badge variant={total > 0 ? "outline" : "secondary"} className="tabular-nums">{total}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.key}>
                <Link to={item.to} className="block min-h-11 rounded-md border px-3 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block font-mono text-sm break-all">{item.vin}</span>
                  <span className="block text-xs text-muted-foreground break-words">{item.detail}</span>
                </Link>
              </li>
            ))}
            {total > items.length && (
              <li className="text-xs text-muted-foreground pt-1">and {total - items.length} more on the Cars list</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const inspectionWord = (v: LotVisit) => (v.arrivalInspection === "open" ? "started, not closed" : "not started");

/** The car lot at a glance, for its staff and the owner. Read-only; refreshes itself. */
const CarLotOverview = () => {
  const { toast } = useToast();
  const { yardId, isCarLot } = useYardKind();
  const [visits, setVisits] = useState<LotVisit[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const latest = useRef(0);
  const lastLoad = useRef(0);

  const load = useCallback(async () => {
    if (!yardId) return;
    const request = ++latest.current; // only the newest request may show its result
    setRefreshing(true);
    const at = new Date();
    try {
      const rows = await loadOverviewVisits(yardId, at, TREND_DAYS);
      if (request !== latest.current) return;
      setVisits(rows);
      setNow(at);
      lastLoad.current = Date.now();
    } catch (e) {
      if (request !== latest.current) return;
      toast({ title: "Overview not updated", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      if (request === latest.current) setRefreshing(false);
    }
  }, [yardId, toast]);

  // A different yard (the owner's switcher) starts from an empty page, never another lot's numbers.
  useEffect(() => { setVisits(null); void load(); }, [load]);

  // No live push for car-lot tables: refresh every minute while the page is visible, and on return to it.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastLoad.current < MIN_GAP_MS) return;
      void load();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const stats = useMemo(() => {
    if (!visits) return null;
    const trend = dailyMovements(visits, TREND_DAYS, now);
    const kpis = lotKpis(visits, now);
    return {
      kpis,
      bands: ageBands(visits, now),
      makers: stockByManufacturer(visits, now),
      zones: stockByZone(visits),
      trend,
      arrived: trend.reduce((n, p) => n + p.arrivals, 0),
      released: trend.reduce((n, p) => n + p.releases, 0),
      awaiting: awaitingArrivalInspection(visits),
      onHold: carsOnHold(visits),
      overFree: mostOverFree(visits, now, LIST_LIMIT),
      overFreeTotal: kpis.overFree,
    };
  }, [visits, now]);

  if (!isCarLot) {
    return <div className="p-8 text-muted-foreground">Select a car-lot yard (top right) to see its overview.</div>;
  }

  const loading = !stats;
  const k = stats?.kpis;
  const flag = (n: number | undefined) => (n ? "warning" : "success");
  const flagText = (n: number | undefined) => (n ? "text-warning" : "text-success");

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={LayoutDashboard}
        title="Overview"
        subtitle={stats ? `Updated ${formatTime(now)} · refreshes every minute` : "Loading…"}
        action={(
          <Button variant="outline" size="sm" className="min-h-9" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4 mr-1", refreshing && "animate-spin")} /> Refresh
          </Button>
        )}
      />

      {/* While a refresh runs the page keeps its numbers, dimmed, instead of flashing empty. */}
      <div className={cn("space-y-6 transition-opacity", refreshing && stats && "opacity-60")}>
        {/* One column on phones, as on the container dashboard: two would cut the hints short. */}
        <section aria-label="Headline numbers" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3 sm:gap-4">
          <StatCard label="Cars in the lot" value={k?.inLot ?? 0} color="maritime" loading={loading}
            icon={<Car className="h-5 w-5 text-maritime" />}
            hint={k?.oldestDays ? `Longest stay: day ${k.oldestDays}` : "The lot is empty"} />
          <StatCard label="Arrived today" value={k?.arrivedToday ?? 0} color="maritime" loading={loading}
            icon={<LogIn className="h-5 w-5 text-maritime" />} hint="Since midnight" />
          <StatCard label="Released today" value={k?.releasedToday ?? 0} color="container" loading={loading}
            icon={<LogOut className="h-5 w-5 text-container" />} hint="Since midnight" />
          <StatCard label="On hold" value={k?.onHold ?? 0} color={flag(k?.onHold)} loading={loading}
            icon={<PauseCircle className={cn("h-5 w-5", flagText(k?.onHold))} />}
            hint={k?.onHold ? "Cannot be gated out" : "None"} />
          <StatCard label="Over free days" value={k?.overFree ?? 0} color={flag(k?.overFree)} loading={loading}
            icon={<CalendarClock className={cn("h-5 w-5", flagText(k?.overFree))} />}
            hint={k?.overFree ? "Past their free days" : "None"} />
          <StatCard label="Arrival inspection not closed" value={k?.arrivalNotClosed ?? 0} color={flag(k?.arrivalNotClosed)} loading={loading}
            icon={<ClipboardList className={cn("h-5 w-5", flagText(k?.arrivalNotClosed))} />}
            hint={k?.arrivalNotClosed ? "Photos still to finish" : "All closed"} />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm font-semibold">Arrivals and releases, last {TREND_DAYS} days</CardTitle>
                  {stats && (
                    <p className="mt-1 text-xs text-muted-foreground">{stats.arrived} arrived · {stats.released} released</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
                  <Table2 className="h-3.5 w-3.5 mr-1" /> {showTable ? "Show chart" : "Show table"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!stats ? (
                <Skeleton className="h-60 w-full" />
              ) : showTable ? (
                <MovementsTable points={stats.trend} />
              ) : stats.arrived + stats.released === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No arrivals or releases in the last {TREND_DAYS} days.</p>
              ) : (
                <ChartContainer config={MOVEMENT_CONFIG} className="aspect-auto h-60 w-full">
                  <BarChart data={stats.trend} margin={{ top: 8, right: 4, bottom: 0, left: -20 }} barGap={2} barCategoryGap="20%">
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={40} />
                    <ChartTooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }} content={<ChartTooltipContent indicator="line" />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="arrivals" fill="var(--color-arrivals)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                    <Bar dataKey="releases" fill="var(--color-releases)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Days in the lot</CardTitle></CardHeader>
            <CardContent>
              {stats ? (
                <BarList rows={stats.bands.map((b) => ({ key: b.key, label: b.label, value: b.count }))} empty="No cars in the lot." />
              ) : <Skeleton className="h-48 w-full" />}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">By manufacturer</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {!stats ? (
                <Skeleton className="h-32 w-full" />
              ) : stats.makers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cars in the lot.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Manufacturer</TableHead>
                      <TableHead className="text-right">In lot</TableHead>
                      <TableHead className="text-right">On hold</TableHead>
                      <TableHead className="text-right">Over free</TableHead>
                      {/* Secondary on a phone; the Excel reports have them too. */}
                      <TableHead className="hidden sm:table-cell text-right">Avg days</TableHead>
                      <TableHead className="hidden sm:table-cell text-right">Longest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.makers.map((m) => (
                      <TableRow key={m.code || m.name}>
                        <TableCell>
                          <span className="font-medium">{m.name}</span>
                          {m.code && <span className="ml-1.5 text-xs text-muted-foreground">{m.code}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{m.inLot}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.onHold}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.overFree}</TableCell>
                        <TableCell className="hidden sm:table-cell text-right tabular-nums">{m.avgDays.toFixed(1)}</TableCell>
                        <TableCell className="hidden sm:table-cell text-right tabular-nums">{m.oldestDays}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">By zone</CardTitle></CardHeader>
            <CardContent>
              {stats ? (
                <BarList rows={stats.zones.map((z) => ({ key: z.zone, label: z.zone, value: z.count }))} empty="No cars in the lot." />
              ) : <Skeleton className="h-32 w-full" />}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3" aria-label="Needs attention">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Needs attention</h2>
          {!stats ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <AttentionCard
                title="Arrival inspection not closed"
                icon={ClipboardList}
                total={stats.awaiting.length}
                empty="Every car in the lot has a closed arrival inspection."
                items={stats.awaiting.slice(0, LIST_LIMIT).map((v) => ({
                  key: v.id,
                  vin: v.vin,
                  detail: `${v.manufacturerName} · arrived ${formatDayMonth(v.gateIn)} · ${inspectionWord(v)}`,
                  to: `/cars/${v.id}/inspect/gate_in`,
                }))}
              />
              <AttentionCard
                title="On hold"
                icon={PauseCircle}
                total={stats.onHold.length}
                empty="No car is on hold."
                items={stats.onHold.slice(0, LIST_LIMIT).map((v) => ({
                  key: v.id,
                  vin: v.vin,
                  detail: [v.holdReason, v.heldAt ? `since ${formatDate(v.heldAt)}` : null].filter(Boolean).join(" · "),
                  to: `/cars?q=${encodeURIComponent(v.vin)}`,
                }))}
              />
              <AttentionCard
                title="Most days over free"
                icon={CalendarClock}
                total={stats.overFreeTotal}
                empty="No car is past its free days."
                items={stats.overFree.map(({ visit: v, days, over }) => ({
                  key: v.id,
                  vin: v.vin,
                  detail: `${v.manufacturerName} · day ${days} · ${over} over free`,
                  to: `/cars?q=${encodeURIComponent(v.vin)}`,
                }))}
              />
            </div>
          )}
          {stats && (
            <p className="text-xs text-muted-foreground">Days count the arrival day as day 1, as on the Cars list.</p>
          )}
        </section>
      </div>
    </div>
  );
};

export default CarLotOverview;
