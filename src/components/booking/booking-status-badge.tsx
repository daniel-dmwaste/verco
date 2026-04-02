import type { Database } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'

type BookingStatus = Database['public']['Enums']['booking_status']

const STATUS_CONFIG: Record<
  BookingStatus,
  { label: string; className: string }
> = {
  'Pending Payment': {
    label: 'Pending Payment',
    className: 'bg-[#FFF3EA] text-[#8B4000]',
  },
  Submitted: {
    label: 'Submitted',
    className: 'bg-[#EBF5FF] text-[#3182CE]',
  },
  Confirmed: {
    label: 'Confirmed',
    className: 'bg-[#E8FDF0] text-[#006A38]',
  },
  Scheduled: {
    label: 'Scheduled',
    className: 'bg-[#F3EEFF] text-[#805AD5]',
  },
  Completed: {
    label: 'Completed',
    className: 'bg-gray-100 text-gray-700',
  },
  Cancelled: {
    label: 'Cancelled',
    className: 'bg-[#FFF0F0] text-[#E53E3E]',
  },
  'Non-conformance': {
    label: 'Non-Conformance',
    className: 'bg-[#FFF0F0] text-[#E53E3E]',
  },
  'Nothing Presented': {
    label: 'Nothing Presented',
    className: 'bg-[#FFF3EA] text-[#8B4000]',
  },
  Rebooked: {
    label: 'Rebooked',
    className: 'bg-[#EBF5FF] text-[#3182CE]',
  },
  'Missed Collection': {
    label: 'Missed Collection',
    className: 'bg-[#FFF0F0] text-[#E53E3E]',
  },
}

interface BookingStatusBadgeProps {
  status: BookingStatus
  className?: string
}

export function BookingStatusBadge({
  status,
  className,
}: BookingStatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}
