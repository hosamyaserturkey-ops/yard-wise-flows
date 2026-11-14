/**
 * The car-lot inspection: which photos are taken, what must be there before an
 * inspection can be closed, and the small fixed lists on the form. The
 * database enforces the hard rules (closed inspections never change, photos
 * are never edited or deleted); this decides what the screen asks for.
 */

export type InspectionPhase = "gate_in" | "gate_out";

export const PHASE_LABEL: Record<InspectionPhase, string> = {
  gate_in: "Arrival (gate in)",
  gate_out: "Departure (gate out)",
};

export function isPhase(value: string | undefined): value is InspectionPhase {
  return value === "gate_in" || value === "gate_out";
}

export interface Shot { id: string; label: string; hint: string; required: boolean; }

/** The standard walk-round, in the order a person walks round the car. */
export const SHOTS: Shot[] = [
  { id: "front",          label: "Front",            hint: "Straight on, whole car in the frame", required: true },
  { id: "front_right",    label: "Front right",      hint: "From the front-right corner",         required: true },
  { id: "right",          label: "Right side",       hint: "The whole right side",                required: true },
  { id: "rear_right",     label: "Rear right",       hint: "From the rear-right corner",          required: true },
  { id: "rear",           label: "Rear",             hint: "Straight on, whole car in the frame", required: true },
  { id: "rear_left",      label: "Rear left",        hint: "From the rear-left corner",           required: true },
  { id: "left",           label: "Left side",        hint: "The whole left side",                 required: true },
  { id: "front_left",     label: "Front left",       hint: "From the front-left corner",          required: true },
  { id: "dashboard",      label: "Dashboard",        hint: "Odometer and warning lights",         required: true },
  { id: "interior",       label: "Interior",        hint: "Seats and floor, from the door",      required: true },
  { id: "roof",           label: "Roof",             hint: "From above if you can",               required: false },
  { id: "keys",           label: "Keys",             hint: "All keys that came with the car",     required: false },
];

/** Any number of these, each with a note saying what and where. */
export const DAMAGE_ANGLE = "damage";

export const REQUIRED_SHOTS = SHOTS.filter((s) => s.required);

export const FUEL_LEVELS = [
  { id: "empty", label: "Empty" },
  { id: "quarter", label: "¼" },
  { id: "half", label: "½" },
  { id: "three_quarter", label: "¾" },
  { id: "full", label: "Full" },
] as const;

export interface PhotoRef { id: string; angle: string; created_at: string; note?: string | null; }

/** The newest photo per angle: a retake adds a photo, it never replaces one. */
export function latestByAngle<T extends PhotoRef>(photos: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const p of photos) {
    if (p.angle === DAMAGE_ANGLE) continue;
    const current = latest.get(p.angle);
    if (!current || p.created_at > current.created_at) latest.set(p.angle, p);
  }
  return latest;
}

export function damagePhotos<T extends PhotoRef>(photos: T[]): T[] {
  return photos.filter((p) => p.angle === DAMAGE_ANGLE).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** The required shots that have no photo yet. */
export function missingShots(photos: PhotoRef[]): Shot[] {
  const have = latestByAngle(photos);
  return REQUIRED_SHOTS.filter((s) => !have.has(s.id));
}

/** Why the inspection cannot be closed yet, or null when it can. */
export function closeBlocker(photos: PhotoRef[], busy = false): string | null {
  if (busy) return "A photo is still uploading.";
  const missing = missingShots(photos);
  if (missing.length === 0) return null;
  const names = missing.map((s) => s.label);
  return `Still needed: ${names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")}.`;
}

/** Whole number from a text box, or null if empty; undefined if it is not a whole number. */
export function parseKm(raw: string): number | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  return /^\d{1,7}$/.test(t) ? Number(t) : undefined;
}
