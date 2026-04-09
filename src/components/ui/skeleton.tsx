import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded bg-gray-200', className)}
      role="status"
      aria-label="Loading skeleton"
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}

interface SkeletonRowProps {
  columns: number
  className?: string
}

/**
 * Renders a single skeleton table row with placeholder cells
 * Use this for table loading states
 */
export function SkeletonRow({ columns, className }: SkeletonRowProps) {
  return (
    <tr className={cn('border-b border-gray-100', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </td>
      ))}
    </tr>
  )
}
