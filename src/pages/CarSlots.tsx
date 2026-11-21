import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Grid3x3, Map as MapIcon, Pencil, Plus, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useYardKind } from "@/hooks/useYardKind";
import { useYards } from "@/hooks/useYards";
import { carsPerSlot, loadLotSlots, loadOpenCars } from "@/lib/carLotData";
import type { LabelSize } from "@/lib/lotPrint";
import { openPrintWindow } from "@/lib/lotPrint";
import { printSlotLabels } from "@/lib/lotPrintJobs";
import {
  MAX_BULK_SLOTS, SLOT_KIND_LABEL, groupByZone, slotCode, slotErrorMessage, slotNameProblem, slotsInRange, spotKey,
  type LotSlot, type SlotKind,
} from "@/lib/lotSlots";

const KINDS: SlotKind[] = ["receiving", "storage", "exit"];
const EMPTY_ONE = { zone: "", row: "", slot: "", kind: "storage" as SlotKind, capacity: "1" };
const EMPTY_MANY = { zone: "", rowFrom: "", rowTo: "", slotFrom: "1", slotTo: "10", kind: "storage" as SlotKind, capacity: "1" };

/** A whole number from 1 to 500, or null. */
function roomOf(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : null;
}
const numOrNull = (t: string) => (t.trim() === "" ? null : Number(t));

