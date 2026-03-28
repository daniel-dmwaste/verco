import { Suspense } from 'react'
import { ServicesForm } from './services-form'

export default function ServicesPage() {
  return (
    <Suspense>
      <ServicesForm />
    </Suspense>
  )
}
