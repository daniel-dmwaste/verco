import { Suspense } from 'react'
import { DateForm } from './date-form'

export default function DatePage() {
  return (
    <Suspense>
      <DateForm />
    </Suspense>
  )
}
