import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useYardKind } from "@/hooks/useYardKind";
import { useYards } from "@/hooks/useYards";
import { useToast } from "@/hooks/use-toast";
import { Link, useSearchParams } from "react-router-dom";
import { Car, ClipboardCheck, History, LogOut, MoveRight, Pencil, PauseCircle, PlayCircle, Plus, Printer, Tag } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { formatDate, formatDateTime } from "@/lib/format";
import { normalizeVin, validateVin } from "@/lib/vin";
import {
  VISIT_STATUS_LABEL, allowedActions, carActionErrorMessage, daysInLot, daysOverFree, gateInErrorMessage,
  gateOutBlockedReason, type VisitStatus,
} from "@/lib/carLot";
import { openTicketWindow, printCarTicket, type CarTicketKind } from "@/lib/carTicket";
import { loadCarTicket } from "@/lib/carTicketData";
import { carEditChanges, formFromCar, hasChanges, validateCarEdit, type CarEditForm } from "@/lib/carEdit";
import { eventChangeLines, eventHow, eventLabel, type CarEvent } from "@/lib/carHistory";
import { carsPerSlot, loadLotSlots, loadOpenCars } from "@/lib/carLotData";
import { openPrintWindow, type CarTagData } from "@/lib/lotPrint";
import { printCarTag } from "@/lib/lotPrintJobs";
import { defaultSpot, placeLabel, slotErrorMessage, type LotSlot, type SpotChoice } from "@/lib/lotSlots";
import { SpotPicker } from "@/components/carlot/SpotPicker";

interface VisitRow {
  id: string;
  status: VisitStatus;
  gate_in_time: string;
  gate_out_time: string | null;
  lot_zone: string | null;
  lot_slot: string | null;
  /** Set when the car is in a listed slot; then only Move changes its place. */
  location_id: string | null;
  free_days: number;
  ticket_number: number;
  driver_name: string | null;
  truck_number: string | null;
  odometer_in: number | null;
  key_count: number | null;
  hold_reason: string | null;
  held_at: string | null;
  vehicle_inspections: { phase: string; status: string }[] | null;
  vehicles: { id: string; vin: string; model: string | null; model_year: number | null; color: string | null } | null;
  manufacturers: { code: string; name: string } | null;
}
interface MfrOption { id: string; code: string; name: string; }

/** The database lets a car leave only once its departure inspection is closed. */
const departureClosed = (r: VisitRow): boolean =>
  (r.vehicle_inspections ?? []).some((i) => i.phase === "gate_out" && i.status === "closed");

/** The reception ticket carries the arrival condition, so it prints once that inspection is closed. */
const arrivalClosed = (r: VisitRow): boolean =>
  (r.vehicle_inspections ?? []).some((i) => i.phase === "gate_in" && i.status === "closed");

type Tab = "open" | "out";

const EMPTY_FORM = {
  manufacturer_id: "", vin: "", model: "", model_year: "", color: "",
  odometer_in: "", key_count: "", driver_name: "", truck_number: "",
};
const NO_SPOT: SpotChoice = { kind: "typed", zone: "", slot: "" };

/** A listed slot by its code ("A-01-01"), a typed spot as "zone / slot". */
const spotOf = (r: Pick<VisitRow, "location_id" | "lot_zone" | "lot_slot">) =>
  placeLabel({ inSlot: !!r.location_id, zone: r.lot_zone, slot: r.lot_slot });
const EMPTY_OUT = { driver: "", truck: "", odometer: "" };

/** Whole number from a text box, or null when it is empty or not a whole number. */
const intOrNull = (v: string): number | null => {
  const t = v.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};
const textOrNull = (v: string): string | null => v.trim() || null;

