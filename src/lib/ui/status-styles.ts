/**
 * Centralised status → colour mappings for all entity types.
 * Import getStatusStyle() instead of defining STATUS_STYLE locally.
 */

export interface StatusStyle {
  bg: string
  text: string
  label: string
  /** Optional dot colour for inline status indicators */
  dot?: string
}

// ── Booking statuses ─────────────────────────────────────────────────────────

const BOOKING: Record<string, StatusStyle> = {
  'Pending Payment': { bg: 'bg-[#FFF3EA]', text: 'text-[#8B4000]', label: 'Pending Payment' },
  Submitted:         { bg: 'bg-[#EBF5FF]', text: 'text-[#3182CE]', label: 'Submitted' },
  Confirmed:         { bg: 'bg-[#E8FDF0]', text: 'text-[#006A38]', label: 'Confirmed' },
  Scheduled:         { bg: 'bg-[#F3EEFF]', text: 'text-[#805AD5]', label: 'Scheduled' },
  Completed:         { bg: 'bg-gray-100',   text: 'text-gray-700',  label: 'Completed' },
  Cancelled:         { bg: 'bg-[#FFF0F0]', text: 'text-[#E53E3E]', label: 'Cancelled' },
  'Non-conformance': { bg: 'bg-[#FFF0F0]', text: 'text-[#E53E3E]', label: 'Non-Conformance' },
  'Nothing Presented': { bg: 'bg-[#FFF3EA]', text: 'text-[#8B4000]', label: 'Nothing Presented' },
  Rebooked:          { bg: 'bg-[#EBF5FF]', text: 'text-[#3182CE]', label: 'Rebooked' },
  'Missed Collection': { bg: 'bg-[#FFF0F0]', text: 'text-[#E53E3E]', label: 'Missed Collection' },
}

// ── NCN statuses ─────────────────────────────────────────────────────────────

const NCN: Record<string, StatusStyle> = {
  Issued:          { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Issued' },
  Open:            { bg: 'bg-amber-50',    text: 'text-amber-700',   label: 'Open' },
  Disputed:        { bg: 'bg-red-50',      text: 'text-red-700',     label: 'Disputed' },
  'Under Review':  { bg: 'bg-amber-50',    text: 'text-amber-700',   label: 'Under Review' },
  Resolved:        { bg: 'bg-emerald-50',  text: 'text-emerald-700', label: 'Resolved' },
  Rescheduled:     { bg: 'bg-blue-50',     text: 'text-blue-700',    label: 'Rescheduled' },
  Closed:          { bg: 'bg-gray-50',     text: 'text-gray-400',    label: 'Closed' },
}

// ── NP statuses (same palette as NCN, slightly different set) ────────────────

const NP: Record<string, StatusStyle> = {
  Issued:          { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Issued' },
  Open:            { bg: 'bg-amber-50',    text: 'text-amber-700',   label: 'Open' },
  Disputed:        { bg: 'bg-red-50',      text: 'text-red-700',     label: 'Disputed' },
  'Under Review':  { bg: 'bg-blue-50',     text: 'text-blue-700',    label: 'Under Review' },
  Resolved:        { bg: 'bg-emerald-50',  text: 'text-emerald-700', label: 'Resolved' },
  Rebooked:        { bg: 'bg-purple-50',   text: 'text-purple-700',  label: 'Rebooked' },
  Closed:          { bg: 'bg-gray-50',     text: 'text-gray-400',    label: 'Closed' },
}

// ── Ticket statuses ──────────────────────────────────────────────────────────

const TICKET: Record<string, StatusStyle> = {
  open:                  { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Open',           dot: 'bg-amber-400' },
  in_progress:           { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'In Progress',    dot: 'bg-blue-500' },
  waiting_on_customer:   { bg: 'bg-purple-50',  text: 'text-purple-700',  label: 'Awaiting Reply', dot: 'bg-purple-500' },
  resolved:              { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Resolved',       dot: 'bg-emerald-500' },
  closed:                { bg: 'bg-gray-100',   text: 'text-gray-600',    label: 'Closed',         dot: 'bg-gray-400' },
}

// ── Refund statuses ──────────────────────────────────────────────────────────

const REFUND: Record<string, StatusStyle> = {
  Pending:  { bg: 'bg-[#FFF3EA]', text: 'text-[#8B4000]', label: 'Pending' },
  Approved: { bg: 'bg-[#E8FDF0]', text: 'text-[#006A38]', label: 'Approved' },
  Rejected: { bg: 'bg-[#FFF0F0]', text: 'text-[#E53E3E]', label: 'Rejected' },
}

// ── Bug report statuses ──────────────────────────────────────────────────────

const BUG: Record<string, StatusStyle> = {
  new:          { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'New' },
  triaged:      { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'Triaged' },
  in_progress:  { bg: 'bg-purple-50',  text: 'text-purple-700',  label: 'In Progress' },
  resolved:     { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Resolved' },
  closed:       { bg: 'bg-gray-100',   text: 'text-gray-600',    label: 'Closed' },
  wont_fix:     { bg: 'bg-gray-100',   text: 'text-gray-500',    label: "Won't Fix" },
}

// ── Lookup ───────────────────────────────────────────────────────────────────

const ENTITIES = { booking: BOOKING, ncn: NCN, np: NP, ticket: TICKET, refund: REFUND, bug: BUG } as const

export type StatusEntity = keyof typeof ENTITIES

const FALLBACK: StatusStyle = { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Unknown' }

export function getStatusStyle(entity: StatusEntity, status: string): StatusStyle {
  return ENTITIES[entity][status] ?? FALLBACK
}

/** Get all status keys for an entity (useful for filter dropdowns) */
export function getStatusOptions(entity: StatusEntity): string[] {
  return Object.keys(ENTITIES[entity])
}
