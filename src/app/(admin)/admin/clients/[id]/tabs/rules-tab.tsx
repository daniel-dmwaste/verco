'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'
import { upsertAllocationRules, upsertServiceRules } from '../../actions'

type Client = Database['public']['Tables']['client']['Row']

interface Category { id: string; name: string; code: string }
interface Service { id: string; name: string; category_id: string }

interface RulesTabProps {
  client: Client
  categories: Category[]
  services: Service[]
}

export function RulesTab({ client, categories, services }: RulesTabProps) {
  const router = useRouter()
  const supabase = createBrowserClient()

  // Fetch all areas for this client (we'll write rules to each)
  const { data: areas } = useQuery({
    queryKey: ['admin-collection-areas-ids', client.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('collection_area')
        .select('id, code')
        .eq('client_id', client.id)
        .eq('is_active', true)
        .order('code')
      return data ?? []
    },
  })

  // Fetch rules from the first area as the "template" (all areas should be identical)
  const firstAreaId = areas?.[0]?.id ?? null

  const { data: allocRules } = useQuery({
    queryKey: ['alloc-rules-template', firstAreaId],
    enabled: !!firstAreaId,
    queryFn: async () => {
      const { data } = await supabase
        .from('allocation_rules')
        .select('category_id, max_collections')
        .eq('collection_area_id', firstAreaId!)
      return data ?? []
    },
  })

  const { data: svcRules } = useQuery({
    queryKey: ['svc-rules-template', firstAreaId],
    enabled: !!firstAreaId,
    queryFn: async () => {
      const { data } = await supabase
        .from('service_rules')
        .select('service_id, max_collections, extra_unit_price')
        .eq('collection_area_id', firstAreaId!)
      return data ?? []
    },
  })

  const [allocValues, setAllocValues] = useState<Record<string, number>>({})
  const [svcValues, setSvcValues] = useState<Record<string, { max: number; price: number }>>({})
  const [initialised, setInitialised] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Initialise from fetched rules
  if (allocRules && svcRules && !initialised) {
    const aMap: Record<string, number> = {}
    for (const r of allocRules) aMap[r.category_id] = r.max_collections
    setAllocValues(aMap)

    const sMap: Record<string, { max: number; price: number }> = {}
    for (const r of svcRules) sMap[r.service_id] = { max: r.max_collections, price: Number(r.extra_unit_price) }
    setSvcValues(sMap)

    setInitialised(true)
  }

  async function handleSave() {
    if (!areas || areas.length === 0) {
      setError('No collection areas configured. Add at least one area first.')
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)

    const allocPayload = categories
      .filter((c) => (allocValues[c.id] ?? 0) > 0)
      .map((c) => ({ category_id: c.id, max_collections: allocValues[c.id] ?? 0 }))

    const svcPayload = services
      .filter((s) => (svcValues[s.id]?.max ?? 0) > 0 || (svcValues[s.id]?.price ?? 0) > 0)
      .map((s) => ({
        service_id: s.id,
        max_collections: svcValues[s.id]?.max ?? 0,
        extra_unit_price: svcValues[s.id]?.price ?? 0,
      }))

    // Write to ALL areas
    for (const area of areas) {
      const [allocResult, svcResult] = await Promise.all([
        upsertAllocationRules(area.id, allocPayload),
        upsertServiceRules(area.id, svcPayload),
      ])

      if (!allocResult.ok) { setError(`${area.code}: ${allocResult.error}`); setSaving(false); return }
      if (!svcResult.ok) { setError(`${area.code}: ${svcResult.error}`); setSaving(false); return }
    }

    setSaving(false)
    setSaved(true)
    router.refresh()
  }

  const ruleInputClass = 'w-20 rounded border border-gray-200 px-2 py-1.5 text-body-sm text-gray-900 outline-none focus:border-[#293F52]'

  return (
    <div className="max-w-3xl">
      <div className="mb-2 text-2xs text-gray-400">
        Rules apply to all {areas?.length ?? 0} active collection area{(areas?.length ?? 0) !== 1 ? 's' : ''} under this client.
      </div>

      {areas && areas.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-body-sm text-amber-800">
          No collection areas configured. Add areas in the Collection Areas tab before setting rules.
        </div>
      )}

      {/* Allocation Rules */}
      <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-3 text-2xs font-semibold uppercase tracking-wide text-gray-500">
          Allocation Rules (max collections per category per year)
        </div>
        <div className="flex flex-col gap-3">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-3">
              <span className="w-36 text-body-sm font-medium text-gray-700">{cat.name}</span>
              <input
                type="number"
                min={0}
                value={allocValues[cat.id] ?? 0}
                onChange={(e) => setAllocValues({ ...allocValues, [cat.id]: parseInt(e.target.value) || 0 })}
                className={ruleInputClass}
              />
              <span className="text-2xs text-gray-400">collections / year</span>
            </div>
          ))}
        </div>
      </div>

      {/* Service Rules */}
      <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-3 text-2xs font-semibold uppercase tracking-wide text-gray-500">
          Service Rules (max collections + extra unit pricing per service)
        </div>
        {categories.map((cat) => {
          const catServices = services.filter((s) => s.category_id === cat.id)
          if (catServices.length === 0) return null
          return (
            <div key={cat.id} className="mb-4 last:mb-0">
              <div className="mb-2 text-2xs font-medium text-gray-400">{cat.name}</div>
              <div className="flex flex-col gap-2">
                {catServices.map((svc) => (
                  <div key={svc.id} className="flex items-center gap-3 pl-2">
                    <span className="w-32 text-body-sm text-gray-700">{svc.name}</span>
                    <input
                      type="number"
                      min={0}
                      value={svcValues[svc.id]?.max ?? 0}
                      onChange={(e) => setSvcValues({
                        ...svcValues,
                        [svc.id]: { max: parseInt(e.target.value) || 0, price: svcValues[svc.id]?.price ?? 0 },
                      })}
                      className={ruleInputClass}
                    />
                    <span className="text-2xs text-gray-400">max</span>
                    <span className="text-body-sm text-gray-400">$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={svcValues[svc.id]?.price ?? 0}
                      onChange={(e) => setSvcValues({
                        ...svcValues,
                        [svc.id]: { max: svcValues[svc.id]?.max ?? 0, price: parseFloat(e.target.value) || 0 },
                      })}
                      className={ruleInputClass}
                    />
                    <span className="text-2xs text-gray-400">extra unit price</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-body-sm text-red-700">{error}</div>}
      {saved && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-body-sm text-emerald-700">Rules saved to all {areas?.length} areas.</div>}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !areas || areas.length === 0}
        className="rounded-lg bg-[#293F52] px-5 py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Rules'}
      </button>
    </div>
  )
}
