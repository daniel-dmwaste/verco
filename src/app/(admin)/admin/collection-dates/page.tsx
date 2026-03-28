import { Suspense } from 'react'
import { CollectionDatesClient } from './collection-dates-client'

export default function CollectionDatesPage() {
  return (
    <Suspense>
      <CollectionDatesClient />
    </Suspense>
  )
}
