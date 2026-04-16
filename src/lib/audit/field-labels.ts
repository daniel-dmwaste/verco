/**
 * Human-readable labels for database column names, used by the audit trail resolver.
 */

/** Columns to exclude from the audit diff display (noise fields). */
export const NOISE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'client_id',
  'contractor_id',
  'fy_id',
  'attio_person_id',
  'attio_person_web_url',
  'attio_record_id',
  'last_synced_by',
  'google_place_id',
  'has_geocode',
  'address', // raw address — formatted_address is the human-readable version
])

/** Map of column name → human-readable label. */
export const FIELD_LABELS: Record<string, string> = {
  // Booking
  status: 'Status',
  ref: 'Reference',
  type: 'Type',
  location: 'Location',
  notes: 'Notes',
  property_id: 'Property',
  collection_area_id: 'Collection Area',
  contact_id: 'Contact',
  cancelled_at: 'Cancelled At',
  cancelled_by: 'Cancelled By',
  cancellation_reason: 'Cancellation Reason',
  deleted_at: 'Deleted At',

  // Booking item
  booking_id: 'Booking',
  service_id: 'Service',
  service_type_id: 'Service',
  collection_date_id: 'Collection Date',
  no_services: 'Quantity',
  actual_services: 'Actual Quantity',
  unit_price_cents: 'Unit Price',
  is_extra: 'Extra Item',

  // Contact
  full_name: 'Name',
  email: 'Email',
  mobile_e164: 'Mobile',

  // NCN / NP
  reason: 'Reason',
  resolution_notes: 'Resolution Notes',
  contractor_fault: 'Contractor Fault',
  reported_at: 'Reported At',
  reported_by: 'Reported By',
  resolved_at: 'Resolved At',
  resolved_by: 'Resolved By',
  rescheduled_booking_id: 'Rescheduled Booking',
  rescheduled_date: 'Rescheduled Date',

  // Service ticket
  subject: 'Subject',
  description: 'Description',
  priority: 'Priority',
  category: 'Category',
  channel: 'Channel',
  assigned_to: 'Assigned To',
  first_response_at: 'First Response At',
  closed_at: 'Closed At',
  display_id: 'Ticket ID',

  // Ticket response
  ticket_id: 'Ticket',
  author_id: 'Author',
  author_type: 'Author Type',
  message: 'Message',
  is_internal: 'Internal Note',

  // Collection date
  date: 'Date',
  is_open: 'Open for Bookings',
  max_capacity: 'Max Capacity',

  // Eligible properties
  address: 'Address',
  formatted_address: 'Formatted Address',
  latitude: 'Latitude',
  longitude: 'Longitude',
  is_mud: 'Multi-Unit Dwelling',

  // Strata user properties
  user_id: 'User',
}

/**
 * FK columns that should be resolved to display names from referenced tables.
 * Maps column name → { table, column } to look up.
 */
export const FK_RESOLVE_MAP: Record<string, { table: string; column: string }> = {
  service_id: { table: 'service', column: 'name' },
  service_type_id: { table: 'service', column: 'name' },
  collection_area_id: { table: 'collection_area', column: 'name' },
  contact_id: { table: 'contacts', column: 'full_name' },
  property_id: { table: 'eligible_properties', column: 'formatted_address' },
  collection_date_id: { table: 'collection_date', column: 'date' },
  booking_id: { table: 'booking', column: 'ref' },
  rescheduled_booking_id: { table: 'booking', column: 'ref' },
  ticket_id: { table: 'service_ticket', column: 'display_id' },
  assigned_to: { table: 'profiles', column: 'display_name' },
  reported_by: { table: 'profiles', column: 'display_name' },
  resolved_by: { table: 'profiles', column: 'display_name' },
  cancelled_by: { table: 'profiles', column: 'display_name' },
  author_id: { table: 'profiles', column: 'display_name' },
  user_id: { table: 'profiles', column: 'display_name' },
}
