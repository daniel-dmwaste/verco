'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface PublicNavProps {
  serviceName: string
  logoUrl: string | null
  showPoweredBy: boolean
}

export function PublicNav({
  serviceName,
  showPoweredBy,
}: PublicNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!mobileOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mobileOpen])

  return (
    <nav className="relative bg-[#293F52]">
      <div className="flex h-16 items-center justify-between px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#00E47C] font-[family-name:var(--font-heading)] text-lg md:text-xl font-bold text-[#293F52]">
            V
          </div>
          <span className="font-[family-name:var(--font-heading)] text-lg md:text-xl font-bold text-white">
            {serviceName}
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden flex-1 items-center justify-end gap-6 md:flex">
          <a
            href="/#how-it-works"
            className="text-sm md:text-base font-medium text-[#C7D3DD] hover:text-white"
          >
            How it works
          </a>
          <a
            href="/#services"
            className="text-sm md:text-base font-medium text-[#C7D3DD] hover:text-white"
          >
            Services
          </a>
          <a
            href="/#faqs"
            className="text-sm md:text-base font-medium text-[#C7D3DD] hover:text-white"
          >
            FAQs
          </a>
          <Link
            href="/dashboard"
            className="text-sm md:text-base font-medium text-[#C7D3DD] hover:text-white"
          >
            My Dashboard
          </Link>
          <Link
            href="/book"
            className="rounded-lg bg-[#00E47C] px-5 py-2 font-[family-name:var(--font-heading)] text-sm md:text-base font-semibold text-[#293F52]"
          >
            Book a Collection
          </Link>
          {showPoweredBy && (
            <div className="ml-4 flex items-center gap-1.5 border-l border-white/10 pl-4 text-[11px] md:text-[13px] text-[#8FA5B8]">
              Powered by
              <span className="rounded border border-white/[0.12] bg-white/[0.08] px-1.5 py-0.5 font-[family-name:var(--font-heading)] text-[10px] md:text-xs font-semibold text-[#C7D3DD]">
                VERCO
              </span>
            </div>
          )}
        </div>

        {/* Mobile hamburger button */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="flex size-10 items-center justify-center rounded-lg text-white hover:bg-white/10 md:hidden"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      <div
        ref={menuRef}
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out md:hidden"
        style={{ maxHeight: mobileOpen ? '400px' : '0px' }}
      >
        <div className="flex flex-col gap-1 border-t border-white/10 px-8 pb-6 pt-4">
          <a
            href="/#how-it-works"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#C7D3DD] hover:bg-white/10 hover:text-white"
          >
            How it works
          </a>
          <a
            href="/#services"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#C7D3DD] hover:bg-white/10 hover:text-white"
          >
            Services
          </a>
          <a
            href="/#faqs"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#C7D3DD] hover:bg-white/10 hover:text-white"
          >
            FAQs
          </a>
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-[#C7D3DD] hover:bg-white/10 hover:text-white"
          >
            My Dashboard
          </Link>
          <Link
            href="/book"
            onClick={() => setMobileOpen(false)}
            className="mt-3 rounded-lg bg-[#00E47C] py-3 text-center font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]"
          >
            Book a Collection
          </Link>
          {showPoweredBy && (
            <div className="mt-3 flex items-center justify-center gap-1.5 border-t border-white/10 pt-4 text-[11px] text-[#8FA5B8]">
              Powered by
              <span className="rounded border border-white/[0.12] bg-white/[0.08] px-1.5 py-0.5 font-[family-name:var(--font-heading)] text-[10px] font-semibold text-[#C7D3DD]">
                VERCO
              </span>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
