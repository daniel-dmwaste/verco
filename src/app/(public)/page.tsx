import Link from 'next/link'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { HeroSearch } from './hero-search'

interface ClientBranding {
  name: string
  service_name: string | null
  show_powered_by: boolean
}

async function getBranding(): Promise<ClientBranding> {
  const headerStore = await headers()
  const clientId = headerStore.get('x-client-id')

  if (!clientId) {
    return { name: 'Verge Collection', service_name: 'Verge Collection Bookings', show_powered_by: true }
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('client')
    .select('name, service_name, show_powered_by')
    .eq('id', clientId)
    .single()

  return data ?? { name: 'Verge Collection', service_name: 'Verge Collection Bookings', show_powered_by: true }
}

const FEATURES = [
  {
    title: 'Included in Your Rates',
    body: 'Your annual allocation is already included in council rates. Book your free services first — extra services are available if you need more.',
    colorClass: 'bg-[#E8FDF0]',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00B864" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    ),
  },
  {
    title: 'Choose Your Date',
    body: 'See all available collection dates for your area and pick the one that suits you. Dates are shown in real-time so you always know what\u2019s available.',
    colorClass: 'bg-[#E8EEF2]',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#293F52" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    ),
  },
  {
    title: 'Reminders Sent to You',
    body: 'We\u2019ll send a reminder SMS and email before your collection date so you don\u2019t forget to place your items on the verge by 7am.',
    colorClass: 'bg-[#FFF3EA]',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    ),
  },
]

const STEPS = [
  { title: 'Search your address', body: 'Enter your property address to check eligibility and view your annual allocation.' },
  { title: 'Select services & date', body: 'Choose your waste types and pick an available collection date.' },
  { title: 'Confirm & pay if needed', body: 'Free services go straight through. Extra services are charged via Stripe.' },
  { title: 'Place items out by 7am', body: 'We\u2019ll remind you. Items must be on the verge by 7am on collection day.' },
  { title: 'We collect & process', body: 'Your waste is collected and responsibly processed. You\u2019ll get a completion notification.' },
]

const SERVICES = [
  { name: 'General Waste', desc: 'Household bulk items \u2014 furniture, timber, general rubbish', tag: 'Bulk', tagClass: 'bg-[#E8FDF0] text-[#00B864]' },
  { name: 'Green Waste', desc: 'Garden organics \u2014 prunings, lawn clippings, branches', tag: 'Bulk', tagClass: 'bg-[#E8FDF0] text-[#00B864]' },
  { name: 'Mattress', desc: 'Bed mattresses of any size \u2014 single, double, queen, king', tag: 'Ancillary', tagClass: 'bg-[#E8EEF2] text-[#293F52]' },
  { name: 'E-Waste', desc: 'Electronics \u2014 TVs, computers, monitors, appliances', tag: 'Ancillary', tagClass: 'bg-[#E8EEF2] text-[#293F52]' },
  { name: 'Whitegoods', desc: 'Fridges, washing machines, dryers, dishwashers', tag: 'Ancillary', tagClass: 'bg-[#E8EEF2] text-[#293F52]' },
]

