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
        {/* Bug icon — kept inline (rather than lucide-react) to match the
            existing icon style used in admin-sidebar.tsx's ICON.bug. */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 2l1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
          <path d="M12 20v-9" />
        </svg>
        Report a bug
      </button>

      <BugReportDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
