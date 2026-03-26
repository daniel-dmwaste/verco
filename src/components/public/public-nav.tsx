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
  return (
    <nav className="flex h-16 items-center gap-8 bg-[#293F52] px-8">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#00E47C] font-[family-name:var(--font-heading)] text-lg font-bold text-[#293F52]">
          V
        </div>
        <span className="font-[family-name:var(--font-heading)] text-lg font-bold text-white">
          {serviceName}
        </span>
      </Link>
      <div className="hidden flex-1 items-center justify-end gap-6 lg:flex">
        <a
          href="/#how-it-works"
          className="text-sm font-medium text-[#C7D3DD] hover:text-white"
        >
          How it works
        </a>
        <a
          href="/#services"
          className="text-sm font-medium text-[#C7D3DD] hover:text-white"
        >
          Services
        </a>
        <a
          href="/#faqs"
          className="text-sm font-medium text-[#C7D3DD] hover:text-white"
        >
          FAQs
        </a>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-[#C7D3DD] hover:text-white"
        >
          My Bookings
        </Link>
        <Link
          href="/book"
          className="rounded-lg bg-[#00E47C] px-5 py-2 font-[family-name:var(--font-heading)] text-sm font-semibold text-[#293F52]"
        >
          Book a Collection
        </Link>
        {showPoweredBy && (
          <div className="ml-4 flex items-center gap-1.5 border-l border-white/10 pl-4 text-[11px] text-[#8FA5B8]">
            Powered by
            <span className="rounded border border-white/[0.12] bg-white/[0.08] px-1.5 py-0.5 font-[family-name:var(--font-heading)] text-[10px] font-semibold text-[#C7D3DD]">
              VERCO
            </span>
          </div>
        )}
      </div>
    </nav>
  )
}
