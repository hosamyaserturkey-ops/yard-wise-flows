/**
 * A VIN is 17 characters, digits and capital letters except I, O and Q
 * (they are too easy to confuse with 1 and 0). The database enforces the same
 * rule (vehicles.vin check), so this only gives a clear message sooner.
 */
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/** What a person typed or a scanner read, made comparable: no spaces, upper case. */
export function normalizeVin(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Returns null when the VIN is fine, else a message that says what is wrong. */
export function validateVin(raw: string): string | null {
  const vin = normalizeVin(raw);
  if (!vin) return "Enter the VIN.";
  if (vin.length !== 17) return `A VIN has 17 characters; this has ${vin.length}.`;
  if (/[IOQ]/.test(vin)) return "A VIN never contains the letters I, O or Q. Check for 1 or 0.";
  if (!VIN_PATTERN.test(vin)) return "A VIN uses only letters and digits.";
  return null;
}
