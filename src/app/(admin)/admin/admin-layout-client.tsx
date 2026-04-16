'use client'

import { AdminSidebar } from '@/components/admin/admin-sidebar'

interface AdminLayoutClientProps {
  clientName: string
  initials: string
  counts: {
    bookings: number
    ncn: number
    np: number
    tickets: number
  }
  role: string | null
  children: React.ReactNode
}

export function AdminLayoutClient({
  clientName,
  initials,
  counts,
  role,
  children,
}: AdminLayoutClientProps) {
  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-4 bg-[#293F52] px-5">
        <div className="flex w-60 shrink-0 items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-[7px] bg-[#00E47C] font-[family-name:var(--font-heading)] text-base font-bold text-[#293F52]">
            V
          </div>
          <span className="font-[family-name:var(--font-heading)] text-base font-bold text-white">
            VERCO
          </span>
        </div>

        {/* Tenant pill */}
        <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-body-sm font-medium text-white">
          <div className="size-2 rounded-full bg-[#00E47C]" />
          {clientName}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="flex w-60 items-center gap-2 rounded-lg bg-white/10 px-3.5 py-1.5 text-body-sm text-white/60">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 opacity-60"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Search bookings, tickets...
        </div>

        {/* Avatar */}
        <div className="flex size-8 items-center justify-center rounded-full bg-[#3A5A73] text-body-sm font-semibold text-white">
          {initials}
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar counts={counts} role={role} />
        <main className="flex flex-1 flex-col overflow-y-auto bg-gray-50">
          {children}
        </main>
      </div>
    </div>
  )
}
