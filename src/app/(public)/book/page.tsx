import { Suspense } from 'react'
import { AddressForm } from './address-form'

export default function BookAddressPage() {
  return (
    <Suspense>
      <AddressForm />
    </Suspense>
  )
}
