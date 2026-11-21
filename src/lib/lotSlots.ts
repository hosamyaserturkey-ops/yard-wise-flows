/**
 * The car lot's slots: their names, what their QR labels and car tags carry, how
 * a scan or a typed spot is read, and the lot-map grid. The database applies the
 * same naming rules (supabase/migrations/20261121180000_car_lot_slots.sql:
 * private.lot_slot_part / lot_slot_code / lot_spot_key); the tests on both sides
 * share their examples, so the screen never promises a name the database refuses.
 */
import { normalizeVin, validateVin } from "@/lib/vin";

export type SlotKind = "receiving" | "storage" | "exit";

export const SLOT_KIND_LABEL: Record<SlotKind, string> = {
  receiving: "Receiving",
  storage: "Storage",
  exit: "Exit",
};

export interface LotSlot {
  id: string;
  zone: string;
  row_label: string | null;
  slot: string | null;
  code: string;
  kind: SlotKind;
  capacity: number;
  active: boolean;
}

/** One part of a slot name, as typed: letters and digits only, 1 to 10 of them. */
export const SLOT_PART_PATTERN = /^[A-Za-z0-9]{1,10}$/;

/** A number without leading zeros and at least two digits: "7" → "07", "112" → "112", "0" → "00". */
function twoDigits(digits: string): string {
  const n = digits.replace(/^0+/, "");
  return n.length >= 2 ? n : n.padStart(2, "0");
}

/** As private.lot_slot_part: trimmed, upper case; a number gets at least two digits when asked. */
export function slotPart(part: string | null | undefined, pad: boolean): string | null {
  const t = (part ?? "").trim();
  if (!t) return null;
  if (pad && /^\d+$/.test(t)) return twoDigits(t);
  return t.toUpperCase();
}

/** As private.lot_slot_code: the printed name, "B-03-07", "B-12" or "RECEIVING". */
export function slotCode(zone: string, row?: string | null, slot?: string | null): string {
  return [slotPart(zone, false), slotPart(row, true), slotPart(slot, true)].filter(Boolean).join("-");
}

/**
 * As private.lot_spot_key: what someone typed for a place, made comparable.
 * Letters and numbers are split apart, numbers get two digits, parts are joined
 * with "-": "b 3 7", "B3-7" and "b-03-07" all give "B-03-07".
 */
export function spotKey(text: string | null | undefined): string | null {
  const spaced = (text ?? "").toUpperCase()
    .replace(/([A-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Z])/g, "$1 $2");
  const parts = spaced.split(/[^A-Z0-9]+/).filter(Boolean).map((t) => (/^\d+$/.test(t) ? twoDigits(t) : t));
  return parts.length ? parts.join("-") : null;
}

/** Why a slot name can't be saved, or null when it can. */
export function slotNameProblem(zone: string, row?: string, slot?: string): string | null {
  if (!zone.trim()) return "Give the slot a zone, for example A.";
  for (const [label, value] of [["Zone", zone], ["Row", row], ["Slot", slot]] as const) {
    if (value?.trim() && !SLOT_PART_PATTERN.test(value.trim())) {
      return `${label} may only use letters and digits (at most 10), no spaces or signs.`;
    }
  }
  return null;
}

/** Most slots one "add many" may create at once. */
export const MAX_BULK_SLOTS = 500;

export interface SlotRange {
  zone: string;
  /** Row numbers, e.g. 1 to 5; leave both empty for slots without rows. */
  rowFrom?: number | null;
  rowTo?: number | null;
  slotFrom: number;
  slotTo: number;
}

