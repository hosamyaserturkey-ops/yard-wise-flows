import { useMemo, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScanBox } from "@/components/carlot/ScanBox";
import { freePlaces, readScan, SLOT_KIND_LABEL, spotKey, type LotSlot, type SpotChoice } from "@/lib/lotSlots";

const TYPED = "__typed";
const NONE = "__none";

/**
 * Where a car goes: a listed slot (picked, or scanned from its label), a typed
 * spot, or none yet. A lot without slots gets the two boxes it always had.
 * Full slots can't be picked; the database refuses them anyway.
 */
export function SpotPicker({ slots, occupancy, value, onChange }: {
  slots: LotSlot[];
  occupancy: Map<string, number>;
  value: SpotChoice;
  onChange: (v: SpotChoice) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const active = useMemo(
    () => slots.filter((s) => s.active).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [slots]);
  const zones = useMemo(() => {
    const m = new Map<string, LotSlot[]>();
    for (const s of active) m.set(s.zone, [...(m.get(s.zone) ?? []), s]);
    return [...m];
  }, [active]);

  const typedFields = value.kind === "typed" && (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1"><Label htmlFor="spot-zone">Zone</Label>
        <Input id="spot-zone" value={value.zone} onChange={(e) => onChange({ ...value, zone: e.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor="spot-slot">Slot</Label>
        <Input id="spot-slot" value={value.slot} onChange={(e) => onChange({ ...value, slot: e.target.value })} /></div>
    </div>
  );
  if (active.length === 0) return typedFields || null;

  const typedKey = value.kind === "typed" ? spotKey([value.zone, value.slot].join(" ")) : null;
  const typedMatch = typedKey ? active.find((s) => spotKey(s.code) === typedKey) ?? null : null;
  const selectValue = value.kind === "slot" ? value.slotId : value.kind === "typed" ? TYPED : NONE;

  const onScan = (text: string) => {
    const r = readScan(text);
    const slot = r.kind === "slot" ? active.find((s) => s.id === r.slotId) : undefined;
    if (!slot) { setScanNote(r.kind === "slot" ? "That label is for a slot not in this lot, or not in use." : "That is not a slot label."); return; }
    if (freePlaces(slot, occupancy.get(slot.id) ?? 0) === 0) { setScanNote(`${slot.code} is full. Choose another slot.`); return; }
    setScanNote(null);
    setScanning(false);
    onChange({ kind: "slot", slotId: slot.id });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="spot-pick">Spot</Label>
          <Select value={selectValue} onValueChange={(v) => {
            setScanning(false);
            onChange(v === TYPED ? { kind: "typed", zone: "", slot: "" } : v === NONE ? { kind: "none" } : { kind: "slot", slotId: v });
          }}>
            <SelectTrigger id="spot-pick"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No spot yet</SelectItem>
              <SelectItem value={TYPED}>Other spot (type it)</SelectItem>
              <SelectSeparator />
              {zones.map(([zone, list]) => (
                <SelectGroup key={zone}>
                  <SelectLabel>Zone {zone}</SelectLabel>
                  {list.map((s) => {
                    const free = freePlaces(s, occupancy.get(s.id) ?? 0);
                    return (
                      <SelectItem key={s.id} value={s.id} disabled={free === 0}>
                        {s.code} · {free === 0 ? "full" : `${free} free`}{s.kind !== "storage" ? ` · ${SLOT_KIND_LABEL[s.kind]}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => { setScanNote(null); setScanning((v) => !v); }} aria-pressed={scanning}>
          <ScanLine className="h-4 w-4 mr-1" /> {scanning ? "Stop" : "Scan"}
        </Button>
      </div>
      {scanning && (
        <ScanBox active={scanning} onResult={onScan} hint="Point at the slot's QR label" typePlaceholder="Or type the slot's label code" />
      )}
      {scanNote && <p role="status" className="text-sm text-warning">{scanNote}</p>}
      {typedFields}
      {typedMatch && (
        <p className="text-sm">
          That is slot <span className="font-semibold">{typedMatch.code}</span>
          {freePlaces(typedMatch, occupancy.get(typedMatch.id) ?? 0) === 0 ? ", which is full: choose another place." : "."}
        </p>
      )}
    </div>
  );
}
