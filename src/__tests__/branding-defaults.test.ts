import { describe, it, expect } from 'vitest'
import { DEFAULT_FAQS } from '@/lib/client/branding-defaults'

describe('DEFAULT_FAQS', () => {
  it('contains 5 FAQ items', () => {
    expect(DEFAULT_FAQS).toHaveLength(5)
  })

  it('each item has question and answer strings', () => {
    for (const faq of DEFAULT_FAQS) {
      expect(typeof faq.question).toBe('string')
      expect(faq.question.length).toBeGreaterThan(0)
      expect(typeof faq.answer).toBe('string')
      expect(faq.answer.length).toBeGreaterThan(0)
    }
  })
})
