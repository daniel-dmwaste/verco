import { Suspense } from 'react'
import { PropertiesClient } from './properties-client'

export default function PropertiesPage() {
  return (
    <Suspense>
      <PropertiesClient />
    </Suspense>
  )
}