function KindPicker({ id, value, onChange }: { id: string; value: SlotKind; onChange: (k: SlotKind) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SlotKind)}>
      <SelectTrigger id={id}><SelectValue /></SelectTrigger>
      <SelectContent>
        {KINDS.map((k) => <SelectItem key={k} value={k}>{SLOT_KIND_LABEL[k]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * The lot's slots: the places a car can be parked, each with a QR label. The
 * car lot's admin and the owner add and change them (the database allows only
 * them); the rest of the staff see the list and can reprint a label.
 */
const CarSlots = () => {
  const { isAdmin } = useAuth();
  const canManage = isAdmin();
  const { yardId, isCarLot } = useYardKind();
  const { nameOf } = useYards();
  const { toast } = useToast();
  const [slots, setSlots] = useState<LotSlot[] | null>(null);
  const [occupancy, setOccupancy] = useState<Map<string, number>>(new Map());
  const [showUnused, setShowUnused] = useState(false);
  const [adding, setAdding] = useState<"one" | "many" | null>(null);
  const [one, setOne] = useState(EMPTY_ONE);
  const [many, setMany] = useState(EMPTY_MANY);
  const [editing, setEditing] = useState<LotSlot | null>(null);
  const [editForm, setEditForm] = useState({ kind: "storage" as SlotKind, capacity: "1", active: true });
  const [labelSize, setLabelSize] = useState<LabelSize>("large");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!yardId) return;
    try {
      const [s, cars] = await Promise.all([loadLotSlots(yardId), loadOpenCars(yardId)]);
      setSlots(s);
      setOccupancy(carsPerSlot(cars));
    } catch (e) {
      toast({ title: "Slots not loaded", description: slotErrorMessage({ message: e instanceof Error ? e.message : String(e) }), variant: "destructive" });
      setSlots((s) => s ?? []);
    }
  }, [yardId, toast]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (slots ?? []).filter((s) => showUnused || s.active), [slots, showUnused]);
  const zones = useMemo(() => groupByZone(shown), [shown]);
  const active = (slots ?? []).filter((s) => s.active);
  const places = active.reduce((n, s) => n + s.capacity, 0);
  const parked = active.reduce((n, s) => n + (occupancy.get(s.id) ?? 0), 0);
  const unusedCount = (slots ?? []).length - active.length;

  // ── adding ──
  const taken = useMemo(() => {
    const codes = new Set<string>();
    for (const s of slots ?? []) { codes.add(s.code); const k = spotKey(s.code); if (k) codes.add(k); }
    return codes;
  }, [slots]);
  const isTaken = useCallback((zone: string, row: string | null, slot: string | null) => {
    const code = slotCode(zone, row, slot);
    return taken.has(code) || taken.has(spotKey(code) ?? "");
  }, [taken]);

  const manyPlan = useMemo(() => {
    if (adding !== "many") return null;
    const r = slotsInRange({
      zone: many.zone, rowFrom: numOrNull(many.rowFrom), rowTo: numOrNull(many.rowTo),
      slotFrom: Number(many.slotFrom), slotTo: Number(many.slotTo),
    });
    if (typeof r === "string") return { problem: r, fresh: [], skipped: 0 };
    const fresh = r.filter((x) => !isTaken(x.zone, x.row_label, x.slot));
    return { problem: null, fresh, skipped: r.length - fresh.length };
  }, [adding, many, isTaken]);

  const insert = async (rows: { zone: string; row_label: string | null; slot: string | null }[], kind: SlotKind, capacity: number) => {
    if (!yardId) return false;
    setBusy(true);
    const { error } = await supabase.from("lot_locations").insert(rows.map((r) => ({ yard_id: yardId, ...r, kind, capacity })));
    setBusy(false);
    if (error) { toast({ title: "Not added", description: slotErrorMessage(error), variant: "destructive" }); return false; }
    return true;
  };

  const addOne = async () => {
    const problem = slotNameProblem(one.zone, one.row, one.slot);
    const capacity = roomOf(one.capacity);
    if (problem) { toast({ title: "Check the name", description: problem, variant: "destructive" }); return; }
    if (!capacity) { toast({ title: "Check the room", description: "Room is how many cars fit: 1 to 500.", variant: "destructive" }); return; }
    if (isTaken(one.zone, one.row || null, one.slot || null)) {
      toast({ title: "Already there", description: `Slot ${slotCode(one.zone, one.row, one.slot)} already exists.`, variant: "destructive" }); return;
    }
    if (await insert([{ zone: one.zone.trim(), row_label: one.row.trim() || null, slot: one.slot.trim() || null }], one.kind, capacity)) {
      toast({ title: "Slot added", description: slotCode(one.zone, one.row, one.slot) });
      setOne({ ...EMPTY_ONE, zone: one.zone, row: one.row, kind: one.kind, capacity: one.capacity });
      void load();
    }
  };

  const addMany = async () => {
    const capacity = roomOf(many.capacity);
    if (!manyPlan || manyPlan.problem || manyPlan.fresh.length === 0) return;
    if (!capacity) { toast({ title: "Check the room", description: "Room is how many cars fit: 1 to 500.", variant: "destructive" }); return; }
    if (await insert(manyPlan.fresh, many.kind, capacity)) {
      toast({ title: `${manyPlan.fresh.length} slots added`, description: manyPlan.skipped ? `${manyPlan.skipped} already existed and were left as they were.` : undefined });
      setAdding(null);
      setMany(EMPTY_MANY);
      void load();
    }
  };

  // ── changing ──
  const openEdit = (s: LotSlot) => { setEditing(s); setEditForm({ kind: s.kind, capacity: String(s.capacity), active: s.active }); };
  const saveEdit = async () => {
    if (!editing) return;
    const capacity = roomOf(editForm.capacity);
    if (!capacity) { toast({ title: "Check the room", description: "Room is how many cars fit: 1 to 500.", variant: "destructive" }); return; }
    setBusy(true);
    const { error } = await supabase.from("lot_locations")
      .update({ kind: editForm.kind, capacity, active: editForm.active }).eq("id", editing.id);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: slotErrorMessage(error), variant: "destructive" }); return; }
    toast({ title: "Slot saved", description: editing.code });
    setEditing(null);
    void load();
  };

  // ── labels ──
  const print = (list: LotSlot[]) => {
    const win = openPrintWindow("Slot labels"); // straight from the click
    if (!win) { toast({ title: "Allow pop-ups to print", description: "Your browser blocked the label window.", variant: "destructive" }); return; }
    printSlotLabels(win, list, labelSize, nameOf(yardId)).catch((e) => {
      win.close();
      toast({ title: "Labels not printed", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    });
  };

  if (!isCarLot) return <div className="p-8 text-muted-foreground">Select a car-lot yard (top right) to see its slots.</div>;

  const inEdit = editing ? occupancy.get(editing.id) ?? 0 : 0;

  return (
    <div className="p-3 sm:p-6 space-y-4 animate-in fade-in-0 duration-300">
      <PageHeader
        icon={Grid3x3}
        title="Slots"
        subtitle={slots ? `${active.length} slots in use · ${places} places · ${parked} cars parked in slots` : "Loading…"}
      />

      {/* below the title, not beside it: two buttons there squeeze the title on a phone */}
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <>
            <Button onClick={() => { setMany(EMPTY_MANY); setAdding("many"); }}><Plus className="h-4 w-4 mr-1" /> Add many</Button>
            <Button variant="outline" onClick={() => { setOne(EMPTY_ONE); setAdding("one"); }}><Plus className="h-4 w-4 mr-1" /> Add a slot</Button>
          </>
        )}
        <Button variant="ghost" asChild><Link to="/cars/map"><MapIcon className="h-4 w-4 mr-1" /> Lot map</Link></Button>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="label-size">Labels</Label>
            <Select value={labelSize} onValueChange={(v) => setLabelSize(v as LabelSize)}>
              <SelectTrigger id="label-size" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="large">Large, 1 per A4</SelectItem>
                <SelectItem value="small">Stickers, 8 per A4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => print(groupByZone(active).flatMap(([, list]) => list))} disabled={active.length === 0}>
            <Printer className="h-4 w-4 mr-1" /> Print all labels ({active.length})
          </Button>
          {unusedCount > 0 && (
            <div className="flex items-center gap-2 sm:ml-auto">
              <Switch id="show-unused" checked={showUnused} onCheckedChange={setShowUnused} />
              <Label htmlFor="show-unused">Show slots not in use ({unusedCount})</Label>
            </div>
          )}
        </CardContent>
      </Card>

      {slots === null ? (
        <Skeleton className="h-48 w-full" />
      ) : slots.length === 0 ? (
        <Card>
          <CardContent className="p-6 space-y-2">
            <p className="font-medium">No slots yet.</p>
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "Add the lot's slots, for example zone A, rows 1 to 5, slots 1 to 20, then print their labels and put them up. Until then, staff type each car's spot."
                : "The car lot's admin adds the slots. Until then, type each car's spot."}
            </p>
          </CardContent>
        </Card>
      ) : (
        zones.map(([zone, list]) => (
          <Card key={zone}>
            <CardHeader className="p-3 sm:p-4 pb-0 sm:pb-0 flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Zone {zone} <span className="text-muted-foreground font-normal text-sm">· {list.length} {list.length === 1 ? "slot" : "slots"}</span></CardTitle>
              <Button size="sm" variant="outline" onClick={() => print(list.filter((s) => s.active))} disabled={!list.some((s) => s.active)}>
                <Printer className="h-4 w-4 mr-1" /> Labels
              </Button>
            </CardHeader>
            <CardContent className="p-0 sm:p-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slot</TableHead>
                    <TableHead className="hidden sm:table-cell">Kind</TableHead>
                    <TableHead className="text-right">Cars / room</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((s) => {
                    const n = occupancy.get(s.id) ?? 0;
                    return (
                      <TableRow key={s.id} className={s.active ? undefined : "opacity-60"}>
                        <TableCell className="font-semibold">
                          {s.code}
                          {!s.active && <Badge variant="outline" className="ml-2">Not in use</Badge>}
                          <span className="block sm:hidden text-xs font-normal text-muted-foreground">{SLOT_KIND_LABEL[s.kind]}</span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{SLOT_KIND_LABEL[s.kind]}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {n} / {s.capacity}{n >= s.capacity && s.active && <span className="text-muted-foreground"> · full</span>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => print([s])} disabled={!s.active} aria-label={`Print the label of ${s.code}`}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          {canManage && (
                            <Button size="sm" variant="ghost" onClick={() => openEdit(s)} aria-label={`Change ${s.code}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      {/* add one */}
      <Dialog open={adding === "one"} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a slot</DialogTitle>
            <DialogDescription>Letters and digits only. Row and slot are optional: "RECEIVING" alone is a slot too.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label htmlFor="one-zone">Zone</Label>
              <Input id="one-zone" value={one.zone} onChange={(e) => setOne({ ...one, zone: e.target.value })} placeholder="A" autoComplete="off" /></div>
            <div className="space-y-1"><Label htmlFor="one-row">Row</Label>
              <Input id="one-row" value={one.row} onChange={(e) => setOne({ ...one, row: e.target.value })} placeholder="1" autoComplete="off" /></div>
            <div className="space-y-1"><Label htmlFor="one-slot">Slot</Label>
              <Input id="one-slot" value={one.slot} onChange={(e) => setOne({ ...one, slot: e.target.value })} placeholder="7" autoComplete="off" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="one-kind">Kind</Label>
              <KindPicker id="one-kind" value={one.kind} onChange={(kind) => setOne({ ...one, kind })} /></div>
            <div className="space-y-1"><Label htmlFor="one-room">Room (cars)</Label>
              <Input id="one-room" type="number" min={1} max={500} value={one.capacity} onChange={(e) => setOne({ ...one, capacity: e.target.value })} /></div>
          </div>
          {one.zone.trim() && !slotNameProblem(one.zone, one.row, one.slot) && (
            <p className="text-sm">It will be named <span className="font-semibold">{slotCode(one.zone, one.row, one.slot)}</span>.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(null)}>Close</Button>
            <Button onClick={() => void addOne()} disabled={busy || !one.zone.trim()}>{busy ? "Adding…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* add many */}
      <Dialog open={adding === "many"} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add many slots</DialogTitle>
            <DialogDescription>One zone at a time; up to {MAX_BULK_SLOTS} slots. Leave the rows empty for a zone without rows.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1"><Label htmlFor="many-zone">Zone</Label>
            <Input id="many-zone" value={many.zone} onChange={(e) => setMany({ ...many, zone: e.target.value })} placeholder="A" autoComplete="off" className="w-32" /></div>
          <div className="grid grid-cols-2 gap-3">
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Rows</legend>
              <div className="flex items-center gap-2">
                <Input aria-label="First row" type="number" min={0} value={many.rowFrom} onChange={(e) => setMany({ ...many, rowFrom: e.target.value })} placeholder="1" />
                <span aria-hidden>to</span>
                <Input aria-label="Last row" type="number" min={0} value={many.rowTo} onChange={(e) => setMany({ ...many, rowTo: e.target.value })} placeholder="5" />
              </div>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Slots in each row</legend>
              <div className="flex items-center gap-2">
                <Input aria-label="First slot" type="number" min={0} value={many.slotFrom} onChange={(e) => setMany({ ...many, slotFrom: e.target.value })} />
                <span aria-hidden>to</span>
                <Input aria-label="Last slot" type="number" min={0} value={many.slotTo} onChange={(e) => setMany({ ...many, slotTo: e.target.value })} />
              </div>
            </fieldset>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="many-kind">Kind</Label>
              <KindPicker id="many-kind" value={many.kind} onChange={(kind) => setMany({ ...many, kind })} /></div>
            <div className="space-y-1"><Label htmlFor="many-room">Room in each (cars)</Label>
              <Input id="many-room" type="number" min={1} max={500} value={many.capacity} onChange={(e) => setMany({ ...many, capacity: e.target.value })} /></div>
          </div>
          {manyPlan && many.zone.trim() && (
            <p className="text-sm" role="status">
              {manyPlan.problem
                ? manyPlan.problem
                : manyPlan.fresh.length === 0
                  ? "All of these slots already exist."
                  : <>This adds <span className="font-semibold">{manyPlan.fresh.length}</span> slots, {slotCode(manyPlan.fresh[0].zone, manyPlan.fresh[0].row_label, manyPlan.fresh[0].slot)} to {slotCode(manyPlan.fresh[manyPlan.fresh.length - 1].zone, manyPlan.fresh[manyPlan.fresh.length - 1].row_label, manyPlan.fresh[manyPlan.fresh.length - 1].slot)}{manyPlan.skipped ? `; ${manyPlan.skipped} already exist and are skipped` : ""}.</>}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(null)}>Cancel</Button>
            <Button onClick={() => void addMany()} disabled={busy || !manyPlan || !!manyPlan.problem || manyPlan.fresh.length === 0}>
              {busy ? "Adding…" : `Add ${manyPlan && !manyPlan.problem ? manyPlan.fresh.length : ""} slots`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* change one */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Slot {editing?.code}</DialogTitle>
            <DialogDescription>
              {inEdit > 0 ? `${inEdit} car${inEdit === 1 ? " is" : "s are"} parked here now.` : "No car is parked here now."}
              {" "}To rename a slot, add the new one and take this one out of use.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="edit-kind">Kind</Label>
              <KindPicker id="edit-kind" value={editForm.kind} onChange={(kind) => setEditForm({ ...editForm, kind })} /></div>
            <div className="space-y-1"><Label htmlFor="edit-room">Room (cars)</Label>
              <Input id="edit-room" type="number" min={Math.max(1, inEdit)} max={500} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="edit-active" checked={editForm.active} disabled={inEdit > 0 && editForm.active}
              onCheckedChange={(active) => setEditForm({ ...editForm, active })} />
            <Label htmlFor="edit-active">In use</Label>
          </div>
          {inEdit > 0 && <p className="text-xs text-muted-foreground">A slot with cars in it stays in use and keeps room for them.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void saveEdit()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CarSlots;
