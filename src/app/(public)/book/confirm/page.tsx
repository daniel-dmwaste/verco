import { Suspense } from 'react'
import { ConfirmForm } from './confirm-form'

export default function ConfirmPage() {
  return (
    <Suspense>
      <ConfirmForm />
    </Suspense>
  )
}
