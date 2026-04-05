import { z } from 'zod';

export const gateInSchema = z.object({
  containerNumber: z.string()
    .min(1, 'Container number is required')
    .max(20, 'Container number is too long')
    .regex(/^[A-Z0-9]+$/, 'Only uppercase letters and numbers allowed'),
  containerType: z.enum(['20FT', '40FT', '40HC', '45FT', '20FR', '40FR'], {
    errorMap: () => ({ message: 'Please select a container type' }),
  }),
  shippingLine: z.enum(['SLD', 'SLG']),
  driverName: z.string()
    .trim()
    .min(1, 'Driver name is required')
    .max(100, 'Driver name is too long'),
  truckNumber: z.string()
    .min(1, 'Truck number is required')
    .max(20, 'Truck number is too long')
    .regex(/^[A-Z0-9]+$/, 'Only uppercase letters and numbers allowed'),
});

export const gateOutSchema = z.object({
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
  total_containers: z.number()
    .int('Must be a whole number')
    .min(1, 'At least 1 container required')
    .max(10000, 'Too many containers'),
});
