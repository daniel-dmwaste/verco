'use client'

import { useState } from 'react'

interface FaqAccordionProps {
  faqs: { question: string; answer: string }[]
}

export function FaqAccordion({ faqs }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  function toggle(index: number) {
    setOpenIndex((prev) => (prev === index ? null : index))
  }

  if (faqs.length === 0) return null

  return (
    <div className="rounded-xl bg-white shadow-sm">
      {faqs.map((faq, i) => {
        const isOpen = openIndex === i
        const isLast = i === faqs.length - 1

        return (
          <div
            key={i}
            className={!isLast ? 'border-b border-gray-100' : undefined}
          >
            <button
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="text-sm font-semibold text-[var(--brand)] md:text-base">
                {faq.question}
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8FA5B8"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div
              className="overflow-hidden transition-[max-height] duration-200 ease-in-out"
              style={{ maxHeight: isOpen ? '500px' : '0px' }}
            >
              <div className="px-5 pb-4 text-sm leading-relaxed text-gray-600">
                {faq.answer}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
