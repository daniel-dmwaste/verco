import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges classes', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles Tailwind conflicts — last wins', () => {
    expect(cn('p-4', 'p-8')).toBe('p-8')
  })

  it('handles falsy values', () => {
    expect(cn(undefined, 'foo', null, false, 'bar')).toBe('foo bar')
  })
})
