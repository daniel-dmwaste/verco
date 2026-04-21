import { Suspense } from 'react'
import { headers } from 'next/headers'
import { AddressForm } from './address-form'

export default async function BookAddressPage() {
  const h = await headers()
  const clientId = h.get('x-client-id') ?? ''
  return (
    <Suspense>
      <AddressForm clientId={clientId} />
    </Suspense>
  )
}
