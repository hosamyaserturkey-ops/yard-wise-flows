import { z } from 'zod';
import { ALL_ACCEPTED_TYPE_CODES } from '@/lib/containerTypes';

// ISO 6346 layout: a 4-letter owner/category prefix followed by a 7-digit
// serial (the 7th digit is the check digit) — e.g. MSKU1234567.
export const CONTAINER_NUMBER_REGEX = /^[A-Z]{4}[0-9]{7}$/;
export const CONTAINER_NUMBER_MESSAGE =
  'Container number must be 4 letters followed by 7 numbers (e.g., MSKU1234567)';

// What operators type when they don't know the real value. Saved, these look
// like data and hide the gap ("N/A" drivers, "000000" trucks), so the gate
// forms refuse them.
const PLACEHOLDERS = new Set([
  "NA", "N/A", "N.A", "N.A.", "NONE", "NULL", "NIL", "UNKNOWN", "UNKOWN", "UNKNOW",
  "TBD", "TEST", "X", "XX", "XXX", "-", "--", ".", "?", "0",
]);
export const isPlaceholder = (value: string): boolean => {
  const v = value.trim().toUpperCase();
  return PLACEHOLDERS.has(v) || /^0+$/.test(v);
};

/**
 * One spelling per name: spaces trimmed and collapsed, Latin letters in
 * capitals (as most existing records are). Arabic script has no case and is
 * left as typed.
 */
export const normalizeDriverName = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toUpperCase();

/** Plates are stored as one run of letters and digits: "60-70415" -> "6070415". */
export const normalizeTruckNumber = (value: string): string =>
  value.toUpperCase().replace(/[\s-]+/g, "");

// Any script, plus the spaces, dots, apostrophes and hyphens names use.
const DRIVER_NAME_REGEX = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

export const driverNameSchema = z
  .string()
  .transform(normalizeDriverName)
  .pipe(
    z.string()
      .min(1, 'Driver name is required')
      .max(100, 'Driver name is too long')
      .superRefine((v, ctx) => {
        if (!v) return;
        if (isPlaceholder(v)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the driver's name, not a placeholder such as N/A" });
        } else if (!DRIVER_NAME_REGEX.test(v)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A driver name can only contain letters, spaces, dots, apostrophes and hyphens' });
        }
      }),
  );

export const truckNumberSchema = z
  .string()
  .transform(normalizeTruckNumber)
  .pipe(
    z.string()
      .min(1, 'Truck number is required')
      .max(20, 'Truck number is too long')
      .superRefine((v, ctx) => {
        if (!v) return;
        const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        if (isPlaceholder(v) || !/[0-9]/.test(v)) issue('Enter the truck\'s plate number, not a placeholder such as UNKNOWN or 000000');
        else if (!/^[A-Z0-9]+$/.test(v)) issue('Only letters and numbers allowed');
        else if (v.length < 4) issue('Truck number is too short');
      }),
  );

/**
 * A nudge, never a block: local plates are 7 digits, but foreign trucks and
 * older plates differ, so anything else is flagged for a second look only.
 */
export const truckNumberWarning = (value: string): string | null => {
  const v = normalizeTruckNumber(value);
  if (!v || /^[0-9]{7}$/.test(v) || !truckNumberSchema.safeParse(v).success) return null;
  return "Local plates have 7 digits. Check the number if this is a Jordanian truck.";
};

export const gateInSchema = z.object({
  containerNumber: z.string()
    .min(1, 'Container number is required')
    .regex(CONTAINER_NUMBER_REGEX, CONTAINER_NUMBER_MESSAGE),
  containerType: z.enum(ALL_ACCEPTED_TYPE_CODES as [string, ...string[]], {
    errorMap: () => ({ message: 'Please select a container type' }),
  }),
  // Shipping line is validated at runtime against the shipping_lines table.
  shippingLine: z.string().min(1, 'Shipping line is required'),
  driverName: driverNameSchema,
  truckNumber: truckNumberSchema,
  // Port data is optional at the schema level: no-demurrage lines gate in
  // without it. GateIn enforces a valid arrival date at runtime for lines that
  // do charge demurrage (hasDemurrageRules).
  portArrivalDate: z.string().optional(),
  freeDays: z.string().optional(),
  dailyDemurrage: z.string().optional(),
});

// Seals are stamped alphanumeric (some lines hyphenate). Kept permissive on
// length because seal formats vary by line, strict on the character set so a
// mistyped plate or note can't end up on the delivery note as a seal.
export const SEAL_NUMBER_REGEX = /^[A-Z0-9][A-Z0-9-]*$/;

export const gateOutSchema = z.object({
  // Attached at gate-out: a container may be released against a booking it was
  // never reserved for, so the number is chosen at the gate, not inherited.
  bookingNumber: z.string()
    .trim()
    .min(1, 'Booking number is required')
    .max(50, 'Booking number is too long'),
  sealNumber: z.string()
    .trim()
    .min(1, 'Seal number is required')
    .max(20, 'Seal number is too long')
    .regex(SEAL_NUMBER_REGEX, 'Only uppercase letters, numbers and hyphens allowed'),
  driverName: driverNameSchema,
  truckNumber: truckNumberSchema,
  fees: z.string()
    .min(1, 'Fees are required')
    .refine((val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num >= 0 && num <= 999999.99;
    }, 'Fees must be between 0 and 999,999.99'),
});

// Lines issue booking references with separators in them — a slash for the
// year suffix (EEL0030/26), dots in some agency formats — so the character set
// has to cover those. Still no spaces or free-form symbols: the number is
// matched verbatim against what the driver presents at the gate.
export const BOOKING_NUMBER_REGEX = /^[A-Za-z0-9\-_./]+$/;

export const bookingSchema = z.object({
  booking_number: z.string()
    .trim()
    .min(1, 'Booking number is required')
    .max(50, 'Booking number is too long')
    .regex(BOOKING_NUMBER_REGEX, 'Only letters, numbers, hyphens, underscores, dots and slashes allowed'),
  customer_name: z.string()
    .trim()
    .min(1, 'Customer name is required')
    .max(200, 'Customer name is too long'),
  // A booking belongs to one line: it gates which containers may be reserved
  // or released against it. Validated against shipping_lines at runtime.
  shipping_line: z.string()
    .trim()
    .min(1, 'Shipping line is required'),
  total_containers: z.number()
    .int('Must be a whole number')
    .min(1, 'At least 1 container required')
    .max(10000, 'Too many containers'),
});
