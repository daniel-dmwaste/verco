'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { SkeletonRow } from '@/components/ui/skeleton'
import { AllocationFormModal } from './allocation-form-modal'
import type { Database } from '@/lib/supabase/types'

type AllocationOverride = Database['public']['Tables']['allocation_override']['Row']

interface AllocationOverrideWithRelations extends AllocationOverride {
  eligible_properties: {
    address: string
    formatted_address: string | null
    collection_area_id: string
  }
  category: {
    name: string
    code: string
  }
  financial_year: {
    label: string
  }
  profiles: {
    email: string
  }
}

export function AllocationsList() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterFyId, setFilterFyId] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOverride, setEditingOverride] = useState<AllocationOverride | null>(null)

  const { data: overrides, isLoading } = useQuery({
    queryKey: ['allocation_overrides', filterFyId],
    queryFn: async () => {
      let query = supabase
        .from('allocation_override')
        .select(
          `*,
          eligible_properties!inner(address, formatted_address, collection_area_id),
          category(name, code),
          financial_year(label),
          profiles:created_by(email)`
        )

      if (filterFyId) {
        query = query.eq('fy_id', filterFyId)
      }

      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AllocationOverrideWithRelations[]
    },
  })

  const { data: financialYears } = useQuery({
    queryKey: ['financial_years'],
    queryFn: async () => {
      const { data } = await supabase
        .from('financial_year')
        .select('id, label')
        .order('label', { ascending: false })
      return data ?? []
    },
  })

  const filtered = overrides?.filter((o) => {
    if (!search) return true
    const s = search.toLowerCase()
    const address = (o.eligible_properties.formatted_address || o.eligible_properties.address).toLowerCase()
    return address.includes(s) || o.category?.name.toLowerCase().includes(s) || o.reason.toLowerCase().includes(s)
  })

  const total = filtered?.length ?? 0

  const handleNewOverride = useCallback(() => {
    setEditingOverride(null)
    setModalOpen(true)
  }, [])

  const handleEditOverride = useCallback((override: AllocationOverrideWithRelations) => {
    setEditingOverride(override)
    setModalOpen(true)
  }, [])

  const handleDeleteOverride = useCallback(async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this allocation override?')) return
    const { error } = await supabase.from('allocation_override').delete().eq('id', id)
    if (error) {
      alert(`Failed to delete: ${error.message}`)
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['allocation_overrides'] })
  }, [supabase, queryClient])

  const handleSave = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['allocation_overrides'] })
  }, [queryClient])

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-white px-7 pb-5 pt-6">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[#293F52]">
            Allocation Overrides
          </h1>
          <p className="mt-0.5 text-body-sm text-gray-500">
            {total} override{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewOverride}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#293F52] px-4 py-2 text-body-sm font-semibold text-white"
        >
          + New Override
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2.5 px-7 py-4">
        <div className="flex w-60 items-center gap-2 rounded-lg border-[1.5px] border-gray-100 bg-white px-3 py-[7px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B0B0B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address, category, reason..."
            aria-label="Search allocation overrides"
            className="w-full border-none bg-transparent text-body-sm text-gray-900 outline-none placeholder:text-gray-300"
          />
        </div>

        <select
          value={filterFyId}
          onChange={(e) => setFilterFyId(e.target.value)}
          aria-label="Filter by financial year"
          className="rounded-lg border-[1.5px] border-gray-100 bg-white px-3 py-[7px] text-body-sm text-gray-700"
        >
          <option value="">All Financial Years</option>
          {financialYears?.map((fy) => (
            <option key={fy.id} value={fy.id}>{fy.label}</option>
          ))}
        </select>

        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {total} result{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 px-7 pb-6">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Property</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Category</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">FY</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Set Remaining</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reason</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Created By</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Date</th>
                <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} columns={8} />
              ))}
              {!isLoading && total === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">No allocation overrides found</td></tr>
              )}
              {filtered?.map((override) => (
                <tr key={override.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                  <td className="max-w-[200px] truncate px-4 py-3 text-body-sm font-medium text-gray-900">
                    {override.eligible_properties.formatted_address || override.eligible_properties.address}
                  </td>
                  <td className="px-4 py-3 text-body-sm text-gray-700">
                    {override.category?.name}
                  </td>
                  <td className="px-4 py-3 text-body-sm text-gray-700">
                    {override.financial_year?.label}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-[#293F52]">
                      {override.set_remaining}
                    </span>
                  </td>
                  <td className="max-w-[180px] truncate px-4 py-3 text-body-sm text-gray-700">
                    {override.reason}
                  </td>
                  <td className="px-4 py-3 text-body-sm text-gray-500">
                    {override.profiles?.email}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(override.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditOverride(override)}
                        className="inline-flex items-center rounded-md border-[1.5px] border-gray-100 bg-white px-3 py-1 text-xs font-semibold text-[#293F52]"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDeleteOverride(override.id)}
                        className="inline-flex items-center rounded-md border-[1.5px] border-gray-100 bg-white px-3 py-1 text-xs font-semibold text-[#E53E3E]"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <AllocationFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={handleSave}
        override={editingOverride}
      />
    </>
  )
}