/** The car lot's main screen: cars in the lot, register a car, hold/release, gate out. */
const Cars = () => {
  const { toast } = useToast();
  const { isReadOnlyAdmin, isAdmin, profile } = useAuth();
  const { yardId, isCarLot } = useYardKind();
  const { nameOf } = useYards();
  const printedBy = profile?.username || profile?.full_name || "system";
  const canWrite = !isReadOnlyAdmin();
  // Correcting a car is for the car lot's admin and the owner (the database allows more; the screen offers less).
  const canEdit = isAdmin();

  const [tab, setTab] = useState<Tab>("open");
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [mfrs, setMfrs] = useState<MfrOption[]>([]);
  // The Overview links to a car as /cars?q=<VIN>.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [spot, setSpot] = useState<SpotChoice>(NO_SPOT);
  const [lotSlots, setLotSlots] = useState<LotSlot[]>([]);
  const [slotUse, setSlotUse] = useState<Map<string, number>>(new Map());
  const [printTag, setPrintTag] = useState(true);
  const [outFor, setOutFor] = useState<VisitRow | null>(null);
  const [outForm, setOutForm] = useState(EMPTY_OUT);
  const [editFor, setEditFor] = useState<VisitRow | null>(null);
  const [editForm, setEditForm] = useState<CarEditForm | null>(null);
  const [editReason, setEditReason] = useState("");
  const [holdFor, setHoldFor] = useState<VisitRow | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [historyFor, setHistoryFor] = useState<VisitRow | null>(null);
  const [history, setHistory] = useState<CarEvent[] | null>(null);

  const load = useCallback(async () => {
    if (!yardId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("vehicle_visits")
      .select("id, status, gate_in_time, gate_out_time, lot_zone, lot_slot, location_id, free_days, ticket_number, driver_name, truck_number, odometer_in, key_count, hold_reason, held_at, vehicle_inspections(phase, status), vehicles(id, vin, model, model_year, color), manufacturers(code, name)")
      .eq("yard_id", yardId)
      .order("gate_in_time", { ascending: false })
      .limit(500);
    query = tab === "open" ? query.in("status", ["in-lot", "on-hold"]) : query.eq("status", "out");
    const [visitsRes, mfrRes] = await Promise.all([
      query,
      supabase.from("manufacturers").select("id, code, name").eq("yard_id", yardId).eq("active", true).order("name"),
    ]);
    const error = visitsRes.error ?? mfrRes.error;
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    setRows((visitsRes.data ?? []) as unknown as VisitRow[]);
    setMfrs(mfrRes.data ?? []);
    setLoading(false);
  }, [yardId, tab, toast]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vehicles?.vin, r.vehicles?.model, r.manufacturers?.name, r.manufacturers?.code, r.lot_zone, r.lot_slot,
        [r.lot_zone, r.lot_slot].filter(Boolean).join("-"), String(r.ticket_number)]
        .some((v) => v?.toUpperCase().includes(q)));
  }, [rows, search]);

  const now = new Date();

  /** Inspect links for everyone; hold / release / gate-out for those who may write. */
  const renderActions = (r: VisitRow) => {
    const closed = departureClosed(r);
    const can = allowedActions(r.status, closed);
    const blocked = gateOutBlockedReason(r.status, closed);
    return (
      <>
        <Button size="sm" variant="outline" asChild>
          <Link to={`/cars/${r.id}/inspect/gate_in`}><ClipboardCheck className="h-3.5 w-3.5 mr-1" /> In</Link>
        </Button>
        {(tab === "open" || r.status === "out") && (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/cars/${r.id}/inspect/gate_out`}><ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Out</Link>
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => openHistory(r)}>
          <History className="h-3.5 w-3.5 mr-1" /> History
        </Button>
        {canWrite && arrivalClosed(r) && (
          <Button size="sm" variant="outline" onClick={() => reprint(r.id, "gate_in")}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Ticket
          </Button>
        )}
        {canWrite && r.status === "out" && (
          <Button size="sm" variant="outline" onClick={() => reprint(r.id, "gate_out")}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Release ticket
          </Button>
        )}
        {canWrite && tab === "open" && (
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/cars/move?vin=${encodeURIComponent(r.vehicles?.vin ?? "")}`}><MoveRight className="h-3.5 w-3.5 mr-1" /> Move</Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => printTagFor(r)}>
              <Tag className="h-3.5 w-3.5 mr-1" /> Tag
            </Button>
          </>
        )}
        {canEdit && tab === "open" && (
          <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
        {canWrite && tab === "open" && (
          <>
            {can.hold && (
              <Button size="sm" variant="outline" onClick={() => { setHoldFor(r); setHoldReason(""); }}>
                <PauseCircle className="h-3.5 w-3.5 mr-1" /> Hold
              </Button>
            )}
            {can.release && (
              <Button size="sm" variant="outline" onClick={() => releaseHold(r)}>
                <PlayCircle className="h-3.5 w-3.5 mr-1" /> Release hold
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={!can.gateOut}
              title={blocked}
              onClick={() => { setOutFor(r); setOutForm(EMPTY_OUT); }}>
              <LogOut className="h-3.5 w-3.5 mr-1" /> Gate out
            </Button>
          </>
        )}
      </>
    );
  };


  /** Opens Register with fresh free places, preselecting a receiving slot with room. */
  const openRegister = async () => {
    setForm(EMPTY_FORM);
    setSpot(NO_SPOT);
    setPrintTag(true);
    setRegisterOpen(true);
    if (!yardId) return;
    try {
      const [slots, cars] = await Promise.all([loadLotSlots(yardId), loadOpenCars(yardId)]);
      const use = carsPerSlot(cars);
      setLotSlots(slots);
      setSlotUse(use);
      // only if nothing was typed meanwhile
      setSpot((cur) => (cur.kind === "typed" && !cur.zone && !cur.slot ? defaultSpot(slots, use) : cur));
    } catch {
      setLotSlots([]); // the typed boxes still work
    }
  };

  const tagData = (vin: string, ticketNumber: number, mfr: string, car: (string | number | null | undefined)[], arrived: string, spotText: string): Omit<CarTagData, "qrSvg"> => ({
    vin, ticketNumber, manufacturerName: mfr, model: car.filter(Boolean).join(" · "), arrived, spot: spotText, yardName: nameOf(yardId),
  });

  /** Prints a car's tag into a window opened at the click. */
  const sendTag = (win: Window | null, tag: Omit<CarTagData, "qrSvg">) => {
    if (!win) { toast({ title: "Allow pop-ups to print", description: "Your browser blocked the tag window.", variant: "destructive" }); return; }
    printCarTag(win, tag, printedBy).catch((e) => {
      win.close();
      toast({ title: "Tag not printed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    });
  };

  const printTagFor = (r: VisitRow) => {
    if (!r.vehicles) return;
    sendTag(openPrintWindow("Car tag"), tagData(r.vehicles.vin, r.ticket_number, r.manufacturers?.name ?? "",
      [r.vehicles.model, r.vehicles.model_year, r.vehicles.color], r.gate_in_time, spotOf(r)));
  };

  /** Gate a car in: find or create the vehicle by VIN, then open its visit. */
  const register = async () => {
    const invalid = validateVin(form.vin) ?? (form.manufacturer_id ? null : "Select the manufacturer.");
    if (invalid) { toast({ title: "Check the form", description: invalid, variant: "destructive" }); return; }
    const year = form.model_year.trim() ? intOrNull(form.model_year) : null;
    if (form.model_year.trim() && (year === null || year < 1980 || year > 2100)) {
      toast({ title: "Check the form", description: "Model year must be between 1980 and 2100.", variant: "destructive" }); return;
    }
    if (!yardId) return;
    const vin = normalizeVin(form.vin);
    // the tag window must open straight from the click, before any waiting
    const tagWindow = printTag ? openPrintWindow("Car tag") : null;
    let registered = false;
    setBusy(true);
    try {
      const { data: existing, error: findErr } = await supabase
        .from("vehicles").select("id, manufacturer_id, manufacturers(name)").eq("vin", vin).maybeSingle();
      if (findErr) throw findErr;

      let vehicleId: string;
      if (existing) {
        if (existing.manufacturer_id !== form.manufacturer_id) {
          const other = (existing as unknown as { manufacturers: { name: string } | null }).manufacturers?.name ?? "another manufacturer";
          toast({ title: "VIN already registered", description: `This VIN belongs to ${other}. Check the VIN or the manufacturer.`, variant: "destructive" });
          return;
        }
        vehicleId = existing.id;
      } else {
        const { data: created, error: vErr } = await supabase.from("vehicles").insert({
          vin, yard_id: yardId, manufacturer_id: form.manufacturer_id,
          model: textOrNull(form.model), model_year: year, color: textOrNull(form.color),
        }).select("id").single();
        if (vErr) throw vErr;
        vehicleId = created.id;
      }

      // A listed slot goes by its id (the database fills in zone and slot); a typed
      // spot as text, which the database still matches to a slot of that name.
      const place = spot.kind === "slot"
        ? { location_id: spot.slotId }
        : spot.kind === "typed" ? { lot_zone: textOrNull(spot.zone), lot_slot: textOrNull(spot.slot) } : {};
      const { data: visit, error: visitErr } = await supabase.from("vehicle_visits").insert({
        vehicle_id: vehicleId,
        ...place,
        odometer_in: intOrNull(form.odometer_in), key_count: intOrNull(form.key_count),
        driver_name: textOrNull(form.driver_name), truck_number: textOrNull(form.truck_number),
      }).select("ticket_number, gate_in_time, location_id, lot_zone, lot_slot").single();
      if (visitErr) throw visitErr;
      registered = true;

      toast({ title: "Car registered", description: [vin, spotOf(visit)].filter(Boolean).join(" · ") });
      if (printTag) {
        const mfr = mfrs.find((m) => m.id === form.manufacturer_id)?.name ?? "";
        sendTag(tagWindow, tagData(vin, visit.ticket_number, mfr, [form.model.trim(), year, form.color.trim()], visit.gate_in_time, spotOf(visit)));
      }
      setRegisterOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const raw = { code: err.code, message: err.message ?? "Unknown error" };
      const said = gateInErrorMessage(raw);
      toast({ title: "Not registered", description: said === raw.message ? slotErrorMessage(raw) : said, variant: "destructive" });
    } finally {
      if (!registered) tagWindow?.close();
      setBusy(false);
    }
  };

  const putOnHold = async () => {
    if (!holdFor) return;
    const reason = holdReason.trim();
    if (!reason) { toast({ title: "Write a reason", description: "Say why the car is put on hold.", variant: "destructive" }); return; }
    setBusy(true);
    // The database records who put it on hold and when.
    const { error } = await supabase.from("vehicle_visits").update({ status: "on-hold", hold_reason: reason }).eq("id", holdFor.id);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: carActionErrorMessage(error), variant: "destructive" }); return; }
    toast({ title: "Car put on hold", description: holdFor.vehicles?.vin });
    setHoldFor(null);
    load();
  };

  const releaseHold = async (row: VisitRow) => {
    const { error } = await supabase.from("vehicle_visits").update({ status: "in-lot" }).eq("id", row.id);
    if (error) { toast({ title: "Not saved", description: carActionErrorMessage(error), variant: "destructive" }); return; }
    toast({ title: "Hold released", description: row.vehicles?.vin });
    load();
  };

  const openHistory = async (r: VisitRow) => {
    setHistoryFor(r);
    setHistory(null);
    const { data, error } = await supabase
      .from("vehicle_events")
      .select("id, at, actor_name, action, changes, reason, via, device")
      .eq("visit_id", r.id)
      .order("at", { ascending: true })
      .order("id", { ascending: true });
    if (error) { toast({ title: "History not loaded", description: error.message, variant: "destructive" }); setHistoryFor(null); return; }
    setHistory((data ?? []) as unknown as CarEvent[]);
  };

  const openEdit = (r: VisitRow) => {
    if (!r.vehicles) return;
    setEditFor(r);
    setEditReason("");
    setEditForm(formFromCar({ ...r.vehicles, lot_zone: r.lot_zone, lot_slot: r.lot_slot, odometer_in: r.odometer_in, key_count: r.key_count, driver_name: r.driver_name, truck_number: r.truck_number, free_days: r.free_days }));
  };

  const saveEdit = async () => {
    if (!editFor?.vehicles || !editForm) return;
    const invalid = validateCarEdit(editForm);
    if (invalid) { toast({ title: "Check the form", description: invalid, variant: "destructive" }); return; }
    const original = formFromCar({ ...editFor.vehicles, lot_zone: editFor.lot_zone, lot_slot: editFor.lot_slot, odometer_in: editFor.odometer_in, key_count: editFor.key_count, driver_name: editFor.driver_name, truck_number: editFor.truck_number, free_days: editFor.free_days });
    const changes = carEditChanges(original, editForm);
    if (!hasChanges(changes)) { setEditFor(null); return; }
    const reason = editReason.trim();
    if (changes.vehicle.vin !== undefined && !reason) {
      toast({ title: "Write a reason", description: "Say why the VIN is being changed.", variant: "destructive" }); return;
    }
    setBusy(true);
    try {
      // One call: the car and its visit are saved together or not at all, and the change is recorded in the history.
      const { error } = await supabase.rpc("car_lot_edit_car", {
        _visit_id: editFor.id, _vehicle: changes.vehicle, _visit: changes.visit, _reason: reason || undefined,
      });
      if (error) throw error;
      toast({ title: "Car updated", description: normalizeVin(editForm.vin) });
      setEditFor(null);
      setEditForm(null);
      load();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast({ title: "Not saved", description: carActionErrorMessage({ code: err.code, message: err.message ?? "Unknown error" }), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  /** Prints a ticket. The window opens at the click (pop-up rules), the data loads after. */
  const printTicket = async (visitId: string, kind: CarTicketKind, win: Window | null, isReprint: boolean) => {
    if (!win) { toast({ title: "Allow pop-ups to print", description: "Your browser blocked the ticket window.", variant: "destructive" }); return; }
    try {
      const data = await loadCarTicket(visitId, kind);
      printCarTicket(data, profile, { isReprint }, win);
    } catch (e) {
      win.close();
      toast({ title: "Ticket not printed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  };

  /** A reprint from the list; the window opens straight from the click, as pop-up rules require. */
  const reprint = (visitId: string, kind: CarTicketKind) => {
    void printTicket(visitId, kind, openTicketWindow(), true);
  };

  const gateOut = async () => {
    if (!outFor) return;
    const ticketWindow = openTicketWindow(); // must open straight from the click
    setBusy(true);
    // The database sets the gate-out time and who released the car.
    const { error } = await supabase.from("vehicle_visits").update({
      status: "out",
      gate_out_driver_name: textOrNull(outForm.driver),
      gate_out_truck_number: textOrNull(outForm.truck),
      odometer_out: intOrNull(outForm.odometer),
    }).eq("id", outFor.id);
    setBusy(false);
    if (error) { ticketWindow?.close(); toast({ title: "Not released", description: carActionErrorMessage(error), variant: "destructive" }); return; }
    toast({ title: "Car released", description: outFor.vehicles?.vin });
    const releasedId = outFor.id;
    setOutFor(null);
    setOutForm(EMPTY_OUT);
    load();
    void printTicket(releasedId, "gate_out", ticketWindow, false);
  };

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  if (!isCarLot) {
    return (
      <div className="p-8 text-muted-foreground">
        Select a car-lot yard (top right) to see its cars.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Car}
        title="Cars"
        subtitle={canWrite ? "Register, hold and release the cars in the lot" : "Cars in the lot (read-only)"}
        action={canWrite ? (
          <Button onClick={() => void openRegister()}>
            <Plus className="h-4 w-4 mr-1" /> Register car
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {(["open", "out"] as Tab[]).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "default" : "ghost"} onClick={() => setTab(t)}>
              {t === "open" ? "In the lot" : "Released"}
            </Button>
          ))}
        </div>
        <Input className="max-w-xs" placeholder="Search VIN, model, manufacturer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-sm text-muted-foreground">{shown.length} {shown.length === 1 ? "car" : "cars"}</span>
      </div>

      <Card>
        <CardHeader><CardTitle>{tab === "open" ? "In the lot" : "Released (latest 500)"}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
            {/* Phones: one card per car, so Status and the buttons are never off-screen. */}
            <div className="space-y-3 min-[1800px]:hidden">
              {shown.map((r) => {
                const days = daysInLot(r.gate_in_time, now, r.gate_out_time);
                const over = daysOverFree(days, r.free_days);
                return (
                  <div key={r.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-sm break-all">{r.vehicles?.vin}</p>
                      <Badge variant={r.status === "on-hold" ? "outline" : "secondary"}>{VISIT_STATUS_LABEL[r.status]}</Badge>
                    </div>
                    <p className="text-sm">{[r.manufacturers?.name, r.vehicles?.model, r.vehicles?.model_year, r.vehicles?.color].filter(Boolean).join(" · ") || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      Ticket {r.ticket_number} · in {formatDate(r.gate_in_time)} · day {days}
                      {over > 0 && r.status !== "out" && <span className="text-warning"> (+{over} over free)</span>}
                      {(r.lot_zone || r.lot_slot) && <> · spot {spotOf(r)}</>}
                    </p>
                    {r.status === "on-hold" && r.hold_reason && (
                      <p className="text-xs rounded bg-warning/10 px-2 py-1 break-words">
                        <span className="font-medium">On hold:</span> {r.hold_reason}
                        {r.held_at && <span className="text-muted-foreground"> · since {formatDate(r.held_at)}</span>}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1 [&_button]:min-h-10 [&_a]:min-h-10">{renderActions(r)}</div>
                  </div>
                );
              })}
              {shown.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  {search ? "No car matches your search" : tab === "open" ? "No cars in the lot" : "No released cars yet"}
                </p>
              )}
            </div>
            <Table className="hidden min-[1800px]:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>Manufacturer</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Spot</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => {
                  const days = daysInLot(r.gate_in_time, now, r.gate_out_time);
                  const over = daysOverFree(days, r.free_days);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.ticket_number}</TableCell>
                      <TableCell className="font-mono text-xs">{r.vehicles?.vin}</TableCell>
                      <TableCell>{r.manufacturers?.name ?? "—"}</TableCell>
                      <TableCell>{[r.vehicles?.model, r.vehicles?.model_year, r.vehicles?.color].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell>{spotOf(r) || "—"}</TableCell>
                      <TableCell>{formatDate(r.gate_in_time)}</TableCell>
                      <TableCell>
                        {days}
                        {over > 0 && r.status !== "out" && <span className="ml-1 text-xs text-warning">(+{over} over free)</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "on-hold" ? "outline" : "secondary"}>{VISIT_STATUS_LABEL[r.status]}</Badge>
                        {r.status === "on-hold" && r.hold_reason && (
                          <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground break-words" title={r.hold_reason}>{r.hold_reason}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        {renderActions(r)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      {search ? "No car matches your search" : tab === "open" ? "No cars in the lot" : "No released cars yet"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        {/* scrolls on a phone, e.g. while the slot scanner is open */}
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Register a car</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1">
              <Label>Manufacturer</Label>
              <Select value={form.manufacturer_id} onValueChange={(v) => setForm({ ...form, manufacturer_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select manufacturer" /></SelectTrigger>
                <SelectContent>{mfrs.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.code})</SelectItem>)}</SelectContent>
              </Select>
              {mfrs.length === 0 && <p className="text-xs text-muted-foreground">No active manufacturers yet. A super admin adds them under Manufacturers.</p>}
            </div>
            <div className="col-span-2 space-y-1">
              <Label>VIN</Label>
              <Input className="font-mono" value={form.vin} maxLength={20} onChange={(e) => setForm({ ...form, vin: e.target.value.toUpperCase() })} placeholder="17 characters" />
            </div>
            <div className="space-y-1"><Label>Model</Label><Input value={form.model} onChange={set("model")} /></div>
            <div className="space-y-1"><Label>Year</Label><Input inputMode="numeric" value={form.model_year} onChange={set("model_year")} /></div>
            <div className="space-y-1"><Label>Colour</Label><Input value={form.color} onChange={set("color")} /></div>
            <div className="space-y-1"><Label>Odometer (km)</Label><Input inputMode="numeric" value={form.odometer_in} onChange={set("odometer_in")} /></div>
            <div className="space-y-1"><Label>Keys</Label><Input inputMode="numeric" value={form.key_count} onChange={set("key_count")} /></div>
            <div className="space-y-1"><Label>Driver</Label><Input value={form.driver_name} onChange={set("driver_name")} /></div>
            <div className="space-y-1"><Label>Truck number</Label><Input value={form.truck_number} onChange={set("truck_number")} /></div>
            <div className="col-span-2">
              <SpotPicker slots={lotSlots} occupancy={slotUse} value={spot} onChange={setSpot} />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Checkbox id="print-tag" checked={printTag} onCheckedChange={(v) => setPrintTag(v === true)} />
              <Label htmlFor="print-tag" className="font-normal">Print the car tag (QR for moving the car; goes on the dashboard)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>Cancel</Button>
            <Button onClick={register} disabled={busy}>{busy ? "Registering…" : "Register car"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editFor} onOpenChange={(open) => { if (!open) { setEditFor(null); setEditForm(null); } }}>
        {/* Do not jump into the VIN box: its text would be selected, and one keystroke would replace it. */}
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Edit car</DialogTitle></DialogHeader>
          {editForm && editFor && (
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2 text-sm text-muted-foreground">
                {editFor.manufacturers?.name} · ticket {editFor.ticket_number}. The manufacturer and the arrival time cannot be changed.
              </div>
              <div className="col-span-2 space-y-1">
                <Label>VIN</Label>
                <Input className="font-mono" value={editForm.vin} maxLength={20} onChange={(e) => setEditForm({ ...editForm, vin: e.target.value.toUpperCase() })} />
                <p className="text-xs text-muted-foreground">Correct a typing mistake only. Tickets already printed keep showing the old VIN.</p>
              </div>
              <div className="space-y-1"><Label>Model</Label><Input value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} /></div>
              <div className="space-y-1"><Label>Year</Label><Input inputMode="numeric" value={editForm.model_year} onChange={(e) => setEditForm({ ...editForm, model_year: e.target.value })} /></div>
              <div className="space-y-1"><Label>Colour</Label><Input value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} /></div>
              <div className="space-y-1"><Label>Free days</Label><Input inputMode="numeric" value={editForm.free_days} onChange={(e) => setEditForm({ ...editForm, free_days: e.target.value })} /></div>
              {editFor.location_id ? (
                <div className="col-span-2 rounded-md border px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                  <span>Spot <span className="font-medium">{spotOf(editFor)}</span> is a listed slot. Use Move to change it.</span>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/cars/move?vin=${encodeURIComponent(editFor.vehicles?.vin ?? "")}`}><MoveRight className="h-3.5 w-3.5 mr-1" /> Move</Link>
                  </Button>
                </div>
              ) : (
                <>
                  <div className="space-y-1"><Label>Zone</Label><Input value={editForm.lot_zone} onChange={(e) => setEditForm({ ...editForm, lot_zone: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Slot</Label><Input value={editForm.lot_slot} onChange={(e) => setEditForm({ ...editForm, lot_slot: e.target.value })} /></div>
                </>
              )}
              <div className="space-y-1"><Label>Odometer at arrival (km)</Label><Input inputMode="numeric" value={editForm.odometer_in} onChange={(e) => setEditForm({ ...editForm, odometer_in: e.target.value })} /></div>
              <div className="space-y-1"><Label>Keys</Label><Input inputMode="numeric" value={editForm.key_count} onChange={(e) => setEditForm({ ...editForm, key_count: e.target.value })} /></div>
              <div className="space-y-1"><Label>Driver</Label><Input value={editForm.driver_name} onChange={(e) => setEditForm({ ...editForm, driver_name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Truck number</Label><Input value={editForm.truck_number} onChange={(e) => setEditForm({ ...editForm, truck_number: e.target.value })} /></div>
              <div className="col-span-2 space-y-1">
                <Label>Reason {normalizeVin(editForm.vin) !== normalizeVin(editFor.vehicles?.vin ?? "") ? "(required: the VIN changes)" : "(optional)"}</Label>
                <Input value={editReason} maxLength={300} onChange={(e) => setEditReason(e.target.value)} placeholder="e.g. VIN mistyped at the gate" />
                <p className="text-xs text-muted-foreground">Every change is kept in the car's history with your name.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditFor(null); setEditForm(null); }}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!holdFor} onOpenChange={(open) => { if (!open) setHoldFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Put {holdFor?.vehicles?.vin} on hold</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="hold-reason">Reason (required)</Label>
            <Textarea id="hold-reason" value={holdReason} maxLength={500} rows={3}
              onChange={(e) => setHoldReason(e.target.value)} placeholder="e.g. Damage dispute, customs, unpaid fees" />
            <p className="text-xs text-muted-foreground">A car on hold cannot be gated out until the hold is released.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldFor(null)}>Cancel</Button>
            <Button onClick={putOnHold} disabled={busy || !holdReason.trim()}>{busy ? "Saving…" : "Put on hold"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyFor} onOpenChange={(open) => { if (!open) { setHistoryFor(null); setHistory(null); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>History · {historyFor?.vehicles?.vin}</DialogTitle></DialogHeader>
          {history === null ? (
            <p className="text-muted-foreground py-2">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-muted-foreground py-2">No changes recorded yet. Changes are recorded from now on.</p>
          ) : (
            <ol className="space-y-3 py-2">
              {history.map((e) => (
                <li key={e.id} className="border-l-2 pl-3">
                  <p className="text-sm font-medium">
                    {eventLabel(e.action)}
                    {e.action === "move" && eventHow(e) && <span className="font-normal text-muted-foreground"> · {eventHow(e)}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(e.at)} · {e.actor_name ?? "System"}</p>
                  {eventChangeLines(e).map((line) => <p key={line} className="text-sm break-words">{line}</p>)}
                  {e.reason && <p className="text-sm break-words"><span className="text-muted-foreground">Reason:</span> {e.reason}</p>}
                </li>
              ))}
            </ol>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setHistoryFor(null); setHistory(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!outFor} onOpenChange={(open) => { if (!open) setOutFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Gate out {outFor?.vehicles?.vin}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1"><Label>Driver</Label><Input value={outForm.driver} onChange={(e) => setOutForm({ ...outForm, driver: e.target.value })} /></div>
            <div className="space-y-1"><Label>Truck number</Label><Input value={outForm.truck} onChange={(e) => setOutForm({ ...outForm, truck: e.target.value })} /></div>
            <div className="space-y-1"><Label>Odometer (km)</Label><Input inputMode="numeric" value={outForm.odometer} onChange={(e) => setOutForm({ ...outForm, odometer: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">Once released, a visit cannot be reopened.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutFor(null)}>Cancel</Button>
            <Button onClick={gateOut} disabled={busy}>{busy ? "Releasing…" : "Release car"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Cars;
