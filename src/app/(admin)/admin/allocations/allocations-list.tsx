'use client'

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { SkeletonRow } from '@/components/ui/skeleton'
import { VercoButton } from '@/components/ui/verco-button'
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

  // Fetch all allocation overrides
  const { data: overrides, isLoading, error } = useQuery({
    queryKey: ['allocation_overrides', filterFyId],
    queryFn: async () => {
      let query = supabase
        .from('allocation_override')
        .select(
          `
          *,
          eligible_properties!inner(address, formatted_address, collection_area_id),
          category(name, code),
          financial_year(label),
          profiles:created_by(email)
          `
        )

      if (filterFyId) {
        query = query.eq('fy_id', filterFyId)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) throw error
      return (data ?? []) as unknown as AllocationOverrideWithRelations[]
    },
  })

  // Fetch financial years for filter dropdown
  const { data: financialYears } = useQuery({
    queryKey: ['financial_years'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_year')
        .select('id, label')
        .order('label', { ascending: false })

      if (error) throw error
      return data ?? []
    },
  })

  const filtered = overrides?.filter((o) => {
    const searchLower = search.toLowerCase()
    const address = (o.eligible_properties.formatted_address ||
      o.eligible_properties.address).toLowerCase()
    const catName = o.category?.name.toLowerCase() ?? ''
    return (
      address.includes(searchLower) ||
      catName.includes(searchLower) ||
      o.reason.toLowerCase().includes(searchLower)
    )
  })

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
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-col gap-3 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div />
          <VercoButton size="sm" onClick={handleNewOverride}>
            + New Override
          </VercoButton>
        </div>

        <div className="flex flex-col gap-3 md:flex-row">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address, category, or reason..."
            aria-label="Search allocation overrides"
            className="flex-1 rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-body text-gray-900 outline-none placeholder:text-gray-300 focus:border-[var(--brand)] focus:bg-white"
          />

          <select
            value={filterFyId}
            onChange={(e) => setFilterFyId(e.target.value)}
            aria-label="Filter by financial year"
            className="rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-body text-gray-900 outline-none focus:border-[var(--brand)] focus:bg-white md:w-56"
          >
            <option value="">All financial years</option>
            {financialYears?.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-xl bg-white shadow-sm">
        {error ? (
          <div className="flex items-center gap-2 px-6 py-8 text-body-sm text-red-600">
            <span>Error loading overrides: {error instanceof Error ? error.message : 'Unknown error'}</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Property</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Category</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">FY</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-gray-500">Set Remaining</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reason</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Created By</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">Date</th>
                  <th className="border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <>
                    <SkeletonRow columns={8} />
                    <SkeletonRow columns={8} />
                    <SkeletonRow columns={8} />
                    <SkeletonRow columns={8} />
                    <SkeletonRow columns={8} />
                  </>
                ) : filtered && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-body-sm text-gray-500">
                      No allocation overrides found
                    </td>
                  </tr>
                ) : (
                  filtered?.map((override) => (
                    <tr key={override.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-body-sm font-medium text-gray-900">
                        {override.eligible_properties.formatted_address ||
                          override.eligible_properties.address}
                      </td>
                      <td className="px-4 py-3 text-body-sm text-gray-700">
                        {override.category?.name}
                      </td>
                      <td className="px-4 py-3 text-body-sm text-gray-700">
                        {override.financial_year?.label}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-3 py-1 text-body-sm font-semibold text-[var(--brand)]">
                          {override.set_remaining}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-body-sm text-gray-700">
                        {override.reason}
                      </td>
                      <td className="px-4 py-3 text-body-sm text-gray-700">
                        {override.profiles?.email}
                      </td>
                      <td className="px-4 py-3 text-body-sm text-gray-700">
                        {new Date(override.created_at).toLocaleDateString('en-AU', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => handleEditOverride(override)}
                            className="text-body-sm font-medium text-[var(--brand)] hover:opacity-70"
                          >
                            Edit
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => void handleDeleteOverride(override.id)}
                            className="text-body-sm font-medium text-red-600 hover:opacity-70"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <AllocationFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={handleSave}
        override={editingOverride}
      />
    </div>
  )
}
