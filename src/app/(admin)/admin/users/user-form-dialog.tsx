'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@base-ui/react/dialog'
import { createClient } from '@/lib/supabase/client'
import { normaliseAuMobile, formatAuMobileDisplay } from '@/lib/booking/schemas'
import type { Database } from '@/lib/supabase/types'

type AppRole = Database['public']['Enums']['app_role']

const CONTRACTOR_ROLES: AppRole[] = ['contractor-admin', 'contractor-staff', 'field']
const CLIENT_ROLES: AppRole[] = ['client-admin', 'client-staff', 'ranger']

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: 'contractor-admin', label: 'Contractor Admin' },
  { value: 'contractor-staff', label: 'Contractor Staff' },
  { value: 'field', label: 'Contractor Field' },
  { value: 'client-admin', label: 'Client Admin' },
  { value: 'client-staff', label: 'Client Staff' },
  { value: 'ranger', label: 'Client Ranger' },
]

const UserFormSchema = z
  .object({
    full_name: z.string().min(1, 'Name is required').max(200),
    email: z.string().email('Please enter a valid email'),
    mobile_e164: z
      .string()
      .transform((val) => val.replace(/[\s\-()]+/g, ''))
      .refine(
        (val) => val === '' || normaliseAuMobile(val) !== null,
        'Please enter a valid AU mobile (e.g. 0412 345 678)'
      )
      .transform((val) => (val ? normaliseAuMobile(val) ?? '' : ''))
      .optional(),
    role: z.enum([
      'contractor-admin', 'contractor-staff', 'field',
      'client-admin', 'client-staff', 'ranger',
      'resident', 'strata',
    ] as const),
    tenant_id: z.string().uuid().or(z.literal('')).optional(),
  })
  .superRefine((data, ctx) => {
    if (CONTRACTOR_ROLES.includes(data.role as AppRole) && !data.tenant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please select a contractor.',
        path: ['tenant_id'],
      })
    }
    if (CLIENT_ROLES.includes(data.role as AppRole) && !data.tenant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please select a client.',
        path: ['tenant_id'],
      })
    }
  })

type UserFormData = z.infer<typeof UserFormSchema>

export interface EditUserData {
  user_id: string
  full_name: string
  email: string
  mobile_e164: string | null
  role: AppRole
  contractor_id: string | null
  client_id: string | null
}

interface UserFormDialogProps {
  callerRole: AppRole
  /** If provided, dialog is in edit mode with pre-filled data */
  editData?: EditUserData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserFormDialog({ callerRole, editData, open, onOpenChange }: UserFormDialogProps) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const isEdit = !!editData

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [successEmail, setSuccessEmail] = useState<string | null>(null)

  // Compute initial tenant_id from editData
  function getInitialTenantId(): string {
    if (!editData) return ''
    return editData.contractor_id ?? editData.client_id ?? ''
  }

