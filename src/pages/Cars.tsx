import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useYardKind } from "@/hooks/useYardKind";
import { useToast } from "@/hooks/use-toast";
import { Car, LogOut, PauseCircle, PlayCircle, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/format";
import { normalizeVin, validateVin } from "@/lib/vin";
import {
  VISIT_STATUS_LABEL, allowedActions, daysInLot, daysOverFree, gateInErrorMessage, type VisitStatus,
} from "@/lib/carLot";

interface VisitRow {
  id: string;
  status: VisitStatus;
  gate_in_time: string;
  gate_out_time: string | null;
  lot_zone: string | null;
  lot_slot: string | null;
  free_days: number;
  ticket_number: number;
  vehicles: { id: string; vin: string; model: string | null; model_year: number | null; color: string | null } | null;
  manufacturers: { code: string; name: string } | null;
}
interface MfrOption { id: string; code: string; name: string; }

type Tab = "open" | "out";

const EMPTY_FORM = {
  manufacturer_id: "", vin: "", model: "", model_year: "", color: "",
  lot_zone: "", lot_slot: "", odometer_in: "", key_count: "", driver_name: "", truck_number: "",
};
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
  const { isReadOnlyAdmin } = useAuth();
  const { yardId, isCarLot } = useYardKind();
  const canWrite = !isReadOnlyAdmin();

  const [tab, setTab] = useState<Tab>("open");
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [mfrs, setMfrs] = useState<MfrOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [outFor, setOutFor] = useState<VisitRow | null>(null);
  const [outForm, setOutForm] = useState(EMPTY_OUT);

  const load = useCallback(async () => {
    if (!yardId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from("vehicle_visits")
      .select("id, status, gate_in_time, gate_out_time, lot_zone, lot_slot, free_days, ticket_number, vehicles(id, vin, model, model_year, color), manufacturers(code, name)")
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
      [r.vehicles?.vin, r.vehicles?.model, r.manufacturers?.name, r.manufacturers?.code, r.lot_zone, r.lot_slot, String(r.ticket_number)]
        .some((v) => v?.toUpperCase().includes(q)));
  }, [rows, search]);

  const now = new Date();

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

      const { error: visitErr } = await supabase.from("vehicle_visits").insert({
        vehicle_id: vehicleId,
        lot_zone: textOrNull(form.lot_zone), lot_slot: textOrNull(form.lot_slot),
        odometer_in: intOrNull(form.odometer_in), key_count: intOrNull(form.key_count),
        driver_name: textOrNull(form.driver_name), truck_number: textOrNull(form.truck_number),
      });
      if (visitErr) throw visitErr;

      toast({ title: "Car registered", description: vin });
      setRegisterOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast({ title: "Not registered", description: gateInErrorMessage({ code: err.code, message: err.message ?? "Unknown error" }), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (row: VisitRow, status: VisitStatus) => {
    const { error } = await supabase.from("vehicle_visits").update({ status }).eq("id", row.id);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: status === "on-hold" ? "Car put on hold" : "Hold released" });
    load();
  };

  const gateOut = async () => {
    if (!outFor) return;
    setBusy(true);
    // The database sets the gate-out time and who released the car.
    const { error } = await supabase.from("vehicle_visits").update({
      status: "out",
      gate_out_driver_name: textOrNull(outForm.driver),
      gate_out_truck_number: textOrNull(outForm.truck),
      odometer_out: intOrNull(outForm.odometer),
    }).eq("id", outFor.id);
    setBusy(false);
    if (error) { toast({ title: "Not released", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Car released", description: outFor.vehicles?.vin });
    setOutFor(null);
    setOutForm(EMPTY_OUT);
    load();
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
          <Button onClick={() => { setForm(EMPTY_FORM); setRegisterOpen(true); }}>
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
            <Table>
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
                  {canWrite && tab === "open" && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => {
                  const days = daysInLot(r.gate_in_time, now, r.gate_out_time);
                  const over = daysOverFree(days, r.free_days);
                  const can = allowedActions(r.status);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.ticket_number}</TableCell>
                      <TableCell className="font-mono text-xs">{r.vehicles?.vin}</TableCell>
                      <TableCell>{r.manufacturers?.name ?? "—"}</TableCell>
                      <TableCell>{[r.vehicles?.model, r.vehicles?.model_year, r.vehicles?.color].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell>{[r.lot_zone, r.lot_slot].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell>{formatDate(r.gate_in_time)}</TableCell>
                      <TableCell>
                        {days}
                        {over > 0 && r.status !== "out" && <span className="ml-1 text-xs text-warning">(+{over} over free)</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "on-hold" ? "outline" : "secondary"}>{VISIT_STATUS_LABEL[r.status]}</Badge>
                      </TableCell>
                      {canWrite && tab === "open" && (
                        <TableCell className="text-right space-x-2 whitespace-nowrap">
                          {can.hold && (
                            <Button size="sm" variant="outline" onClick={() => setStatus(r, "on-hold")}>
                              <PauseCircle className="h-3.5 w-3.5 mr-1" /> Hold
                            </Button>
                          )}
                          {can.release && (
                            <Button size="sm" variant="outline" onClick={() => setStatus(r, "in-lot")}>
                              <PlayCircle className="h-3.5 w-3.5 mr-1" /> Release hold
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={!can.gateOut}
                            title={can.gateOut ? undefined : "Release the hold before gate-out"}
                            onClick={() => { setOutFor(r); setOutForm(EMPTY_OUT); }}>
                            <LogOut className="h-3.5 w-3.5 mr-1" /> Gate out
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canWrite && tab === "open" ? 9 : 8} className="text-center text-muted-foreground">
                      {search ? "No car matches your search" : tab === "open" ? "No cars in the lot" : "No released cars yet"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="sm:max-w-lg">
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
            <div className="space-y-1"><Label>Zone</Label><Input value={form.lot_zone} onChange={set("lot_zone")} /></div>
            <div className="space-y-1"><Label>Slot</Label><Input value={form.lot_slot} onChange={set("lot_slot")} /></div>
            <div className="space-y-1"><Label>Keys</Label><Input inputMode="numeric" value={form.key_count} onChange={set("key_count")} /></div>
            <div className="space-y-1"><Label>Driver</Label><Input value={form.driver_name} onChange={set("driver_name")} /></div>
            <div className="col-span-2 space-y-1"><Label>Truck number</Label><Input value={form.truck_number} onChange={set("truck_number")} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>Cancel</Button>
            <Button onClick={register} disabled={busy}>{busy ? "Registering…" : "Register car"}</Button>
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
