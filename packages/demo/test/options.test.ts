import { systemClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { clockFor, demoOptions } from '../src/options.ts'

describe('demoOptions', () => {
  it('reads a stopped time, a language and an appearance from the address', () => {
    expect(demoOptions('?at=2026-11-21T09:00:00Z&lang=ko&theme=dark')).toEqual({
      at: Date.UTC(2026, 10, 21, 9),
      language: 'ko',
      appearance: 'dark',
    })
  })

  it('leaves out what it does not know, so the browser’s own choices stay', () => {
    expect(demoOptions('')).toEqual({ at: null, language: null, appearance: null })
    expect(demoOptions('?at=soon&lang=fr&theme=sepia')).toEqual({
      at: null,
      language: null,
      appearance: null,
    })
  })
})

describe('clockFor', () => {
  it('stops the clock at the chosen moment, and keeps the system’s otherwise', () => {
    const stopped = clockFor({ at: 42, language: null, appearance: null })
    expect([stopped.now(), stopped.now()]).toEqual([42, 42])
    expect(stopped.sleep).toBe(systemClock.sleep)
    expect(clockFor({ at: null, language: null, appearance: null })).toBe(systemClock)
  })
})