/** Every slot of a range, row by row, or a message saying why the range can't be made. */
export function slotsInRange(r: SlotRange): { zone: string; row_label: string | null; slot: string }[] | string {
  const zoneProblem = slotNameProblem(r.zone);
  if (zoneProblem) return zoneProblem;
  const whole = (n: number | null | undefined) => n != null && Number.isInteger(n) && n >= 0 && n <= 9999;
  if (!whole(r.slotFrom) || !whole(r.slotTo) || r.slotFrom > r.slotTo) return "Slot numbers go from a lower to a higher whole number.";
  const hasRows = r.rowFrom != null || r.rowTo != null;
  if (hasRows && (!whole(r.rowFrom) || !whole(r.rowTo) || (r.rowFrom as number) > (r.rowTo as number))) {
    return "Row numbers go from a lower to a higher whole number.";
  }
  const rows = hasRows ? range(r.rowFrom as number, r.rowTo as number).map(String) : [null];
  const slots = range(r.slotFrom, r.slotTo).map(String);
  if (rows.length * slots.length > MAX_BULK_SLOTS) return `That is ${rows.length * slots.length} slots; add at most ${MAX_BULK_SLOTS} at a time.`;
  return rows.flatMap((row) => slots.map((slot) => ({ zone: r.zone.trim(), row_label: row, slot })));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// ── QR labels and car tags ──────────────────────────────────────────

const SLOT_PREFIX = "EVL-LOC:";
const CAR_PREFIX = "EVL-CAR:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a slot's printed label carries: its id, so renaming a slot never breaks a label. */
export const slotQrText = (slotId: string): string => `${SLOT_PREFIX}${slotId}`;

/** What a car tag carries: the VIN, so a tag reads exactly like the car's own VIN barcode. */
export const carTagText = (vin: string): string => `${CAR_PREFIX}${normalizeVin(vin)}`;

export type ScanResult =
  | { kind: "slot"; slotId: string }
  | { kind: "car"; vin: string }
  | { kind: "unknown"; text: string };

/**
 * What a scanned or typed code is: one of our slot labels, a car (our car tag,
 * or a VIN barcode on the car itself), or something else. US-style VIN
 * barcodes often carry a leading "I" (imported); it is dropped.
 */
export function readScan(raw: string): ScanResult {
  const text = raw.trim();
  if (text.toUpperCase().startsWith(SLOT_PREFIX)) {
    const id = text.slice(SLOT_PREFIX.length).trim();
    if (UUID.test(id)) return { kind: "slot", slotId: id.toLowerCase() };
  }
  const maybeVin = text.toUpperCase().startsWith(CAR_PREFIX) ? text.slice(CAR_PREFIX.length) : text;
  let vin = normalizeVin(maybeVin);
  if (vin.length === 18 && vin.startsWith("I") && !validateVin(vin.slice(1))) vin = vin.slice(1);
  if (!validateVin(vin)) return { kind: "car", vin };
  return { kind: "unknown", text };
}

// ── the lot map ─────────────────────────────────────────────────────

export interface MapCar {
  visitId: string;
  vin: string;
  manufacturerCode: string;
  locationId: string | null;
  zone: string | null;
  slot: string | null;
  status: "in-lot" | "on-hold";
  days: number;
}

export type TileState = "empty" | "partly" | "full" | "over";

export interface MapTile {
  slot: LotSlot;
  cars: MapCar[];
  state: TileState;
}

export interface MapZone {
  zone: string;
  rows: { row: string | null; tiles: MapTile[] }[];
  used: number;
  capacity: number;
}

const byNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const KIND_RANK: Record<SlotKind, number> = { receiving: 0, storage: 1, exit: 2 };

/**
 * Zones in the order cars pass through the lot: a zone with a receiving slot
 * first, a zone of exit slots last, the rest by name ("A" before "B", "2" before "10").
 */
export function zoneOrder(slots: Pick<LotSlot, "zone" | "kind">[]): (a: string, b: string) => number {
  const rank = new Map<string, number>();
  for (const s of slots) rank.set(s.zone, Math.min(rank.get(s.zone) ?? KIND_RANK.exit, KIND_RANK[s.kind] ?? KIND_RANK.storage));
  return (a, b) => (rank.get(a) ?? KIND_RANK.storage) - (rank.get(b) ?? KIND_RANK.storage) || byNatural(a, b);
}

/** The slots by zone (zones in zoneOrder), each zone's slots by code. */
export function groupByZone(slots: LotSlot[]): [string, LotSlot[]][] {
  const groups = new Map<string, LotSlot[]>();
  for (const s of [...slots].sort((a, b) => byNatural(a.code, b.code))) groups.set(s.zone, [...(groups.get(s.zone) ?? []), s]);
  const order = zoneOrder(slots);
  return [...groups].sort(([a], [b]) => order(a, b));
}

export function tileState(cars: number, capacity: number): TileState {
  if (cars === 0) return "empty";
  if (cars > capacity) return "over";
  return cars === capacity ? "full" : "partly";
}

/**
 * The lot as zones → rows → slots, each slot with the cars in it, plus the cars
 * in the lot that have no listed slot (a typed spot, or none at all). Slots out
 * of use are left off the map unless a car is still in one.
 */
export function buildLotMap(slots: LotSlot[], cars: MapCar[]): { zones: MapZone[]; unplaced: MapCar[] } {
  const inSlot = new Map<string, MapCar[]>();
  const unplaced: MapCar[] = [];
  const known = new Set(slots.map((s) => s.id));
  for (const car of cars) {
    if (car.locationId && known.has(car.locationId)) inSlot.set(car.locationId, [...(inSlot.get(car.locationId) ?? []), car]);
    else unplaced.push(car);
  }
  const zones = new Map<string, Map<string, MapTile[]>>();
  for (const slot of slots) {
    const here = inSlot.get(slot.id) ?? [];
    if (!slot.active && here.length === 0) continue;
    const rows = zones.get(slot.zone) ?? new Map<string, MapTile[]>();
    const rowKey = slot.row_label ?? "";
    rows.set(rowKey, [...(rows.get(rowKey) ?? []), { slot, cars: here, state: tileState(here.length, slot.capacity) }]);
    zones.set(slot.zone, rows);
  }
  const order = zoneOrder(slots);
  const mapZones = [...zones].sort(([a], [b]) => order(a, b)).map(([zone, rows]) => {
    const sortedRows = [...rows].sort(([a], [b]) => byNatural(a, b)).map(([row, tiles]) => ({
      row: row || null,
      tiles: tiles.sort((a, b) => byNatural(a.slot.slot ?? "", b.slot.slot ?? "") || byNatural(a.slot.code, b.slot.code)),
    }));
    const tiles = sortedRows.flatMap((r) => r.tiles);
    return {
      zone,
      rows: sortedRows,
      used: tiles.reduce((n, t) => n + t.cars.length, 0),
      capacity: tiles.reduce((n, t) => n + t.slot.capacity, 0),
    };
  });
  return { zones: mapZones, unplaced: unplaced.sort((a, b) => b.days - a.days) };
}

/** Where a car is put at registration: a listed slot, a typed spot, or none yet. */
export type SpotChoice =
  | { kind: "slot"; slotId: string }
  | { kind: "typed"; zone: string; slot: string }
  | { kind: "none" };

/**
 * The place Register suggests: the first receiving slot with room. A lot
 * without slots types the spot as before; with slots but no free receiving
 * one, nothing is chosen for the user.
 */
export function defaultSpot(slots: LotSlot[], occupancy: Map<string, number>): SpotChoice {
  if (!slots.some((s) => s.active)) return { kind: "typed", zone: "", slot: "" };
  const receiving = slots
    .filter((s) => s.active && s.kind === "receiving" && freePlaces(s, occupancy.get(s.id) ?? 0) > 0)
    .sort((a, b) => byNatural(a.code, b.code))[0];
  return receiving ? { kind: "slot", slotId: receiving.id } : { kind: "none" };
}

/** Places in each zone's slots in use, by zone: for "12 of 40" on the Overview. */
export function placesByZone(slots: Pick<LotSlot, "zone" | "capacity" | "active">[]): Map<string, number> {
  const places = new Map<string, number>();
  for (const s of slots) if (s.active) places.set(s.zone, (places.get(s.zone) ?? 0) + s.capacity);
  return places;
}

/**
 * Where a car is, as people read it: a listed slot by its code ("A-01-01", the
 * name on its label), a typed spot as "zone / slot", or "" for none. A slotted
 * car's zone and slot text are its slot's parts, so they join to the code.
 */
export function placeLabel(p: { inSlot: boolean; zone: string | null; slot: string | null }): string {
  return [p.zone, p.slot].filter(Boolean).join(p.inSlot ? "-" : " / ");
}

/** Free places left in a slot (never negative). */
export const freePlaces = (slot: Pick<LotSlot, "capacity">, carsInIt: number): number => Math.max(0, slot.capacity - carsInIt);

// ── messages ────────────────────────────────────────────────────────

/** Plain language for the database's answers to a move or a slot change. */
export function slotErrorMessage(error: { code?: string; message: string }): string {
  const m = error.message;
  const full = /slot (\S+) is full: it holds (.+)$/i.exec(m);
  if (full) return `Slot ${full[1]} is full. It holds ${full[2]}.`;
  if (/belongs to another lot/i.test(m)) return "That slot belongs to another car lot.";
  if (/is not in use/i.test(m)) return "That slot is not in use any more.";
  if (/released car cannot be moved/i.test(m)) return "This car has already left the lot.";
  if (/only the car lot's admin or the owner can put a car in a full slot/i.test(m)) return "Only the car lot's admin can put a car in a full slot.";
  if (/choose a slot or type a spot/i.test(m)) return "Choose a slot or type a spot.";
  if (/use Move/i.test(m)) return "This car is in a listed slot. Use Move to change its place.";
  if (/move the cars out before renaming/i.test(m)) return "Cars are parked in this slot. Move them out before renaming it.";
  if (/move the cars out before taking it out of use/i.test(m)) return "Cars are parked in this slot. Move them out before taking it out of use.";
  if (/room cannot be less/i.test(m)) return "Cars are parked in this slot: it needs at least that much room.";
  if (/slots belong to a car-lot yard/i.test(m)) return "Slots can only be added to a car lot.";
  if (/duplicate key/i.test(m)) return "A slot with this name (or one that reads the same) already exists.";
  if (/check constraint/i.test(m)) return "Zone, row and slot may only use letters and digits.";
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return "No signal: nothing was saved. Try again.";
  if (error.code === "42501" || /not allowed|row-level security/i.test(m)) return "You are not allowed to do this.";
  return m;
}

// ── this phone's label, for the history ─────────────────────────────

const DEVICE_KEY = "car-lot-device";

/**
 * A short random label for this phone or PC ("device-7f3a"), kept on the device,
 * so the history can tell which device a move was made on. It is not a person
 * and not a secret; without storage it is made fresh each time.
 */
export function deviceLabel(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): string {
  try {
    const kept = storage?.getItem(DEVICE_KEY);
    if (kept && /^device-[0-9a-f]{4,8}$/.test(kept)) return kept;
  } catch { /* storage refused */ }
  const label = `device-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")}`;
  try { storage?.setItem(DEVICE_KEY, label); } catch { /* storage refused */ }
  return label;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
