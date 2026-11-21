import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Grid3x3, Map as MapIcon, MoveRight, PauseCircle, RefreshCw, Table2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { useToast } from "@/hooks/use-toast";
import { useYardKind } from "@/hooks/useYardKind";
import { daysInLot } from "@/lib/carLot";
import { loadLotSlots, loadOpenCars, type OpenCar } from "@/lib/carLotData";
import { formatTime } from "@/lib/format";
import { buildLotMap, placeLabel, type MapCar, type MapTile, type TileState, type LotSlot } from "@/lib/lotSlots";
import { cn } from "@/lib/utils";

const ALL = "all";

const TILE_STYLE: Record<TileState, string> = {
  empty: "border-dashed bg-background",
  partly: "border-primary/50 bg-primary/5",
  full: "border-primary bg-primary/10",
  over: "border-destructive bg-destructive/10",
};
const STATE_WORD: Record<TileState, string> = { empty: "Empty", partly: "Room left", full: "Full", over: "Over" };

const vinTail = (vin: string) => vin.slice(-6);

function CarLine({ car, dim }: { car: MapCar; dim: boolean }) {
  return (
    <Link to={`/cars?q=${encodeURIComponent(car.vin)}`}
      className={cn("flex items-center gap-1 rounded px-1 -mx-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dim && "opacity-40")}
      title={`${car.vin} · ${car.manufacturerCode} · day ${car.days}${car.status === "on-hold" ? " · on hold" : ""}`}>
      <span className="font-mono font-semibold">{vinTail(car.vin)}</span>
      <span className="text-muted-foreground">{car.manufacturerCode}</span>
      <span className="ml-auto tabular-nums text-muted-foreground">d{car.days}</span>
      {car.status === "on-hold" && <PauseCircle className="h-3.5 w-3.5 text-warning shrink-0" aria-label="on hold" />}
    </Link>
  );
}

function Tile({ tile, matches }: { tile: MapTile; matches: (c: MapCar) => boolean }) {
  const { slot, cars, state } = tile;
  const label = slot.slot ?? slot.row_label ?? slot.code;
  return (
    <div role="group" className={cn("rounded-md border-2 p-1.5 min-h-[4.25rem] flex flex-col", TILE_STYLE[state], !slot.active && "opacity-70")}
      aria-label={`Slot ${slot.code}: ${cars.length} of ${slot.capacity}, ${STATE_WORD[state].toLowerCase()}`}>
      <div className="flex items-baseline justify-between gap-1 text-xs">
        <span className="font-semibold" title={slot.code}>{label}</span>
        <span className={cn("tabular-nums", state === "over" ? "text-destructive font-semibold" : "text-muted-foreground")}>
          {(slot.capacity > 1 || state === "over") && `${cars.length}/${slot.capacity}`}
        </span>
      </div>
      <div className="mt-0.5 space-y-0.5">
        {cars.slice(0, 3).map((c) => <CarLine key={c.visitId} car={c} dim={!matches(c)} />)}
        {cars.length > 3 && <p className="text-xs text-muted-foreground">+{cars.length - 3} more</p>}
        {cars.length === 0 && <p className="text-xs text-muted-foreground">{slot.active ? "Empty" : "Not in use"}</p>}
      </div>
    </div>
  );
}

const toMapCar = (c: OpenCar, now: Date): MapCar => ({
  visitId: c.visitId, vin: c.vin, manufacturerCode: c.manufacturerCode, locationId: c.locationId,
  zone: c.zone, slot: c.slot, status: c.status, days: daysInLot(c.gateIn, now),
});

/**
 * The lot as it is now: each zone's rows of slots with the cars in them, and
 * the cars that have no listed slot. Refreshes every minute while open.
 */
const CarLotMap = () => {
  const { toast } = useToast();
  const { isAdmin, isReadOnlyAdmin } = useAuth();
  const { yardId, isCarLot } = useYardKind();
  const [slots, setSlots] = useState<LotSlot[] | null>(null);
  const [cars, setCars] = useState<OpenCar[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [maker, setMaker] = useState(ALL);
  const [showTable, setShowTable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);
  const markLoaded = useRef<() => void>(() => undefined);

  const load = useCallback(async () => {
    if (!yardId) return;
    const request = ++latest.current;
    setRefreshing(true);
    const at = new Date();
    try {
      const [s, c] = await Promise.all([loadLotSlots(yardId), loadOpenCars(yardId)]);
      if (request !== latest.current) return;
      setSlots(s); setCars(c); setNow(at);
      markLoaded.current();
    } catch (e) {
      if (request !== latest.current) return;
      toast({ title: "Map not updated", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
      setSlots((s) => s ?? []);
    } finally {
      if (request === latest.current) setRefreshing(false);
    }
  }, [yardId, toast]);
  // another lot (the owner's switcher) starts from an empty map, never the last lot's cars
  useEffect(() => { setSlots(null); setCars([]); void load(); }, [load]);
  const reload = useCallback(() => { void load(); }, [load]);
  markLoaded.current = useAutoRefresh(reload);

  const mapCars = useMemo(() => cars.map((c) => toMapCar(c, now)), [cars, now]);
  const map = useMemo(() => buildLotMap(slots ?? [], mapCars), [slots, mapCars]);
  const makers = useMemo(() => [...new Set(cars.map((c) => c.manufacturerCode).filter(Boolean))].sort(), [cars]);
  const matches = useCallback((c: MapCar) => maker === ALL || c.manufacturerCode === maker, [maker]);
  const used = map.zones.reduce((n, z) => n + z.used, 0);
  const capacity = map.zones.reduce((n, z) => n + z.capacity, 0);
  const unplaced = map.unplaced.filter(matches);
  const canMove = !isReadOnlyAdmin();

  if (!isCarLot) return <div className="p-8 text-muted-foreground">Select a car-lot yard (top right) to see its map.</div>;

  return (
    <div className="p-3 sm:p-6 space-y-4 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={MapIcon}
        title="Lot map"
        subtitle={slots
          ? `${cars.length} cars in the lot · ${used} of ${capacity} places taken · updated ${formatTime(now)}`
          : "Loading…"}
        action={
          <div className="flex flex-wrap gap-2">
            {canMove && <Button asChild><Link to="/cars/move"><MoveRight className="h-4 w-4 mr-1" /> Move a car</Link></Button>}
            <Button variant="outline" size="icon" onClick={() => void load()} disabled={refreshing} aria-label="Refresh">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={maker} onValueChange={setMaker}>
          <SelectTrigger className="w-48" aria-label="Manufacturer"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All manufacturers</SelectItem>
            {makers.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
          {showTable ? <><Grid3x3 className="h-4 w-4 mr-1" /> Map</> : <><Table2 className="h-4 w-4 mr-1" /> Table</>}
        </Button>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground sm:ml-auto" aria-label="Key">
          {(["empty", "partly", "full", "over"] as const).map((s) => (
            <li key={s} className="flex items-center gap-1"><span className={cn("inline-block h-3 w-4 rounded-sm border-2", TILE_STYLE[s])} aria-hidden />{STATE_WORD[s]}</li>
          ))}
          <li className="flex items-center gap-1"><PauseCircle className="h-3.5 w-3.5 text-warning" aria-hidden /> On hold</li>
          <li>d = day in the lot</li>
        </ul>
      </div>

      {slots === null ? (
        <Skeleton className="h-64 w-full" />
      ) : slots.length === 0 ? (
        <Card>
          <CardContent className="p-6 space-y-2">
            <p className="font-medium">This lot has no slots yet, so there is no map.</p>
            <p className="text-sm text-muted-foreground">
              {isAdmin() ? <>Add them under <Link to="/cars/slots" className="underline">Slots</Link> and print their labels.</> : "The car lot's admin adds them under Slots."}
            </p>
          </CardContent>
        </Card>
      ) : showTable ? (
        <Card>
          <CardContent className="p-0 sm:p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slot</TableHead>
                  <TableHead>Cars</TableHead>
                  <TableHead className="text-right">Taken</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {map.zones.flatMap((z) => z.rows.flatMap((r) => r.tiles)).map((t) => (
                  <TableRow key={t.slot.id}>
                    <TableCell className="font-semibold">{t.slot.code}</TableCell>
                    <TableCell>
                      {t.cars.length === 0 ? <span className="text-muted-foreground">—</span> : (
                        <ul className="space-y-0.5">{t.cars.map((c) => (
                          <li key={c.visitId} className={cn(!matches(c) && "opacity-40")}>
                            <Link to={`/cars?q=${encodeURIComponent(c.vin)}`} className="font-mono underline-offset-2 hover:underline">{c.vin}</Link>
                            <span className="text-muted-foreground"> · {c.manufacturerCode} · day {c.days}</span>
                            {c.status === "on-hold" && <Badge variant="outline" className="ml-1">On hold</Badge>}
                          </li>))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", t.state === "over" && "text-destructive font-semibold")}>
                      {t.cars.length} / {t.slot.capacity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        map.zones.map((z) => (
          <Card key={z.zone}>
            <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0 space-y-0">
              <CardTitle className="text-base">
                Zone {z.zone} <span className="font-normal text-sm text-muted-foreground">· {z.used} of {z.capacity} places taken</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 space-y-3">
              {z.rows.map((r) => (
                <div key={r.row ?? "-"}>
                  {r.row && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Row {r.row}</p>}
                  <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))]">
                    {r.tiles.map((t) => <Tile key={t.slot.id} tile={t} matches={matches} />)}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {slots !== null && (
        <Card>
          <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0 space-y-0">
            <CardTitle className="text-base">
              Cars without a slot <span className="font-normal text-sm text-muted-foreground">· {unplaced.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            {unplaced.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every car{maker === ALL ? "" : ` of ${maker}`} is in a listed slot.</p>
            ) : (
              <ul className="divide-y">
                {unplaced.map((c) => (
                  <li key={c.visitId} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <Link to={`/cars?q=${encodeURIComponent(c.vin)}`} className="font-mono underline-offset-2 hover:underline">{c.vin}</Link>
                    <span className="text-muted-foreground">{c.manufacturerCode} · day {c.days}</span>
                    <span>{placeLabel({ inSlot: false, zone: c.zone, slot: c.slot }) || <span className="text-muted-foreground">no spot</span>}</span>
                    {c.status === "on-hold" && <Badge variant="outline">On hold</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CarLotMap;