  // Format mobile for display in form (show local format if E.164)
  function getDisplayMobile(): string {
    if (!editData?.mobile_e164) return ''
    return formatAuMobileDisplay(editData.mobile_e164)
  }

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(UserFormSchema),
    defaultValues: {
      full_name: editData?.full_name ?? '',
      email: editData?.email ?? '',
      mobile_e164: getDisplayMobile(),
      role: editData?.role ?? 'client-staff',
      tenant_id: getInitialTenantId(),
    },
  })

  // Reset form when editData changes (opening for a different user)
  useEffect(() => {
    if (open) {
      reset({
        full_name: editData?.full_name ?? '',
        email: editData?.email ?? '',
        mobile_e164: editData ? getDisplayMobile() : '',
        role: editData?.role ?? 'client-staff',
        tenant_id: editData ? getInitialTenantId() : '',
      })
      setSubmitError(null)
      setSuccessEmail(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editData?.user_id])

  const selectedRole = watch('role') as AppRole
  const needsContractor = CONTRACTOR_ROLES.includes(selectedRole)
  const needsClient = CLIENT_ROLES.includes(selectedRole)
  const needsTenant = needsContractor || needsClient

  const availableRoles = callerRole === 'client-admin'
    ? ROLE_OPTIONS.filter((r) => CLIENT_ROLES.includes(r.value))
    : ROLE_OPTIONS

  const { data: contractors } = useQuery({
    queryKey: ['contractors-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('contractor')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
      return data ?? []
    },
    enabled: needsContractor,
  })

  const { data: clients } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('client')
        .select('id, name')
        .eq('is_active', true)
        .order('name')
      return data ?? []
    },
    enabled: needsClient,
  })

  function handleClose() {
    onOpenChange(false)
    reset()
    setSubmitError(null)
    setSuccessEmail(null)
  }

  async function onSubmit(data: UserFormData) {
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        setSubmitError('Session expired. Please refresh the page.')
        setIsSubmitting(false)
        return
      }

      const role = data.role as AppRole
      const isContractorRole = CONTRACTOR_ROLES.includes(role)
      const isClientRole = CLIENT_ROLES.includes(role)

      const requestBody: Record<string, unknown> = {
        full_name: data.full_name,
        email: data.email,
        role: data.role,
      }

      if (data.mobile_e164) requestBody.mobile_e164 = data.mobile_e164

      if (isContractorRole && data.tenant_id) {
        requestBody.contractor_id = data.tenant_id
      }
      if (isClientRole && data.tenant_id) {
        requestBody.client_id = data.tenant_id
      }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        }
      )

      if (!res.ok) {
        const errorBody = await res.text()
        try {
          const parsed = JSON.parse(errorBody)
          setSubmitError(parsed.error ?? `Failed to ${isEdit ? 'update' : 'create'} user (${res.status})`)
        } catch {
          setSubmitError(`Failed to ${isEdit ? 'update' : 'create'} user (${res.status})`)
        }
        setIsSubmitting(false)
        return
      }

      setSuccessEmail(data.email)
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    } catch (err) {
      console.error('User form submit error:', err)
      setSubmitError(
        err instanceof Error
          ? `Error: ${err.message}`
          : 'An unexpected error occurred. Please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300 focus:border-[#293F52] focus:bg-white'
  const labelClass = 'mb-1 block text-xs font-medium text-gray-700'
  const errorClass = 'mt-1 text-[11px] text-red-500'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            {successEmail ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-[#E8FDF0]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00B864" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <Dialog.Title className="font-[family-name:var(--font-heading)] text-lg font-bold text-[#293F52]">
                  {isEdit ? 'User Updated' : 'User Created'}
                </Dialog.Title>
                {!isEdit && (
                  <>
                    <p className="text-sm text-gray-500">
                      A confirmation email has been sent to
                    </p>
                    <span className="rounded-lg bg-[#E8EEF2] px-4 py-2 font-[family-name:var(--font-heading)] text-sm font-bold text-[#293F52]">
                      {successEmail}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-2 w-full rounded-xl bg-[#293F52] px-3.5 py-3 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between">
                  <Dialog.Title className="font-[family-name:var(--font-heading)] text-lg font-bold text-[#293F52]">
                    {isEdit ? 'Edit User' : 'Add User'}
                  </Dialog.Title>
                  <Dialog.Close className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </Dialog.Close>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
                  {/* Full Name */}
                  <div>
                    <label className={labelClass}>
                      Full Name<span className="ml-0.5 text-red-500">*</span>
                    </label>
                    <input type="text" placeholder="e.g. Jane Smith" {...register('full_name')} className={inputClass} />
                    {errors.full_name && <p className={errorClass}>{errors.full_name.message}</p>}
                  </div>

                  {/* Email */}
                  <div>
                    <label className={labelClass}>
                      Email<span className="ml-0.5 text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      placeholder="jane@example.com"
                      {...register('email')}
                      className={`${inputClass} ${isEdit ? 'bg-gray-100 text-gray-500' : ''}`}
                      readOnly={isEdit}
                    />
                    {errors.email && <p className={errorClass}>{errors.email.message}</p>}
                    {isEdit && <p className="mt-0.5 text-[11px] text-gray-400">Email cannot be changed</p>}
                  </div>

                  {/* Mobile */}
                  <div>
                    <label className={labelClass}>Mobile</label>
                    <input type="text" placeholder="0412 345 678" {...register('mobile_e164')} className={inputClass} />
                    {errors.mobile_e164 && <p className={errorClass}>{errors.mobile_e164.message}</p>}
                  </div>

                  {/* Role */}
                  <div>
                    <label className={labelClass}>
                      Role<span className="ml-0.5 text-red-500">*</span>
                    </label>
                    <select {...register('role')} className={inputClass}>
                      {availableRoles.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    {errors.role && <p className={errorClass}>{errors.role.message}</p>}
                  </div>

                  {/* Tenant — conditional */}
                  {needsTenant && (
                    <div>
                      <label className={labelClass}>
                        {needsContractor ? 'Contractor' : 'Client'}
                        <span className="ml-0.5 text-red-500">*</span>
                      </label>
                      <select {...register('tenant_id')} className={inputClass}>
                        <option value="">Select {needsContractor ? 'contractor' : 'client'}...</option>
                        {needsContractor &&
                          (contractors ?? []).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        {needsClient &&
                          (clients ?? []).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                      </select>
                      {errors.tenant_id && <p className={errorClass}>{errors.tenant_id.message}</p>}
                    </div>
                  )}

                  {/* Error banner */}
                  {submitError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                      {submitError}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[#293F52] px-3.5 py-3.5 font-[family-name:var(--font-heading)] text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {isSubmitting
                      ? (isEdit ? 'Saving...' : 'Creating...')
                      : (isEdit ? 'Save Changes' : 'Create User')}
                  </button>
                </form>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
