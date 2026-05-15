'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Top-bar search. On Enter (or button click), navigates to
 * `/admin/bookings?search=<query>` — the bookings list already supports
 * the `search` param and filters by booking ref (`ref.ilike.%q%`).
 *
 * Future scope: unify search across bookings, properties, tickets, contacts
 * — would need a server-side search endpoint. For now the booking-ref
 * route covers the most common "find this booking" need.
 */
export function AdminSearchBar() {
  const router = useRouter()
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) {
      router.push('/admin/bookings')
      return
    }
    const params = new URLSearchParams({ search: trimmed })
    router.push(`/admin/bookings?${params.toString()}`)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-60 items-center gap-2 rounded-lg bg-white/10 px-3.5 py-1.5 text-body-sm text-white transition-colors focus-within:bg-white/15"
    >
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
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search booking ref..."
        className="w-full bg-transparent text-body-sm text-white outline-none placeholder:text-white/60"
      />
    </form>
  )
}