export default async function LandingPage() {
  const branding = await getBranding()
  const serviceName = branding.service_name ?? 'Verge Collection'

  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1A2D3B] via-[#293F52] to-[#3A5A73] px-8 py-20 lg:px-20 lg:py-24">
        {/* Decorative radials */}
        <div className="absolute -right-32 -top-32 size-[500px] rounded-full bg-[radial-gradient(circle,rgba(0,228,124,0.12)_0%,transparent_70%)]" />
        <div className="absolute -bottom-20 -left-20 size-[400px] rounded-full bg-[radial-gradient(circle,rgba(0,228,124,0.06)_0%,transparent_70%)]" />

        <div className="relative z-10 max-w-[640px]">
          {/* Tenant tag */}
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-[#00E47C]/30 bg-[#00E47C]/15 px-3.5 py-1.5 text-xs font-semibold text-[#00E47C]">
            <div className="size-1.5 rounded-full bg-[#00E47C]" />
            {branding.name} &middot; Bulk Verge Collection
          </div>

          <h1 className="mb-5 font-[family-name:var(--font-heading)] text-4xl font-bold leading-[1.1] text-white lg:text-[52px]">
            Book Your
            <br />
            <span className="text-[#00E47C]">Verge Collection</span>
            <br />
            in Minutes
          </h1>

          <p className="mb-10 max-w-[520px] text-base leading-relaxed text-[#C7D3DD] lg:text-lg">
            Simple online booking for bulk verge collection. Check your property
            eligibility, choose your services, and pick a date.
          </p>

          {/* Search box */}
          <HeroSearch />

          <p className="mt-2.5 text-xs text-[#8FA5B8]">
            e.g. 23 Leda Blvd, Wellard WA 6170
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white px-8 py-[72px] lg:px-20">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[1px] text-[#00B864]">
          Why book online
        </div>
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-3xl font-bold text-[#293F52] lg:text-4xl">
          Fast, Simple, Paperless
        </h2>
        <p className="mb-14 max-w-[520px] text-base text-gray-500">
          Book your collection from any device in under 3 minutes. No phone
          calls, no paperwork.
        </p>
        <div className="grid gap-8 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="flex flex-col gap-3">
              <div
                className={`flex size-11 items-center justify-center rounded-xl ${feature.colorClass}`}
              >
                {feature.icon}
              </div>
              <h3 className="font-[family-name:var(--font-heading)] text-base font-semibold text-[#293F52]">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-gray-500">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-gray-50 px-8 py-[72px] lg:px-20">
        <h2 className="mb-12 font-[family-name:var(--font-heading)] text-3xl font-bold text-[#293F52] lg:text-4xl">
          How it works
        </h2>
        <div className="relative grid grid-cols-2 gap-y-10 md:grid-cols-5 md:gap-0">
          {/* Connector line (desktop only) */}
          <div className="absolute left-[calc(10%+20px)] right-[calc(10%+20px)] top-5 hidden h-0.5 bg-gray-100 md:block" />
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col items-center gap-3.5 px-4"
            >
              <div className="relative z-10 flex size-10 items-center justify-center rounded-full bg-[#00E47C] font-[family-name:var(--font-heading)] text-base font-bold text-[#293F52] shadow-[0_0_0_6px_#F5F5F5]">
                {i + 1}
              </div>
              <h3 className="text-center text-[13px] font-semibold text-[#293F52]">
                {step.title}
              </h3>
              <p className="text-center text-xs leading-relaxed text-gray-500">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* What We Collect */}
      <section id="services" className="bg-white px-8 py-[72px] lg:px-20">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-3xl font-bold text-[#293F52] lg:text-4xl">
          What We Collect
        </h2>
        <p className="mb-12 text-base text-gray-500">
          All services are available in {branding.name}. Allocation limits apply
          per financial year.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((svc) => (
            <div
              key={svc.name}
              className="flex flex-col gap-2 rounded-xl border-[1.5px] border-gray-100 bg-gray-50 px-5 py-5"
            >
              <h3 className="font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]">
                {svc.name}
              </h3>
              <p className="text-[13px] text-gray-500">{svc.desc}</p>
              <span
                className={`inline-flex w-fit rounded-full px-2.5 py-0.5 text-[11px] font-medium ${svc.tagClass}`}
              >
                {svc.tag}
              </span>
            </div>
          ))}
          {/* Info tile */}
          <div className="flex items-center gap-3.5 rounded-xl border-[1.5px] border-[#C7D3DD] bg-[#E8EEF2] px-5 py-5">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#293F52"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <h3 className="font-[family-name:var(--font-heading)] text-[15px] font-semibold text-[#293F52]">
                Not sure what&apos;s eligible?
              </h3>
              <p className="text-xs text-gray-500">
                Check our full guidelines or contact us
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section className="relative overflow-hidden bg-[#293F52] px-8 py-[72px] lg:px-20">
        <div className="absolute -right-24 -top-24 size-[400px] rounded-full bg-[radial-gradient(circle,rgba(0,228,124,0.10)_0%,transparent_70%)]" />
        <div className="relative z-10 flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div>
            <h2 className="mb-3 font-[family-name:var(--font-heading)] text-3xl font-bold leading-tight text-white lg:text-4xl">
              Ready to book your
              <br />
              collection?
            </h2>
            <p className="max-w-[480px] text-base leading-relaxed text-[#C7D3DD]">
              Enter your address to check eligibility and book in under 3
              minutes. Your annual allocation is waiting.
            </p>
          </div>
          <Link
            href="/book"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#00E47C] px-9 py-4 font-[family-name:var(--font-heading)] text-base font-bold text-[#293F52]"
          >
            Book a Collection
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="flex flex-col items-center justify-between gap-4 bg-[#1A2D3B] px-8 py-8 sm:flex-row lg:px-20">
        <div className="flex items-center gap-3">
          <div className="flex size-6 items-center justify-center rounded-md bg-[#00E47C] font-[family-name:var(--font-heading)] text-[13px] font-bold text-[#293F52]">
            V
          </div>
          <span className="text-[13px] text-[#8FA5B8]">
            &copy; {new Date().getFullYear()} {branding.name} &middot;{' '}
            <a href="#" className="text-[#8FA5B8] underline">
              Privacy Policy
            </a>
          </span>
        </div>
        {branding.show_powered_by && (
          <div className="flex items-center gap-1.5 text-xs text-[#8FA5B8]">
            Booking platform powered by
            <span className="rounded border border-white/[0.12] bg-white/[0.08] px-2 py-0.5 font-[family-name:var(--font-heading)] text-[11px] font-semibold text-white">
              VERCO
            </span>
          </div>
        )}
      </footer>
    </div>
  )
}
