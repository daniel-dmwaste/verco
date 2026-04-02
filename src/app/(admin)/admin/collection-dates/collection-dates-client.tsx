'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, addDays, addWeeks, addMonths } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { SkeletonRow } from '@/components/ui/skeleton'

const PAGE_SIZE = 50

function capacityColor(booked: number, limit: number): string {
  if (limit === 0) return 'bg-gray-200'
  const pct = (booked / limit) * 100
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 60) return 'bg-amber-400'
  return 'bg-emerald-500'
}

function capacityBgColor(booked: number, limit: number): string {
  if (limit === 0) return 'bg-gray-100'
  const pct = (booked / limit) * 100
  if (pct >= 90) return 'bg-red-100'
  if (pct >= 60) return 'bg-amber-100'
  return 'bg-emerald-100'
}

type Frequency = 'weekly' | 'fortnightly' | 'monthly'

export function CollectionDatesClient() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(0)
  const [showPast, setShowPast] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showBulkCreate, setShowBulkCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Create form state
  const [createAreaId, setCreateAreaId] = useState('')
  const [createDate, setCreateDate] = useState('')
  const [createForMud, setCreateForMud] = useState(false)
  const [createBulkLimit, setCreateBulkLimit] = useState(60)
  const [createAncLimit, setCreateAncLimit] = useState(60)
  const [createIdLimit, setCreateIdLimit] = useState(10)
  const [createIsOpen, setCreateIsOpen] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  // Bulk create state
  const [bulkAreaId, setBulkAreaId] = useState('')
  const [bulkStartDate, setBulkStartDate] = useState('')
  const [bulkCount, setBulkCount] = useState(4)
  const [bulkFrequency, setBulkFrequency] = useState<Frequency>('weekly')
  const [bulkBulkLimit, setBulkBulkLimit] = useState(60)
  const [bulkAncLimit, setBulkAncLimit] = useState(60)
  const [bulkIdLimit, setBulkIdLimit] = useState(10)
  const [showBulkPreview, setShowBulkPreview] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [isBulkCreating, setIsBulkCreating] = useState(false)

  // Edit state
  const [editBulkLimit, setEditBulkLimit] = useState(60)
  const [editAncLimit, setEditAncLimit] = useState(60)
  const [editIdLimit, setEditIdLimit] = useState(10)
  const [editIsOpen, setEditIsOpen] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Fetch areas
  const { data: areas } = useQuery({
    queryKey: ['collection-areas'],
    queryFn: async () => {
      const { data } = await supabase
        .from('collection_area')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code')
      return data ?? []
    },
  })

  // Fetch collection dates
  const today = format(new Date(), 'yyyy-MM-dd')
  const { data: datesData, isLoading } = useQuery({
    queryKey: ['admin-collection-dates', showPast, page],
    queryFn: async () => {
      let query = supabase
        .from('collection_date')
        .select(
          'id, date, is_open, for_mud, bulk_capacity_limit, bulk_units_booked, bulk_is_closed, anc_capacity_limit, anc_units_booked, anc_is_closed, id_capacity_limit, id_units_booked, id_is_closed, collection_area_id, collection_area!inner(name, code)',
          { count: 'exact' }
        )
        .order('date', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (!showPast) {
        query = query.gte('date', today)
      }

      const { data, count } = await query
      return { dates: data ?? [], total: count ?? 0 }
    },
  })

  const dates = datesData?.dates ?? []
  const total = datesData?.total ?? 0

  function generateBulkDates(): string[] {
    if (!bulkStartDate || bulkCount <= 0) return []
    const result: string[] = []
    let current = new Date(bulkStartDate + 'T00:00:00')
    for (let i = 0; i < bulkCount; i++) {
      result.push(format(current, 'yyyy-MM-dd'))
      if (bulkFrequency === 'weekly') current = addWeeks(current, 1)
      else if (bulkFrequency === 'fortnightly') current = addWeeks(current, 2)
      else current = addMonths(current, 1)
    }
    return result
  }

  async function handleCreate() {
    if (!createAreaId || !createDate) return
    setIsCreating(true)
    setCreateError(null)

    const { error } = await supabase.from('collection_date').insert({
      collection_area_id: createAreaId,
      date: createDate,
      for_mud: createForMud,
      bulk_capacity_limit: createBulkLimit,
      anc_capacity_limit: createAncLimit,
      id_capacity_limit: createIdLimit,
      is_open: createIsOpen,
    })

    setIsCreating(false)
    if (error) {
      setCreateError(error.message)
      return
    }

    setShowCreate(false)
    setCreateDate('')
    setCreateForMud(false)
    void queryClient.invalidateQueries({ queryKey: ['admin-collection-dates'] })
  }

  async function handleBulkCreate() {
    if (!bulkAreaId || !bulkStartDate) return
    const bulkDates = generateBulkDates()
    if (bulkDates.length === 0) return

    setIsBulkCreating(true)
    setBulkError(null)

    const rows = bulkDates.map((date) => ({
      collection_area_id: bulkAreaId,
      date,
      for_mud: false,
      bulk_capacity_limit: bulkBulkLimit,
      anc_capacity_limit: bulkAncLimit,
      id_capacity_limit: bulkIdLimit,
      is_open: true,
    }))

    const { error } = await supabase.from('collection_date').insert(rows)

    setIsBulkCreating(false)
    if (error) {
      setBulkError(error.message)
      return
    }

    setShowBulkCreate(false)
    setShowBulkPreview(false)
    setBulkStartDate('')
    void queryClient.invalidateQueries({ queryKey: ['admin-collection-dates'] })
  }

  function startEdit(d: (typeof dates)[number]) {
    setEditingId(d.id)
    setEditBulkLimit(d.bulk_capacity_limit)
    setEditAncLimit(d.anc_capacity_limit)
    setEditIdLimit(d.id_capacity_limit)
    setEditIsOpen(d.is_open)
  }

  async function handleSaveEdit(id: string) {
    setIsSaving(true)
    await supabase
      .from('collection_date')
      .update({
        bulk_capacity_limit: editBulkLimit,
        anc_capacity_limit: editAncLimit,
        id_capacity_limit: editIdLimit,
        is_open: editIsOpen,
      })
      .eq('id', id)

    setIsSaving(false)
    setEditingId(null)
    void queryClient.invalidateQueries({ queryKey: ['admin-collection-dates'] })
  }

  async function handleDelete(d: (typeof dates)[number]) {
    if (d.bulk_units_booked > 0 || d.anc_units_booked > 0 || d.id_units_booked > 0) return
    if (!confirm(`Delete collection date ${format(new Date(d.date + 'T00:00:00'), 'EEE d MMM yyyy')}?`)) return

    await supabase.from('collection_date').delete().eq('id', d.id)
    void queryClient.invalidateQueries({ queryKey: ['admin-collection-dates'] })
  }

  const bulkPreviewDates = showBulkPreview ? generateBulkDates() : []

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[#293F52]">
            Collection Dates
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage collection date capacity and availability
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPast((p) => !p)}
            className={`rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors ${
              showPast
                ? 'border-[#293F52] bg-[#293F52] text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {showPast ? 'Hide past dates' : 'Show past dates'}
          </button>
          <button
            type="button"
            onClick={() => { setShowBulkCreate((p) => !p); setShowCreate(false) }}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
          >
            Bulk Create
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate((p) => !p); setShowBulkCreate(false) }}
            className="rounded-lg bg-[#00E47C] px-4 py-2 text-[13px] font-semibold text-[#293F52]"
          >
            + New Date
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-[#293F52]">Create Collection Date</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Collection Area</label>
              <select value={createAreaId} onChange={(e) => setCreateAreaId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="">Select area</option>
                {(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
              <input type="date" value={createDate} onChange={(e) => setCreateDate(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={createForMud} onChange={(e) => setCreateForMud(e.target.checked)} className="rounded" />
                MUD date
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={createIsOpen} onChange={(e) => setCreateIsOpen(e.target.checked)} className="rounded" />
                Open
              </label>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Bulk Limit</label>
              <input type="number" value={createBulkLimit} onChange={(e) => setCreateBulkLimit(Number(e.target.value))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">ANC Limit</label>
              <input type="number" value={createAncLimit} onChange={(e) => setCreateAncLimit(Number(e.target.value))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">ID Limit</label>
              <input type="number" value={createIdLimit} onChange={(e) => setCreateIdLimit(Number(e.target.value))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={handleCreate} disabled={isCreating || !createAreaId || !createDate} className="rounded-lg bg-[#293F52] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {isCreating ? 'Creating...' : 'Create Date'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk create form */}
      {showBulkCreate && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-[#293F52]">Bulk Create Collection Dates</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Collection Area</label>
              <select value={bulkAreaId} onChange={(e) => setBulkAreaId(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="">Select area</option>
                {(areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Start Date</label>
              <input type="date" value={bulkStartDate} onChange={(e) => { setBulkStartDate(e.target.value); setShowBulkPreview(false) }} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Number of Dates</label>
              <input type="number" min={1} max={52} value={bulkCount} onChange={(e) => { setBulkCount(Number(e.target.value)); setShowBulkPreview(false) }} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Frequency</label>
              <select value={bulkFrequency} onChange={(e) => { setBulkFrequency(e.target.value as Frequency); setShowBulkPreview(false) }} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Bulk Limit</label>
              <input type="number" value={bulkBulkLimit} onChange={(e) => setBulkBulkLimit(Number(e.target.value))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">ANC Limit</label>
              <input type="number" value={bulkAncLimit} onChange={(e) => setBulkAncLimit(Number(e.target.value))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">ID Limit</label>
              <input type="number" value={bulkIdLimit} onChange={(e) => setBulkIdLimit(Number(e.target.value))} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
          </div>
          {!showBulkPreview && (
            <button type="button" onClick={() => setShowBulkPreview(true)} disabled={!bulkAreaId || !bulkStartDate || bulkCount <= 0} className="mt-3 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 disabled:opacity-50">
              Preview Dates
            </button>
          )}
          {showBulkPreview && bulkPreviewDates.length > 0 && (
            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-500">{bulkPreviewDates.length} dates will be created:</div>
              <div className="flex flex-wrap gap-1.5">
                {bulkPreviewDates.map((d) => (
                  <span key={d} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-[#293F52] shadow-sm">
                    {format(new Date(d + 'T00:00:00'), 'EEE d MMM yyyy')}
                  </span>
                ))}
              </div>
            </div>
          )}
          {bulkError && <p className="mt-2 text-sm text-red-600">{bulkError}</p>}
          <div className="mt-3 flex gap-2">
            {showBulkPreview && (
              <button type="button" onClick={handleBulkCreate} disabled={isBulkCreating} className="rounded-lg bg-[#293F52] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {isBulkCreating ? 'Creating...' : `Create ${bulkPreviewDates.length} Dates`}
              </button>
            )}
            <button type="button" onClick={() => { setShowBulkCreate(false); setShowBulkPreview(false) }} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Area</th>
              <th className="px-4 py-3 text-center">Type</th>
              <th className="px-4 py-3 text-center">Open</th>
              <th className="px-4 py-3">Bulk</th>
              <th className="px-4 py-3">ANC</th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>{Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} columns={8} />
              ))}</>
            ) : dates.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No collection dates found</td></tr>
            ) : (
              dates.map((d) => {
                const area = d.collection_area as { name: string; code: string }
                const isPast = d.date < today
                const isEditing = editingId === d.id
                const hasBookings = d.bulk_units_booked > 0 || d.anc_units_booked > 0 || d.id_units_booked > 0

                if (isEditing) {
                  return (
                    <tr key={d.id} className="border-b border-gray-50 bg-blue-50/50">
                      <td className="px-4 py-2.5 font-medium text-[#293F52]">{format(new Date(d.date + 'T00:00:00'), 'EEE d MMM yyyy')}</td>
                      <td className="px-4 py-2.5 text-gray-600">{area.code}</td>
                      <td className="px-4 py-2.5 text-center">{d.for_mud && <span className="rounded-full bg-[#F3EEFF] px-2 py-0.5 text-[10px] font-semibold text-[#805AD5]">MUD</span>}</td>
                      <td className="px-4 py-2.5 text-center">
                        <input type="checkbox" checked={editIsOpen} onChange={(e) => setEditIsOpen(e.target.checked)} className="rounded" />
                      </td>
                      <td className="px-4 py-2.5"><input type="number" value={editBulkLimit} onChange={(e) => setEditBulkLimit(Number(e.target.value))} className="w-16 rounded border border-gray-200 px-2 py-1 text-xs" /></td>
                      <td className="px-4 py-2.5"><input type="number" value={editAncLimit} onChange={(e) => setEditAncLimit(Number(e.target.value))} className="w-16 rounded border border-gray-200 px-2 py-1 text-xs" /></td>
                      <td className="px-4 py-2.5"><input type="number" value={editIdLimit} onChange={(e) => setEditIdLimit(Number(e.target.value))} className="w-16 rounded border border-gray-200 px-2 py-1 text-xs" /></td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => handleSaveEdit(d.id)} disabled={isSaving} className="mr-1 text-xs font-semibold text-[#00B864]">{isSaving ? 'Saving...' : 'Save'}</button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-400">Cancel</button>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={d.id} className={`border-b border-gray-50 ${isPast ? 'bg-gray-50/50 text-gray-400' : ''}`}>
                    <td className={`px-4 py-2.5 font-medium ${isPast ? 'text-gray-400' : 'text-[#293F52]'}`}>
                      {format(new Date(d.date + 'T00:00:00'), 'EEE d MMM yyyy')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{area.code}</td>
                    <td className="px-4 py-2.5 text-center">
                      {d.for_mud && <span className="rounded-full bg-[#F3EEFF] px-2 py-0.5 text-[10px] font-semibold text-[#805AD5]">MUD</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {d.is_open ? (
                        <span className="inline-block size-2 rounded-full bg-emerald-500" title="Open" />
                      ) : (
                        <span className="inline-block size-2 rounded-full bg-gray-300" title="Closed" />
                      )}
                    </td>
                    {/* Bulk capacity */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className={`h-1.5 w-16 overflow-hidden rounded-full ${capacityBgColor(d.bulk_units_booked, d.bulk_capacity_limit)}`}>
                          <div className={`h-full rounded-full ${capacityColor(d.bulk_units_booked, d.bulk_capacity_limit)}`} style={{ width: `${Math.min(100, d.bulk_capacity_limit > 0 ? (d.bulk_units_booked / d.bulk_capacity_limit) * 100 : 0)}%` }} />
                        </div>
                        <span className="text-[11px] text-gray-500">{d.bulk_units_booked}/{d.bulk_capacity_limit}</span>
                        {d.bulk_is_closed && <span className="rounded bg-red-100 px-1 py-px text-[9px] font-semibold text-red-600">Closed</span>}
                      </div>
                    </td>
                    {/* ANC capacity */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className={`h-1.5 w-16 overflow-hidden rounded-full ${capacityBgColor(d.anc_units_booked, d.anc_capacity_limit)}`}>
                          <div className={`h-full rounded-full ${capacityColor(d.anc_units_booked, d.anc_capacity_limit)}`} style={{ width: `${Math.min(100, d.anc_capacity_limit > 0 ? (d.anc_units_booked / d.anc_capacity_limit) * 100 : 0)}%` }} />
                        </div>
                        <span className="text-[11px] text-gray-500">{d.anc_units_booked}/{d.anc_capacity_limit}</span>
                        {d.anc_is_closed && <span className="rounded bg-red-100 px-1 py-px text-[9px] font-semibold text-red-600">Closed</span>}
                      </div>
                    </td>
                    {/* ID capacity */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <div className={`h-1.5 w-16 overflow-hidden rounded-full ${capacityBgColor(d.id_units_booked, d.id_capacity_limit)}`}>
                          <div className={`h-full rounded-full ${capacityColor(d.id_units_booked, d.id_capacity_limit)}`} style={{ width: `${Math.min(100, d.id_capacity_limit > 0 ? (d.id_units_booked / d.id_capacity_limit) * 100 : 0)}%` }} />
                        </div>
                        <span className="text-[11px] text-gray-500">{d.id_units_booked}/{d.id_capacity_limit}</span>
                        {d.id_is_closed && <span className="rounded bg-red-100 px-1 py-px text-[9px] font-semibold text-red-600">Closed</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => startEdit(d)} className="mr-2 text-xs font-medium text-[#293F52] hover:underline">Edit</button>
                      <button
                        type="button"
                        onClick={() => handleDelete(d)}
                        disabled={hasBookings}
                        title={hasBookings ? 'Cannot delete — bookings exist' : 'Delete'}
                        className={`text-xs font-medium ${hasBookings ? 'cursor-not-allowed text-gray-300' : 'text-red-500 hover:underline'}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>
            Showing {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium disabled:opacity-30">
              Previous
            </button>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium disabled:opacity-30">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
