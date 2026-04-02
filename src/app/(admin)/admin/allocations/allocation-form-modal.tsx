'use client'

import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Dialog } from '@base-ui/react/dialog'
import { createClient } from '@/lib/supabase/client'
import { VercoButton } from '@/components/ui/verco-button'
import type { Database } from '@/lib/supabase/types'

type AllocationOverride = Database['public']['Tables']['allocation_override']['Row']

interface AllocationFormModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  override?: AllocationOverride | null
}

export function AllocationFormModal({ open, onOpenChange, onSave, override }: AllocationFormModalProps) {
  const supabase = createClient()
  const [userId, setUserId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    property_id: '',
    category_id: '',
    fy_id: '',
    set_remaining: '',
    reason: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [propertySearch, setPropertySearch] = useState('')
  const [showPropertyResults, setShowPropertyResults] = useState(false)

  // Fetch current user ID for created_by
  useEffect(() => {
    async function fetchUser() {
      const { data } = await supabase.auth.getUser()
      if (data.user) setUserId(data.user.id)
    }
    void fetchUser()
  }, [supabase])

  // Search properties (debounced by query key)
  const { data: properties } = useQuery({
    queryKey: ['eligible_properties_search', propertySearch],
    enabled: open && propertySearch.length >= 3 && !formData.property_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('eligible_properties')
        .select('id, formatted_address, address')
        .or(`formatted_address.ilike.%${propertySearch}%,address.ilike.%${propertySearch}%`)
        .order('formatted_address', { ascending: true })
        .limit(10)
      return data ?? []
    },
  })

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from('category')
        .select('id, name, code')
        .order('name', { ascending: true })
      return data ?? []
    },
  })

  // Fetch financial years
  const { data: financialYears } = useQuery({
    queryKey: ['financial_years'],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from('financial_year')
        .select('id, label')
        .order('label', { ascending: false })
      return data ?? []
    },
  })

  // Load override data if editing, reset if creating
  useEffect(() => {
    if (override) {
      setFormData({
        property_id: override.property_id,
        category_id: override.category_id,
        fy_id: override.fy_id,
        set_remaining: override.set_remaining.toString(),
        reason: override.reason,
      })
      setPropertySearch('') // Will show as disabled with address from parent
    } else {
      setFormData({ property_id: '', category_id: '', fy_id: '', set_remaining: '', reason: '' })
      setPropertySearch('')
    }
    setShowPropertyResults(false)
    setErrors({})
  }, [override, open])

  // Fetch display address for editing mode
  const { data: selectedProperty } = useQuery({
    queryKey: ['property_display', formData.property_id],
    enabled: !!formData.property_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('eligible_properties')
        .select('formatted_address, address')
        .eq('id', formData.property_id)
        .single()
      return data
    },
  })

  const selectedPropertyLabel = selectedProperty?.formatted_address || selectedProperty?.address || ''

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.property_id) newErrors.property_id = 'Property is required'
    if (!formData.category_id) newErrors.category_id = 'Category is required'
    if (!formData.fy_id) newErrors.fy_id = 'Financial year is required'
    if (!formData.set_remaining) newErrors.set_remaining = 'Remaining quantity is required'
    if (isNaN(Number(formData.set_remaining)) || Number(formData.set_remaining) < 0) {
      newErrors.set_remaining = 'Must be a valid non-negative number'
    }
    if (!formData.reason.trim()) newErrors.reason = 'Reason is required'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Create or update mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!validateForm()) throw new Error('Form validation failed')

      const payload = {
        property_id: formData.property_id,
        category_id: formData.category_id,
        fy_id: formData.fy_id,
        set_remaining: Number(formData.set_remaining),
        reason: formData.reason,
      }

      if (override) {
        // Update
        const { error } = await supabase
          .from('allocation_override')
          .update(payload)
          .eq('id', override.id)

        if (error) throw error
      } else {
        // Create — include created_by
        if (!userId) throw new Error('User session not found. Please refresh the page.')
        const { error } = await supabase
          .from('allocation_override')
          .insert({ ...payload, created_by: userId })

        if (error) throw error
      }
    },
    onSuccess: () => {
      onSave()
      onOpenChange(false)
    },
  })

  const inputClass =
    'w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-body text-gray-900 outline-none placeholder:text-gray-300 focus:border-[var(--brand)] focus:bg-white'
  const disabledInputClass =
    'w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-100 px-3.5 py-3 text-body text-gray-500 outline-none'
  const labelClass = 'mb-1 block text-xs font-medium text-gray-700'
  const errorClass = 'mt-1 text-[11px] text-red-500'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <Dialog.Title className="font-[family-name:var(--font-heading)] text-lg font-bold text-[var(--brand)]">
                {override ? 'Edit Allocation Override' : 'New Allocation Override'}
              </Dialog.Title>
              <Dialog.Close className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </Dialog.Close>
            </div>

            {/* Form */}
            <div className="px-6 py-4">
              <div className="flex flex-col gap-3">
                {/* Property — search input */}
                <div className="relative">
                  <label className={labelClass}>
                    Property<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  {override || formData.property_id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={selectedPropertyLabel}
                        disabled
                        className={disabledInputClass}
                      />
                      {!override && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, property_id: '' })
                            setPropertySearch('')
                            setShowPropertyResults(false)
                          }}
                          className="shrink-0 rounded-lg border-[1.5px] border-gray-100 bg-white px-2.5 py-2.5 text-xs text-gray-500 hover:bg-gray-50"
                          aria-label="Clear property selection"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={propertySearch}
                        onChange={(e) => {
                          setPropertySearch(e.target.value)
                          setShowPropertyResults(true)
                        }}
                        onFocus={() => propertySearch.length >= 3 && setShowPropertyResults(true)}
                        placeholder="Start typing an address..."
                        aria-label="Search for a property"
                        className={inputClass}
                      />
                      {showPropertyResults && properties && properties.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
                          {properties.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, property_id: p.id })
                                setPropertySearch('')
                                setShowPropertyResults(false)
                              }}
                              className="w-full px-3.5 py-2.5 text-left text-body-sm text-gray-900 hover:bg-gray-50"
                            >
                              {p.formatted_address || p.address}
                            </button>
                          ))}
                        </div>
                      )}
                      {propertySearch.length > 0 && propertySearch.length < 3 && (
                        <p className="mt-1 text-[11px] text-gray-400">Type at least 3 characters to search</p>
                      )}
                    </>
                  )}
                  {errors.property_id && <p className={errorClass}>{errors.property_id}</p>}
                </div>

                {/* Category */}
                <div>
                  <label className={labelClass}>
                    Category<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                    disabled={!!override}
                    className={override ? disabledInputClass : inputClass}
                  >
                    <option value="">Select a category</option>
                    {categories?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </select>
                  {errors.category_id && <p className={errorClass}>{errors.category_id}</p>}
                </div>

                {/* Financial Year */}
                <div>
                  <label className={labelClass}>
                    Financial Year<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <select
                    value={formData.fy_id}
                    onChange={(e) => setFormData({ ...formData, fy_id: e.target.value })}
                    disabled={!!override}
                    className={override ? disabledInputClass : inputClass}
                  >
                    <option value="">Select a financial year</option>
                    {financialYears?.map((fy) => (
                      <option key={fy.id} value={fy.id}>
                        {fy.label}
                      </option>
                    ))}
                  </select>
                  {errors.fy_id && <p className={errorClass}>{errors.fy_id}</p>}
                </div>

                {/* Set Remaining */}
                <div>
                  <label className={labelClass}>
                    Set Remaining Units<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.set_remaining}
                    onChange={(e) => setFormData({ ...formData, set_remaining: e.target.value })}
                    placeholder="0"
                    className={inputClass}
                  />
                  {errors.set_remaining && (
                    <p className={errorClass}>{errors.set_remaining}</p>
                  )}
                  <p className="mt-1 text-[11px] text-gray-400">
                    This overrides the current remaining count effective immediately
                  </p>
                </div>

                {/* Reason */}
                <div>
                  <label className={labelClass}>
                    Reason for Override<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="e.g., New owner reinstatement, Council credit, Correction of prior error..."
                    rows={3}
                    className={inputClass}
                  />
                  {errors.reason && <p className={errorClass}>{errors.reason}</p>}
                </div>
              </div>
            </div>

            {/* Error banner */}
            {saveMutation.error && (
              <div className="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-body-sm text-red-700">
                {saveMutation.error instanceof Error ? saveMutation.error.message : 'An error occurred'}
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
              <VercoButton
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </VercoButton>
              <VercoButton
                size="sm"
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : override ? 'Update' : 'Create'}
              </VercoButton>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
