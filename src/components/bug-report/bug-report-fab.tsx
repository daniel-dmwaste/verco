'use client'

import { useState } from 'react'
import { BugReportDialog } from './bug-report-dialog'

// Desktop-only FAB. `hidden tablet:flex` keeps it off mobile/tablet
// (project uses `tablet:` for the 1024px breakpoint).
export function BugReportFab() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        className="
          fixed bottom-6 right-6 z-30
          hidden tablet:flex
          items-center gap-2 rounded-full
          bg-[#293F52] px-4 py-3
          text-body-sm font-semibold text-white
          shadow-lg shadow-black/20
          transition hover:bg-[#1e2e3e]
          focus:outline-none focus:ring-2 focus:ring-[#00E47C] focus:ring-offset-2
        "
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 2v4M16 2v4M3 10h18M5 14h.01M5 18h.01M9 14h.01M9 18h.01M13 14h.01M13 18h.01M17 14h.01M17 18h.01" />
          <rect x="3" y="6" width="18" height="16" rx="2" />
        </svg>
        Report a bug
      </button>

      <BugReportDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
