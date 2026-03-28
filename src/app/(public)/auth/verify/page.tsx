import { Suspense } from 'react'
import { OtpVerifyForm } from './otp-verify-form'

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm">
        {/* Brand block */}
        <div className="flex flex-col items-center gap-2.5 pb-10 pt-8">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] bg-[#00E47C] font-[family-name:var(--font-heading)] text-[22px] font-bold text-[#293F52]">
              V
            </div>
            <span className="font-[family-name:var(--font-heading)] text-[22px] font-bold text-[#293F52]">
              Verge Collection
            </span>
          </div>
          <span className="text-[13px] text-gray-500">City of Kwinana</span>
        </div>

        {/* OTP form card */}
        <Suspense>
          <OtpVerifyForm />
        </Suspense>

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
