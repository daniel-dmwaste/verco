import { Suspense } from 'react'
import { NothingPresentedClient } from './nothing-presented-client'

export default function NothingPresentedPage() {
  return (
    <Suspense>
      <NothingPresentedClient />
    </Suspense>
  )
}
