'use client'

import { useRouter } from 'next/navigation'
import { AddressAutocomplete } from '@/components/booking/address-autocomplete'

export function HeroSearch() {
  const router = useRouter()

  function handleSelect(_placeId: string, description: string) {
    const params = new URLSearchParams({ address: description })
    router.push(`/book?${params.toString()}`)
  }

  return (
    <AddressAutocomplete
      onSelect={handleSelect}
      placeholder="Enter your property address to get started..."
      variant="hero"
    />
  )
}
