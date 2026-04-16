'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fetchAuditLogs } from './actions'

const TABLE_OPTIONS = [
  { value: '', label: 'All Tables' },
  { value: 'booking', label: 'Booking' },
  { value: 'booking_item', label: 'Service Item' },
  { value: 'non_conformance_notice', label: 'NCN' },
  { value: 'nothing_presented', label: 'Nothing Presented' },
  { value: 'service_ticket', label: 'Ticket' },
  { value: 'ticket_response', label: 'Response' },
  { value: 'collection_date', label: 'Collection Date' },
  { value: 'contacts', label: 'Contact' },
  { value: 'eligible_properties', label: 'Property' },
  { value: 'strata_user_properties', label: 'MUD Link' },
]

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'INSERT', label: 'Created' },
  { value: 'UPDATE', label: 'Updated' },
  { value: 'DELETE', label: 'Deleted' },
]

const PAGE_SIZE = 50

export function AuditLogClient() {
  const [tableName, setTableName] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)

  const { data: result, isLoading } = useQuery({
    queryKey: ['audit-log', tableName, action, page],
    queryFn: () =>
      fetchAuditLogs({
        tableName: tableName || undefined,
        action: action || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  })

  const entries = result?.ok ? result.data : []
  const total = result?.ok ? result.total : 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const actionBadge = (a: string) => {
    switch (a) {
      case 'INSERT':
        return <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-700">Created</span>
      case 'UPDATE':
        return <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-2xs font-semibold text-blue-700">Updated</span>
      case 'DELETE':
        return <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-2xs font-semibold text-red-700">Deleted</span>
      default:
        return <span className="text-2xs text-gray-500">{a}</span>
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white px-7 pb-5 pt-6">
        <h1 className="font-[family-name:var(--font-heading)] text-xl font-bold text-[#293F52]">
          Audit Log
        </h1>
        <p className="mt-0.5 text-body-sm text-gray-500">
          {total} {total === 1 ? 'entry' : 'entries'}
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 bg-white px-7 py-3">
        <select
          value={tableName}
          onChange={(e) => { setTableName(e.target.value); setPage(0) }}
          className="rounded-lg border-[1.5px] border-gray-100 bg-gray-50 px-3 py-2 text-body-sm text-gray-700 outline-none focus:border-[#293F52] focus:bg-white"
        >
          {TABLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0) }}
          className="rounded-lg border-[1.5px] border-gray-100 bg-gray-50 px-3 py-2 text-body-sm text-gray-700 outline-none focus:border-[#293F52] focus:bg-white"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 px-7 pb-6">
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">When</th>
                <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Action</th>
                <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Summary</th>
                <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">By</th>
                <th className="px-4 py-3 text-left text-2xs font-semibold uppercase tracking-wider text-gray-400">Changes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {!isLoading && entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-body-sm text-gray-400">
                    No audit entries found
                  </td>
                </tr>
              )}
              {!isLoading && entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} actionBadge={actionBadge} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-body-sm text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-body-sm font-medium text-gray-700 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-body-sm font-medium text-gray-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AuditRow({
  entry,
  actionBadge,
}: {
  entry: { id: string; action: string; summary: string; actorName: string | null; createdAt: string; changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> }
  actionBadge: (a: string) => React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/50">
        <td className="whitespace-nowrap px-4 py-3 text-body-sm text-gray-600">
          {format(new Date(entry.createdAt), 'd MMM yyyy, h:mmaaa')}
        </td>
        <td className="px-4 py-3">{actionBadge(entry.action)}</td>
        <td className="px-4 py-3 text-body-sm font-medium text-gray-900">{entry.summary}</td>
        <td className="px-4 py-3 text-body-sm text-gray-600">
          {entry.actorName ?? <span className="italic text-gray-400">System</span>}
        </td>
        <td className="px-4 py-3">
          {entry.changes.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="text-2xs font-medium text-[#293F52] hover:underline"
            >
              {expanded ? 'Hide' : `${entry.changes.length} ${entry.changes.length === 1 ? 'field' : 'fields'}`}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-50 bg-gray-50/30">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-col gap-1 pl-4">
              {entry.changes.map((change, i) => (
                <div key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-700">{change.field}:</span>{' '}
                  {entry.action === 'DELETE' ? (
                    <span className="text-red-500 line-through">{change.oldValue ?? '—'}</span>
                  ) : entry.action === 'INSERT' ? (
                    <span>{change.newValue ?? '—'}</span>
                  ) : (
                    <>
                      <span className="text-gray-400">{change.oldValue ?? '—'}</span>
                      <span className="mx-1 text-gray-300">&rarr;</span>
                      <span>{change.newValue ?? '—'}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
