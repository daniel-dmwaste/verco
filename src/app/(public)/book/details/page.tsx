import { Suspense } from 'react'
import { DetailsForm } from './details-form'

export default function DetailsPage() {
  return (
    <Suspense>
      <DetailsForm />
    </Suspense>
  )
}
