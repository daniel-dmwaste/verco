import { z } from 'zod'

export const BookingItemSchema = z.object({
  service_type_id: z.string().uuid(),
  service_name: z.string(),
  category_name: z.string(),
  capacity_bucket: z.enum(['bulk', 'anc', 'id']),
  no_services: z.number().int().min(0),
  free_units: z.number().int().min(0),
  paid_units: z.number().int().min(0),
  unit_price_cents: z.number().int().min(0),
  line_charge_cents: z.number().int().min(0),
})

export type BookingItem = z.infer<typeof BookingItemSchema>

export const ContactSchema = z.object({
  full_name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Invalid email address'),
  mobile: z
    .string()
    .min(1, 'Mobile number is required')
    .max(20)
    .regex(/^\+?[0-9\s]+$/, 'Invalid mobile number'),
})

export type ContactFormData = z.infer<typeof ContactSchema>

export const LOCATION_OPTIONS = [
  'Front Verge',
  'Side Verge',
  'Driveway',
  'Laneway',
] as const

export type LocationOption = (typeof LOCATION_OPTIONS)[number]
