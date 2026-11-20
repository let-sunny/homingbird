import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { makePushWindow } from '../src/push/push-window.ts'

describe('the push window', () => {
  it('lets the first push for a key through and drops the rest until the window passes', () => {
    const window = makePushWindow(1_000)
    expect(window.admits('ana #payments', 0)).toBe(true)
    expect(window.admits('ana #payments', 999)).toBe(false)
    expect(window.admits('ana #payments', 1_000)).toBe(true)
  })

  it('keeps each key apart', () => {
    const window = makePushWindow(1_000)
    expect(window.admits('ana #payments', 0)).toBe(true)
    expect(window.admits('ben #payments', 10)).toBe(true)
    expect(window.admits('ana #billing', 20)).toBe(true)
    expect(window.admits('ben #payments', 30)).toBe(false)
  })

  it('never admits a key twice within one window, whatever the times', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(10_000), { maxLength: 30 }), (gaps) => {
        const window = makePushWindow(1_000)
        let now = 0
        const admitted: number[] = []
        for (const gap of gaps) {
          now += gap
          if (window.admits('key', now)) admitted.push(now)
        }
        for (let i = 1; i < admitted.length; i++)
          expect(admitted[i]! - admitted[i - 1]!).toBeGreaterThanOrEqual(1_000)
      }),
    )
  })
})
