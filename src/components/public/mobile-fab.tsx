'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

export function MobileFab() {
  const pathname = usePathname()

  if (pathname.startsWith('/book')) return null

  return (
    <Link
      href="/book"
      className="fixed bottom-24 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-[var(--brand-accent)] text-2xl font-bold text-[var(--brand)] shadow-lg tablet:hidden"
      aria-label="Book a Collection"
    >
      +
    </Link>
  )
}
