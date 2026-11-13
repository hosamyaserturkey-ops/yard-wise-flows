/** A manufacturer as the car lot keeps it (one row of public.manufacturers). */
export interface ManufacturerForm {
  code: string;
  name: string;
  contact_email: string;
  default_free_days: string;
}

/** Codes are short, upper-case and unique per car lot (e.g. TOY, HYU). */
export function normalizeManufacturerCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Mirrors what the database accepts, so the user is told what is wrong before
 * a request is made. Returns null when the form is fine.
 */
export function validateManufacturer(form: ManufacturerForm): string | null {
  const code = normalizeManufacturerCode(form.code);
  if (!code || !form.name.trim()) return "Code and name are required.";
  if (!/^[A-Z0-9]{2,10}$/.test(code)) return "Code must be 2 to 10 letters or numbers.";
  const email = form.contact_email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That contact email does not look right.";
  const days = Number(form.default_free_days);
  if (form.default_free_days.trim() === "" || !Number.isInteger(days) || days < 0 || days > 365) {
    return "Free days must be a whole number from 0 to 365.";
  }
  return null;
}
