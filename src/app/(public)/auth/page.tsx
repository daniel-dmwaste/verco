import { EmailEntryForm } from './email-entry-form'

export default function AuthPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm">
        {/* Brand block */}
        <div className="flex flex-col items-center gap-2.5 pb-10 pt-8">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] bg-[var(--brand-accent)] font-[family-name:var(--font-heading)] text-[22px] font-bold text-[var(--brand)]">
              V
            </div>
            <span className="font-[family-name:var(--font-heading)] text-[22px] font-bold text-[var(--brand)]">
              Verge Collection
            </span>
          </div>
          <span className="text-[13px] text-gray-500">City of Kwinana</span>
        </div>

        {/* Form card */}
        <EmailEntryForm />

        {/* Powered by */}
        <div className="flex items-center justify-center gap-1.5 pt-8 text-[11px] text-gray-300">
          Booking platform powered by
          <span className="rounded bg-gray-100 px-1.5 py-px font-[family-name:var(--font-heading)] text-[10px] font-bold text-gray-500">
            VERCO
          </span>
        </div>
      </div>
    </div>
  )
}
