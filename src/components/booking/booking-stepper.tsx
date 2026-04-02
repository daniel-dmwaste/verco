'use client'

import { cn } from '@/lib/utils'

const STEPS = [
  { number: 1, label: 'Address' },
  { number: 2, label: 'Services' },
  { number: 3, label: 'Date' },
  { number: 4, label: 'Details' },
  { number: 5, label: 'Confirm' },
] as const

interface BookingStepperProps {
  currentStep: 1 | 2 | 3 | 4 | 5
}

export function BookingStepper({ currentStep }: BookingStepperProps) {
  return (
    <div className="bg-white px-8 pb-3 pt-3.5 shadow-[0_2px_4px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between">
        {STEPS.map((step) => {
          const isDone = step.number < currentStep
          const isActive = step.number === currentStep
          const isFuture = step.number > currentStep

          return (
            <div
              key={step.number}
              className="relative flex flex-1 flex-col items-center gap-1.5"
            >
              {/* Connector line */}
              {step.number < STEPS.length && (
                <div
                  className={cn(
                    'absolute left-[calc(50%+14px)] right-[calc(-50%+14px)] top-3.5 h-0.5',
                    isDone ? 'bg-[var(--brand)]' : 'bg-gray-100'
                  )}
                />
              )}

              {/* Circle */}
              <div
                className={cn(
                  'relative z-10 flex size-7 items-center justify-center rounded-full text-[13px] font-semibold',
                  isActive &&
                    'border-[1.5px] border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-accent)]',
                  isDone &&
                    'border-[1.5px] border-[var(--brand)] bg-[var(--brand)] text-white',
                  isFuture &&
                    'border-[1.5px] border-gray-100 bg-white text-gray-300'
                )}
              >
                {isDone ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  step.number
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  'text-center text-[10px] whitespace-nowrap',
                  isActive || isDone ? 'text-[var(--brand)]' : 'text-gray-300'
                )}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
