import { z } from 'zod';
import { ALL_ACCEPTED_TYPE_CODES } from '@/lib/containerTypes';

// ISO 6346 layout: a 4-letter owner/category prefix followed by a 7-digit
// serial (the 7th digit is the check digit) — e.g. MSKU1234567.
export const CONTAINER_NUMBER_REGEX = /^[A-Z]{4}[0-9]{7}$/;
export const CONTAINER_NUMBER_MESSAGE =
  'Container number must be 4 letters followed by 7 numbers (e.g., MSKU1234567)';

export const gateInSchema = z.object({
  containerNumber: z.string()
    .min(1, 'Container number is required')
    .regex(CONTAINER_NUMBER_REGEX, CONTAINER_NUMBER_MESSAGE),
  containerType: z.enum(ALL_ACCEPTED_TYPE_CODES as [string, ...string[]], {
    errorMap: () => ({ message: 'Please select a container type' }),
  }),
  // Shipping line is validated at runtime against the shipping_lines table.
  shippingLine: z.string().min(1, 'Shipping line is required'),
  driverName: z.string()
    .trim()
    .min(1, 'Driver name is required')
    .max(100, 'Driver name is too long'),
  truckNumber: z.string()
    .min(1, 'Truck number is required')
    .max(20, 'Truck number is too long')
    .regex(/^[A-Z0-9]+$/, 'Only uppercase letters and numbers allowed'),
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
  driverName: z.string()
    .trim()
    .min(1, 'Driver name is required')
    .max(100, 'Driver name is too long'),
  truckNumber: z.string()
    .min(1, 'Truck number is required')
    .max(20, 'Truck number is too long'),
  fees: z.string()
    .min(1, 'Fees are required')
    .refine((val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num >= 0 && num <= 999999.99;
    }, 'Fees must be between 0 and 999,999.99'),
});

export const bookingSchema = z.object({
  booking_number: z.string()
    .trim()
    .min(1, 'Booking number is required')
    .max(50, 'Booking number is too long')
    .regex(/^[A-Za-z0-9\-_]+$/, 'Only letters, numbers, hyphens and underscores allowed'),
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
