// Yard block / row are typed by hand at gate-in, so the same slot was saved
// as "OSC"/"1" on one container and "osc "/"01" on the next, and the yard map
// showed them as different rows. These helpers give one spelling per slot.

/** Trims, upper-cases and collapses spaces: " osc " → "OSC". */
export const normalizeBlock = (value: string): string => value.trim().replace(/\s+/g, " ").toUpperCase();

/** As normalizeBlock, and a plain number gets two digits: "1" → "01", "003" → "03". */
export const normalizeRow = (value: string): string => {
  const v = normalizeBlock(value);
  return /^\d+$/.test(v) ? String(Number(v)).padStart(2, "0") : v;
};

/** Distinct normalized values, sorted naturally ("2" before "10"). */
export const distinctSorted = (values: (string | null | undefined)[], normalize: (v: string) => string): string[] =>
  Array.from(new Set(values.filter((v): v is string => !!v && !!v.trim()).map(normalize))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
