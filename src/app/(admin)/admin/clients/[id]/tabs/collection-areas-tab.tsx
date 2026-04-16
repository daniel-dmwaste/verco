'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'
import { createCollectionArea, updateCollectionArea, upsertAllocationRules, upsertServiceRules } from '../../actions'

type Client = Database['public']['Tables']['client']['Row']

interface SubClient { id: string; name: string; code: string; is_active: boolean }
interface Category { id: string; name: string; code: string }
interface Service { id: string; name: string; category_id: string }

interface CollectionAreasTabProps {
  client: Client
  subClients: SubClient[]
  categories: Category[]
  services: Service[]
}

export function CollectionAreasTab({ client, subClients, categories, services }: CollectionAreasTabProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const supabase = createBrowserClient()

  const [showAddForm, setShowAddForm] = useState(false)
  const [addCode, setAddCode] = useState('')
  const [addName, setAddName] = useState('')
  const [addSubClientId, setAddSubClientId] = useState<string>('')
  const [addDmJobCode, setAddDmJobCode] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [expandedAreaId, setExpandedAreaId] = useState<string | null>(null)

  const { data: areas } = useQuery({
    queryKey: ['admin-collection-areas', client.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('collection_area')
        .select('id, code, name, sub_client_id, dm_job_code, is_active, eligible_properties(count)')
        .eq('client_id', client.id)
        .order('code')
      return data ?? []
    },
  })

  async function handleAdd() {
    setAddSaving(true)
    setAddError(null)
    const result = await createCollectionArea(client.id, {
      code: addCode,
      name: addName,
      sub_client_id: addSubClientId || null,
      dm_job_code: addDmJobCode || null,
    })
    setAddSaving(false)
    if (!result.ok) {
      setAddError(result.error)
      return
    }
    setShowAddForm(false)
    setAddCode('')
    setAddName('')
    setAddSubClientId('')
    setAddDmJobCode('')
    void queryClient.invalidateQueries({ queryKey: ['admin-collection-areas', client.id] })
    router.refresh()
  }

  const inputClass = 'rounded-lg border-[1.5px] border-gray-100 bg-gray-50 px-3 py-2 text-body-sm text-gray-900 outline-none focus:border-[#293F52] focus:bg-white'

  return (
    <div className="max-w-4xl">
      <div className="mb-2 text-2xs text-gray-400">Each area has its own allocation and service rules. Click an area to configure.</div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Code</th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Name</th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Sub-Client</th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Properties</th>
              <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody>
            {showAddForm && (
              <tr className="border-b border-gray-50 bg-blue-50/30">
                <td className="px-4 py-2"><input type="text" value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="Code" className={`${inputClass} w-24 font-mono`} /></td>
                <td className="px-4 py-2"><input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Name" className={inputClass} /></td>
                <td className="px-4 py-2">
                  <select value={addSubClientId} onChange={(e) => setAddSubClientId(e.target.value)} className={inputClass}>
                    <option value="">None</option>
                    {subClients.filter((sc) => sc.is_active).map((sc) => (
                      <option key={sc.id} value={sc.id}>{sc.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2 text-body-sm text-gray-400">&mdash;</td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={handleAdd} disabled={addSaving || !addCode || !addName} className="rounded bg-[#293F52] px-3 py-1 text-2xs font-semibold text-white disabled:opacity-50">
                      {addSaving ? '...' : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setShowAddForm(false); setAddError(null) }} className="rounded border border-gray-200 px-3 py-1 text-2xs text-gray-600">Cancel</button>
                  </div>
                  {addError && <p className="mt-1 text-2xs text-red-500">{addError}</p>}
                </td>
              </tr>
            )}
            {(!areas || areas.length === 0) && !showAddForm && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-body-sm text-gray-400">No collection areas configured</td></tr>
            )}
            {(areas ?? []).map((area) => {
              const subClient = subClients.find((sc) => sc.id === area.sub_client_id)
              const propCount = (area.eligible_properties as unknown as { count: number }[])?.[0]?.count ?? 0
              const isExpanded = expandedAreaId === area.id

              return (
                <AreaRow
                  key={area.id}
                  area={area}
                  subClientName={subClient?.name ?? null}
                  propCount={propCount}
                  isExpanded={isExpanded}
                  onToggle={() => setExpandedAreaId(isExpanded ? null : area.id)}
                  categories={categories}
                  services={services}
                  clientId={client.id}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      {!showAddForm && (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="mt-3 rounded-lg bg-[#293F52] px-4 py-2 text-body-sm font-semibold text-white"
        >
          + Add Area
        </button>
      )}
    </div>
  )
}

// ── Area Row with expandable rules ─────────────────────────────

interface AreaRowProps {
  area: { id: string; code: string; name: string; is_active: boolean }
  subClientName: string | null
  propCount: number
  isExpanded: boolean
  onToggle: () => void
  categories: Category[]
  services: Service[]
  clientId: string
}

function AreaRow({ area, subClientName, propCount, isExpanded, onToggle, categories, services, clientId }: AreaRowProps) {
  const supabase = createBrowserClient()
  const queryClient = useQueryClient()
  const router = useRouter()

  // Fetch rules when expanded
  const { data: allocRules } = useQuery({
    queryKey: ['alloc-rules', area.id],
    enabled: isExpanded,
    queryFn: async () => {
      const { data } = await supabase
        .from('allocation_rules')
        .select('id, category_id, max_collections')
        .eq('collection_area_id', area.id)
      return data ?? []
    },
  })

  const { data: svcRules } = useQuery({
    queryKey: ['svc-rules', area.id],
    enabled: isExpanded,
    queryFn: async () => {
      const { data } = await supabase
        .from('service_rules')
        .select('id, service_id, max_collections, extra_unit_price')
        .eq('collection_area_id', area.id)
      return data ?? []
    },
  })

  const [allocValues, setAllocValues] = useState<Record<string, number>>({})
  const [svcValues, setSvcValues] = useState<Record<string, { max: number; price: number }>>({})
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [rulesSaved, setRulesSaved] = useState(false)
  const [initialised, setInitialised] = useState(false)

  // Initialise form values from fetched rules
  if (isExpanded && allocRules && svcRules && !initialised) {
    const aMap: Record<string, number> = {}
    for (const r of allocRules) aMap[r.category_id] = r.max_collections
    setAllocValues(aMap)

    const sMap: Record<string, { max: number; price: number }> = {}
    for (const r of svcRules) sMap[r.service_id] = { max: r.max_collections, price: Number(r.extra_unit_price) }
    setSvcValues(sMap)

    setInitialised(true)
  }

  // Reset when collapsed
  if (!isExpanded && initialised) {
    setInitialised(false)
  }

  async function saveRules() {
    setRulesSaving(true)
    setRulesError(null)
    setRulesSaved(false)

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

    const [allocResult, svcResult] = await Promise.all([
      upsertAllocationRules(area.id, allocPayload),
      upsertServiceRules(area.id, svcPayload),
    ])

    setRulesSaving(false)

    if (!allocResult.ok) { setRulesError(allocResult.error); return }
    if (!svcResult.ok) { setRulesError(svcResult.error); return }

    setRulesSaved(true)
    void queryClient.invalidateQueries({ queryKey: ['alloc-rules', area.id] })
    void queryClient.invalidateQueries({ queryKey: ['svc-rules', area.id] })
    router.refresh()
  }

  const ruleInputClass = 'w-20 rounded border border-gray-200 px-2 py-1 text-body-sm text-gray-900 outline-none focus:border-[#293F52]'

  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-50 hover:bg-gray-50/50"
        onClick={onToggle}
      >
        <td className="px-4 py-3 font-mono text-body-sm font-semibold text-[#293F52]">{area.code}</td>
        <td className="px-4 py-3 text-body-sm text-gray-600">{area.name}</td>
        <td className="px-4 py-3 text-body-sm text-gray-400">{subClientName ?? '—'}</td>
        <td className="px-4 py-3 text-body-sm text-gray-600">{propCount.toLocaleString()}</td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${area.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {area.is_active ? 'Active' : 'Inactive'}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <td colSpan={5} className="px-6 py-4">
            {/* Allocation Rules */}
            <div className="mb-4">
              <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-gray-500">Allocation Rules (per category)</div>
              <div className="flex flex-col gap-2">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-3">
                    <span className="w-32 text-body-sm text-gray-700">{cat.name}</span>
                    <input
                      type="number"
                      min={0}
                      value={allocValues[cat.id] ?? 0}
                      onChange={(e) => setAllocValues({ ...allocValues, [cat.id]: parseInt(e.target.value) || 0 })}
                      className={ruleInputClass}
                    />
                    <span className="text-2xs text-gray-400">max collections/year</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Service Rules */}
            <div className="mb-4">
              <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-gray-500">Service Rules (per service)</div>
              <div className="flex flex-col gap-2">
                {categories.map((cat) => {
                  const catServices = services.filter((s) => s.category_id === cat.id)
                  if (catServices.length === 0) return null
                  return (
                    <div key={cat.id}>
                      <div className="mb-1 text-2xs font-medium text-gray-400">{cat.name}</div>
                      {catServices.map((svc) => (
                        <div key={svc.id} className="mb-1 flex items-center gap-3 pl-4">
                          <span className="w-28 text-body-sm text-gray-700">{svc.name}</span>
                          <input
                            type="number"
                            min={0}
                            value={svcValues[svc.id]?.max ?? 0}
                            onChange={(e) => setSvcValues({ ...svcValues, [svc.id]: { ...svcValues[svc.id], max: parseInt(e.target.value) || 0, price: svcValues[svc.id]?.price ?? 0 } })}
                            className={ruleInputClass}
                          />
                          <span className="text-2xs text-gray-400">max</span>
                          <span className="text-body-sm text-gray-400">$</span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={svcValues[svc.id]?.price ?? 0}
                            onChange={(e) => setSvcValues({ ...svcValues, [svc.id]: { max: svcValues[svc.id]?.max ?? 0, price: parseFloat(e.target.value) || 0 } })}
                            className={ruleInputClass}
                          />
                          <span className="text-2xs text-gray-400">extra unit price</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {rulesError && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-2xs text-red-700">{rulesError}</div>}
            {rulesSaved && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-2xs text-emerald-700">Rules saved.</div>}
            <button
              type="button"
              onClick={saveRules}
              disabled={rulesSaving}
              className="rounded-lg bg-[#293F52] px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
            >
              {rulesSaving ? 'Saving...' : 'Save Rules'}
            </button>
          </td>
        </tr>
      )}
    </>
  )
}
