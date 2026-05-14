'use client'

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { VercoButton } from '@/components/ui/verco-button'
import { createBugReport, type CreateBugReportInput } from '@/app/(admin)/admin/bug-reports/actions'

const FormSchema = z.object({
  title: z.string().min(3, 'Min 3 characters').max(150),
  description: z.string().max(4000).optional(),
  category: z.enum(['ui','data','performance','access','booking','collection','billing','other']),
  priority: z.enum(['low','medium','high','critical']),
})

type FormData = z.infer<typeof FormSchema>

const CATEGORIES: Array<{ value: FormData['category']; label: string }> = [
  { value: 'ui', label: 'UI / layout' },
  { value: 'data', label: 'Data / wrong info' },
  { value: 'booking', label: 'Booking flow' },
  { value: 'collection', label: 'Collection / schedule' },
  { value: 'billing', label: 'Billing / payments' },
  { value: 'access', label: 'Access / permissions' },
  { value: 'performance', label: 'Slow / broken' },
  { value: 'other', label: 'Other' },
]

const PRIORITIES: Array<{ value: FormData['priority']; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical — blocks me' },
]

interface BugReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BugReportDialog({ open, onOpenChange }: BugReportDialogProps) {
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting' }
    | { kind: 'success'; displayId: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: { category: 'ui', priority: 'medium' },
  })

  async function onSubmit(values: FormData) {
    setSubmitState({ kind: 'submitting' })

    const payload: CreateBugReportInput = {
      title: values.title,
      description: values.description,
      category: values.category,
      priority: values.priority,
      page_url: typeof window !== 'undefined' ? window.location.href : undefined,
      browser_info:
        typeof window !== 'undefined'
          ? `${navigator.userAgent} | ${window.innerWidth}x${window.innerHeight}`
          : undefined,
    }

    const result = await createBugReport(payload)
    if (result.ok) {
      setSubmitState({ kind: 'success', displayId: result.data.display_id })
      reset()
    } else {
      setSubmitState({ kind: 'error', message: result.error })
    }
  }

  function handleClose(next: boolean) {
    if (!next && submitState.kind === 'success') {
      setSubmitState({ kind: 'idle' })
    }
    onOpenChange(next)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-amber-50">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4M12 17h.01M10.29 3.86l-8.43 14.6A2 2 0 0 0 3.6 21.4h16.8a2 2 0 0 0 1.74-2.94l-8.43-14.6a2 2 0 0 0-3.42 0z" />
                </svg>
              </div>
              <div>
                <Dialog.Title className="text-subtitle font-semibold text-gray-900">
                  Report a bug
                </Dialog.Title>
                <p className="text-body-sm text-gray-500">
                  Captures the current page URL + browser automatically.
                </p>
              </div>
            </div>

            {submitState.kind === 'success' ? (
              <div className="rounded-lg bg-green-50 p-4 text-body-sm text-green-900">
                <p className="font-semibold">Reported {submitState.displayId} — thanks!</p>
                <p className="mt-1 text-green-700">
                  An aggregation cron picks new bugs up every 4 hours and files them in Linear with a proposed fix.
                </p>
                <div className="mt-4 flex justify-end">
                  <VercoButton type="button" onClick={() => handleClose(false)} variant="primary">
                    Done
                  </VercoButton>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="bug-title" className="block text-body-sm font-medium text-gray-700">
                    Title <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="bug-title"
                    type="text"
                    {...register('title')}
                    placeholder="One-line summary"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-body focus:border-[#293F52] focus:outline-none focus:ring-1 focus:ring-[#293F52]"
                    aria-invalid={!!errors.title}
                  />
                  {errors.title && (
                    <p role="alert" className="mt-1 text-body-sm text-red-600">{errors.title.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="bug-description" className="block text-body-sm font-medium text-gray-700">
                    What happened? <span className="text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    id="bug-description"
                    {...register('description')}
                    rows={4}
                    placeholder="Steps to reproduce, expected vs actual, anything we should know"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-body focus:border-[#293F52] focus:outline-none focus:ring-1 focus:ring-[#293F52]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="bug-category" className="block text-body-sm font-medium text-gray-700">
                      Category
                    </label>
                    <select
                      id="bug-category"
                      {...register('category')}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-body focus:border-[#293F52] focus:outline-none focus:ring-1 focus:ring-[#293F52]"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bug-priority" className="block text-body-sm font-medium text-gray-700">
                      Priority
                    </label>
                    <select
                      id="bug-priority"
                      {...register('priority')}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-body focus:border-[#293F52] focus:outline-none focus:ring-1 focus:ring-[#293F52]"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {submitState.kind === 'error' && (
                  <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-body-sm text-red-700">
                    {submitState.message}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <VercoButton
                    type="button"
                    variant="ghost"
                    onClick={() => handleClose(false)}
                    disabled={submitState.kind === 'submitting'}
                  >
                    Cancel
                  </VercoButton>
                  <VercoButton
                    type="submit"
                    variant="primary"
                    disabled={submitState.kind === 'submitting'}
                  >
                    {submitState.kind === 'submitting' ? 'Sending…' : 'Submit'}
                  </VercoButton>
                </div>
              </form>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
