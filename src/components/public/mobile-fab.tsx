'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

export function MobileFab() {
  const pathname = usePathname()

  if (pathname.startsWith('/book')) return null

  return (
    <Link
      href="/book"
      className="fixed bottom-24 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-[#00E47C] text-2xl font-bold text-[#293F52] shadow-lg md:hidden"
      aria-label="Book a Collection"
    >
      +
    </Link>
  )
}
