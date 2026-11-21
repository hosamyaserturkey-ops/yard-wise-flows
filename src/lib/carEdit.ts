import { normalizeVin, validateVin } from "@/lib/vin";

/** What the admin can correct on a car that is still in the lot. All values are text boxes. */
export interface CarEditForm {
  vin: string;
  model: string;
  model_year: string;
  color: string;
  lot_zone: string;
  lot_slot: string;
  odometer_in: string;
  key_count: string;
  driver_name: string;
  truck_number: string;
  free_days: string;
}

/** The parts of a visit row the form starts from. */
export interface CarEditSource {
  vin: string;
  model: string | null;
  model_year: number | null;
  color: string | null;
  lot_zone: string | null;
  lot_slot: string | null;
  odometer_in: number | null;
  key_count: number | null;
  driver_name: string | null;
  truck_number: string | null;
  free_days: number;
}

const s = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

export function formFromCar(c: CarEditSource): CarEditForm {
  return {
    vin: c.vin, model: s(c.model), model_year: s(c.model_year), color: s(c.color),
    lot_zone: s(c.lot_zone), lot_slot: s(c.lot_slot), odometer_in: s(c.odometer_in), key_count: s(c.key_count),
    driver_name: s(c.driver_name), truck_number: s(c.truck_number), free_days: s(c.free_days),
  };
}

const text = (v: string): string | null => v.trim() || null;
/** null when empty; undefined when it is not a whole number. */
const whole = (v: string, max: number): number | null | undefined => {
  const t = v.trim();
  if (!t) return null;
  return /^\d+$/.test(t) && Number(t) <= max ? Number(t) : undefined;
};

/** Returns a message saying what is wrong, or null when the form can be saved. */
export function validateCarEdit(f: CarEditForm): string | null {
  const vinProblem = validateVin(f.vin);
  if (vinProblem) return vinProblem;
  if (f.model_year.trim()) {
    const y = whole(f.model_year, 9999);
    if (y === undefined || y === null || y < 1980 || y > 2100) return "Model year must be between 1980 and 2100.";
  }
  if (whole(f.odometer_in, 9_999_999) === undefined) return "Odometer must be a whole number of kilometres.";
  if (whole(f.key_count, 99) === undefined) return "Keys must be a whole number from 0 to 99.";
  const free = whole(f.free_days, 365);
  if (free === undefined || free === null) return "Free days must be a whole number from 0 to 365.";
  return null;
}

export interface CarEditChanges {
  vehicle: { vin?: string; model?: string | null; model_year?: number | null; color?: string | null };
  visit: {
    lot_zone?: string | null; lot_slot?: string | null; odometer_in?: number | null; key_count?: number | null;
    driver_name?: string | null; truck_number?: string | null; free_days?: number;
  };
}

/** Only what actually changed, so an untouched field is never rewritten. Assumes validateCarEdit passed. */
export function carEditChanges(original: CarEditForm, next: CarEditForm): CarEditChanges {
  const out: CarEditChanges = { vehicle: {}, visit: {} };
  if (normalizeVin(next.vin) !== normalizeVin(original.vin)) out.vehicle.vin = normalizeVin(next.vin);
  if (text(next.model) !== text(original.model)) out.vehicle.model = text(next.model);
  if (whole(next.model_year, 9999) !== whole(original.model_year, 9999)) out.vehicle.model_year = whole(next.model_year, 9999) ?? null;
  if (text(next.color) !== text(original.color)) out.vehicle.color = text(next.color);
  if (text(next.lot_zone) !== text(original.lot_zone)) out.visit.lot_zone = text(next.lot_zone);
  if (text(next.lot_slot) !== text(original.lot_slot)) out.visit.lot_slot = text(next.lot_slot);
  if (whole(next.odometer_in, 9_999_999) !== whole(original.odometer_in, 9_999_999)) out.visit.odometer_in = whole(next.odometer_in, 9_999_999) ?? null;
  if (whole(next.key_count, 99) !== whole(original.key_count, 99)) out.visit.key_count = whole(next.key_count, 99) ?? null;
  if (text(next.driver_name) !== text(original.driver_name)) out.visit.driver_name = text(next.driver_name);
  if (text(next.truck_number) !== text(original.truck_number)) out.visit.truck_number = text(next.truck_number);
  if (whole(next.free_days, 365) !== whole(original.free_days, 365)) out.visit.free_days = whole(next.free_days, 365) ?? 0;
  return out;
}

export const hasChanges = (c: CarEditChanges): boolean => Object.keys(c.vehicle).length + Object.keys(c.visit).length > 0;
