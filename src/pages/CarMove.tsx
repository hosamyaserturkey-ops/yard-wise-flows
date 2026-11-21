import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, MoveRight, ScanLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { ScanBox } from "@/components/carlot/ScanBox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useYardKind } from "@/hooks/useYardKind";
import { carsPerSlot, loadLotSlots, loadOpenCars, type OpenCar } from "@/lib/carLotData";
import { normalizeVin } from "@/lib/vin";
import { deviceLabel, freePlaces, readScan, slotErrorMessage, spotKey, type LotSlot } from "@/lib/lotSlots";
import { cn } from "@/lib/utils";

type Step = "car" | "place" | "confirm" | "done";
type Target =
  | { kind: "slot"; slot: LotSlot; via: "scan" | "list" }
  | { kind: "typed"; zone: string; slot: string };

const spotText = (c: Pick<OpenCar, "zone" | "slot">) => [c.zone, c.slot].filter(Boolean).join(" / ") || "no spot";

/**
 * Moving a car, built for one hand on a phone: scan the car (its tag or VIN
 * barcode, or type the last digits of the VIN), scan the slot (or pick one, or
 * type a spot), confirm. The database checks everything again and records it.
 */
const CarMove = () => {
  const { isReadOnlyAdmin, isAdmin } = useAuth();
  const { yardId, isCarLot } = useYardKind();
  const [cars, setCars] = useState<OpenCar[] | null>(null);
  const [slots, setSlots] = useState<LotSlot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("car");
  const [car, setCar] = useState<OpenCar | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [carMode, setCarMode] = useState<"scan" | "search">("scan");
  const [placeMode, setPlaceMode] = useState<"scan" | "list" | "type">("scan");
  const [vinSearch, setVinSearch] = useState("");
  const [typedZone, setTypedZone] = useState("");
  const [typedSlot, setTypedSlot] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  // The Cars list and the lot map open this page on a car: /cars/move?vin=<VIN>.
  const [params] = useSearchParams();
  const askedVin = useRef(params.get("vin"));

  const load = useCallback(async () => {
    if (!yardId) return;
    try {
      const [c, s] = await Promise.all([loadOpenCars(yardId), loadLotSlots(yardId)]);
      setCars(c);
      setSlots(s.filter((x) => x.active));
      setLoadError(null);
    } catch (e) {
      setLoadError(slotErrorMessage({ message: e instanceof Error ? e.message : String(e) }));
    }
  }, [yardId]);
  useEffect(() => { void load(); }, [load]);

  const occupancy = useMemo(() => carsPerSlot(cars ?? []), [cars]);
  const slotsByZone = useMemo(() => {
    const zones = new Map<string, LotSlot[]>();
    for (const s of [...slots].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))) {
      zones.set(s.zone, [...(zones.get(s.zone) ?? []), s]);
    }
    return [...zones];
  }, [slots]);

  const restart = () => {
    setStep("car"); setCar(null); setTarget(null); setNotice(null); setReason(""); setVinSearch("");
    setTypedZone(""); setTypedSlot(""); setPlaceMode("scan"); setCarMode("scan");
  };

  // fresh numbers for the free places before a slot is chosen
  const chooseCar = useCallback((c: OpenCar) => { setCar(c); setNotice(null); setStep("place"); void load(); }, [load]);

  useEffect(() => {
    const vin = askedVin.current;
    if (!vin || !cars) return;
    askedVin.current = null; // once
    const found = cars.find((c) => c.vin === normalizeVin(vin));
    if (found) chooseCar(found);
    else setNotice(`No car with VIN ${normalizeVin(vin)} is in this lot. It may have left already.`);
  }, [cars, chooseCar]);

  const onCarCode = (text: string, how: "scan" | "typed") => {
    const r = readScan(text);
    if (r.kind === "car") {
      const found = cars?.find((c) => c.vin === r.vin);
      if (found) chooseCar(found);
      else setNotice(`No car with VIN ${r.vin} is in this lot. It may have left already.`);
    } else if (r.kind === "slot") {
      setNotice("That is a slot label. Scan the car first: its tag or its VIN barcode.");
    } else if (how === "typed") {
      setVinSearch(text.trim().toUpperCase());
      setCarMode("search");
      setNotice(null);
    } else {
      setNotice("That code is not a car tag or a VIN.");
    }
  };

  const vinMatches = useMemo(() => {
    const q = vinSearch.replace(/\s+/g, "").toUpperCase();
    if (q.length < 3 || !cars) return [];
    return cars.filter((c) => c.vin.includes(q)).sort((a, b) => Number(b.vin.endsWith(q)) - Number(a.vin.endsWith(q))).slice(0, 8);
  }, [vinSearch, cars]);

  const chooseSlot = (slot: LotSlot, via: "scan" | "list") => { setTarget({ kind: "slot", slot, via }); setNotice(null); setStep("confirm"); };

  const onSlotCode = (text: string, how: "scan" | "typed") => {
    const r = readScan(text);
    if (r.kind === "slot") {
      const found = slots.find((s) => s.id === r.slotId);
      if (found) chooseSlot(found, how === "scan" ? "scan" : "list");
      else setNotice("That label is for a slot that is not in this lot, or not in use any more.");
      return;
    }
    if (r.kind === "car") { setNotice("That is a car. Now scan the slot's label."); return; }
    // a typed code: a slot's printed name, or a spot to type
    const key = spotKey(text);
    const byName = slots.find((s) => spotKey(s.code) === key);
    if (byName) chooseSlot(byName, "list");
    else {
      // zone first, as on the labels: "B-03-07" → zone B, slot 03-07
      const [zone, ...rest] = text.trim().split(/[\s\-/]+/);
      setTypedZone(zone ?? ""); setTypedSlot(rest.join("-")); setPlaceMode("type");
      setNotice("No slot has that name. Check it, or keep it as a typed spot.");
    }
  };

  const typedMatch = useMemo(() => {
    const key = spotKey([typedZone, typedSlot].join(" "));
    return key ? slots.find((s) => spotKey(s.code) === key) ?? null : null;
  }, [typedZone, typedSlot, slots]);

  const useTyped = () => {
    if (!typedZone.trim() && !typedSlot.trim()) { setNotice("Type a zone or a slot."); return; }
    if (typedMatch) chooseSlot(typedMatch, "list");
    else { setTarget({ kind: "typed", zone: typedZone.trim(), slot: typedSlot.trim() }); setNotice(null); setStep("confirm"); }
  };

  const targetSlot = target?.kind === "slot" ? target.slot : null;
  const carsInTarget = targetSlot ? (occupancy.get(targetSlot.id) ?? 0) - (car?.locationId === targetSlot.id ? 1 : 0) : 0;
  const targetFull = !!targetSlot && carsInTarget >= targetSlot.capacity;
  const alreadyThere = !!targetSlot && car?.locationId === targetSlot.id;
  const occupantsOfTarget = targetSlot && cars ? cars.filter((c) => c.locationId === targetSlot.id && c.visitId !== car?.visitId).map((c) => c.vin) : [];

  const confirm = async () => {
    if (!car || !target) return;
    if (targetFull && !isAdmin()) { setNotice("That slot is full. Choose another one, or ask the lot's admin."); return; }
    if (targetFull && !reason.trim()) { setNotice("Write why this car may go in a full slot."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("car_lot_move", {
      _visit_id: car.visitId,
      ...(target.kind === "slot" ? { _location_id: target.slot.id } : { _zone: target.zone, _slot: target.slot }),
      _via: target.kind === "slot" ? target.via : "typed",
      _device: deviceLabel(),
      ...(targetFull ? { _override_reason: reason.trim() } : {}),
    });
    setBusy(false);
    // the slot may have filled up meanwhile: show the latest numbers with the message
    if (error) { setNotice(slotErrorMessage(error)); void load(); return; }
    setResult(data ?? "");
    setStep("done");
    void load();
  };

  if (!isCarLot) return <div className="p-8 text-muted-foreground">Select a car-lot yard (top right) to move cars.</div>;
  if (isReadOnlyAdmin()) return <div className="p-8 text-muted-foreground">Read-only admins see the lot but don't move cars.</div>;

  const stepNo = { car: 1, place: 2, confirm: 3, done: 3 }[step];

  return (
    <div className="mx-auto max-w-xl p-3 sm:p-6 space-y-4 animate-in fade-in-0 duration-300">
      <PageHeader icon={MoveRight} title="Move a car" subtitle={step === "done" ? "Done" : `Step ${stepNo} of 3`} />

      {loadError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{loadError}</p>}

      {car && step !== "done" && (
        <Card>
          <CardContent className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-base break-all">{car.vin}</p>
              <p className="text-sm text-muted-foreground">{[car.manufacturerName, car.model].filter(Boolean).join(" · ")}</p>
              <p className="text-sm">Now: <span className="font-medium">{spotText(car)}</span></p>
            </div>
            {car.status === "on-hold" && <Badge variant="outline">On hold</Badge>}
          </CardContent>
        </Card>
      )}

      {notice && <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{notice}</p>}

      {step === "car" && (
        <section aria-label="Which car" className="space-y-3">
          <h2 className="text-lg font-semibold">1. Which car?</h2>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="How to find the car">
            <Button variant={carMode === "scan" ? "default" : "outline"} className="h-12" onClick={() => setCarMode("scan")}>
              <ScanLine className="h-4 w-4 mr-1" /> Scan tag or VIN
            </Button>
            <Button variant={carMode === "search" ? "default" : "outline"} className="h-12" onClick={() => setCarMode("search")}>
              Type VIN digits
            </Button>
          </div>
          {carMode === "scan" ? (
            <ScanBox active={step === "car" && carMode === "scan"} onResult={onCarCode}
              hint="Point at the car tag or the VIN barcode" typePlaceholder="Or type the VIN" />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="vin-digits">Last digits of the VIN</Label>
              <Input id="vin-digits" value={vinSearch} onChange={(e) => setVinSearch(e.target.value)} inputMode="text"
                autoCapitalize="characters" autoComplete="off" placeholder="e.g. 000123" className="h-12 text-base font-mono" />
              {vinSearch.trim().length >= 3 && vinMatches.length === 0 && (
                <p className="text-sm text-muted-foreground">No car in the lot has those characters in its VIN.</p>
              )}
              <ul className="space-y-2">
                {vinMatches.map((c) => (
                  <li key={c.visitId}>
                    <button type="button" onClick={() => chooseCar(c)}
                      className="w-full min-h-14 rounded-md border px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="block font-mono">{c.vin}</span>
                      <span className="block text-xs text-muted-foreground">{c.manufacturerName} · ticket {c.ticketNumber} · {spotText(c)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {step === "place" && (
        <section aria-label="Where to" className="space-y-3">
          <h2 className="text-lg font-semibold">2. Where to?</h2>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="How to choose the place">
            {(["scan", "list", "type"] as const).map((m) => (
              <Button key={m} variant={placeMode === m ? "default" : "outline"} className="h-12" onClick={() => { setPlaceMode(m); setNotice(null); }}>
                {m === "scan" ? "Scan slot" : m === "list" ? "Pick slot" : "Type spot"}
              </Button>
            ))}
          </div>
          {placeMode === "scan" && (
            <ScanBox active={step === "place" && placeMode === "scan"} onResult={onSlotCode}
              hint="Point at the slot's QR label" typePlaceholder="Or type the slot's name, e.g. B-03-07" />
          )}
          {placeMode === "list" && (
            slots.length === 0 ? (
              <p className="text-sm text-muted-foreground">This lot has no slots yet. The lot's admin adds them under Slots; until then, type a spot.</p>
            ) : (
              <div className="space-y-3">
                {slotsByZone.map(([zone, list]) => (
                  <div key={zone}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Zone {zone}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {list.map((s) => {
                        const inIt = occupancy.get(s.id) ?? 0;
                        const free = freePlaces(s, inIt);
                        return (
                          <button key={s.id} type="button" onClick={() => chooseSlot(s, "list")}
                            className={cn("min-h-14 rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              free > 0 ? "hover:bg-muted/60" : "opacity-70 hover:bg-muted/40")}>
                            <span className="block font-semibold">{s.code}</span>
                            <span className="block text-xs text-muted-foreground">{free > 0 ? `${free} free` : "Full"}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
          {placeMode === "type" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="t-zone">Zone</Label>
                  <Input id="t-zone" value={typedZone} onChange={(e) => setTypedZone(e.target.value)} className="h-12 text-base" /></div>
                <div className="space-y-1"><Label htmlFor="t-slot">Slot</Label>
                  <Input id="t-slot" value={typedSlot} onChange={(e) => setTypedSlot(e.target.value)} className="h-12 text-base" /></div>
              </div>
              {typedMatch && <p className="text-sm">That is slot <span className="font-semibold">{typedMatch.code}</span>.</p>}
              <Button className="h-12 w-full" onClick={useTyped}>Use this spot</Button>
            </div>
          )}
          <Button variant="ghost" className="h-11" onClick={() => { setStep("car"); setCar(null); setNotice(null); }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Another car
          </Button>
        </section>
      )}

      {step === "confirm" && car && target && (
        <section aria-label="Confirm" className="space-y-3">
          <h2 className="text-lg font-semibold">3. Confirm</h2>
          <Card>
            <CardContent className="p-4 space-y-1 text-base">
              <p>From <span className="font-medium">{spotText(car)}</span></p>
              <p>To <span className="text-xl font-bold">{target.kind === "slot" ? target.slot.code : [target.zone, target.slot].filter(Boolean).join(" / ")}</span>
                {target.kind === "typed" && <span className="text-sm text-muted-foreground"> (typed spot)</span>}</p>
            </CardContent>
          </Card>
          {alreadyThere && <p className="text-sm text-muted-foreground">The car is already in this slot.</p>}
          {targetFull && !alreadyThere && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm space-y-2">
              <p>{targetSlot?.code} is full: it holds {occupantsOfTarget.join(", ")}.</p>
              {isAdmin() ? (
                <div className="space-y-1">
                  <Label htmlFor="override">Reason to put it there anyway (required)</Label>
                  <Input id="override" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
                    placeholder="e.g. two small cars fit" className="h-11" />
                </div>
              ) : <p>Choose another slot, or ask the lot's admin.</p>}
            </div>
          )}
          <Button className="h-14 w-full text-lg" onClick={() => void confirm()}
            disabled={busy || alreadyThere || (targetFull && (!isAdmin() || !reason.trim()))}>
            {busy ? "Moving…" : "Move the car"}
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => { setStep("place"); setTarget(null); setNotice(null); setReason(""); }}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Another place
          </Button>
        </section>
      )}

      {step === "done" && car && (
        <section aria-label="Done" className="space-y-4 text-center py-4">
          <CheckCircle2 className="h-14 w-14 mx-auto text-success" />
          <p className="text-lg"><span className="font-mono break-all">{car.vin}</span></p>
          <p className="text-2xl font-bold">is now at {result || "its new place"}</p>
          <div className="grid gap-2">
            <Button className="h-14 text-lg" onClick={restart}>Move another car</Button>
            <Button variant="outline" className="h-12" asChild><Link to="/cars">Back to Cars</Link></Button>
          </div>
        </section>
      )}
    </div>
  );
};

export default CarMove;
