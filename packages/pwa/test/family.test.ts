import { Task as T, makeTestClock } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { type Lifetime, lifetime } from '@homingbird/ui'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { family } from '../src/family.ts'
import type { Source } from '../src/resource.ts'
import { settle } from './support/app.ts'

const clock = makeTestClock(0)

const sourceOf = (answer: T.Task<string, ApiError>): Source<string> => ({
  ask: answer,
  clock,
  ended: new AbortController().signal,
  hearsChanges: true,
  answered: () => {},
  failed: () => {},
  broke: () => {},
})

const flush = (): Promise<void> => Promise.resolve()

describe('family', () => {
  it('makes one entry for a key however many pages hold it, and none for a key nobody holds', () => {
    const pages = family<string | null>(null)
    const first = lifetime()
    const second = lifetime()
    expect(pages.find('billing')).toBeNull()
    const held = pages.use('billing', first)
    expect(pages.use('billing', second)).toBe(held)
    expect(pages.find('billing')).toBe(held)
    expect(pages.find('ops')).toBeNull()
  })

  it('lets go of an entry once the last page that holds it ends, and not before', async () => {
    const pages = family<string | null>(null)
    const first = lifetime()
    const second = lifetime()
    const held = pages.use('billing', first)
    held.set('kept')
    pages.use('billing', second)
    first.end()
    await flush()
    expect(pages.find('billing')).toBe(held)
    second.end()
    await flush()
    expect(pages.find('billing')).toBeNull()
    expect(held.get()).toBeNull()
  })

  it('keeps what a page that is drawn again holds again, so that nothing is asked twice or shown empty', async () => {
    const pages = family<string | null>(null)
    const drawing = lifetime()
    const held = pages.use('billing', drawing)
    held.set('shown')
    drawing.end()
    const again = pages.use('billing', lifetime())
    await flush()
    expect(again).toBe(held)
    expect(held.get()).toBe('shown')
  })

  it('empties what the person may no longer see, held or not, and lets go of it when its page ends', async () => {
    const pages = family<string | null>(null)
    const life = lifetime()
    const billing = pages.use('billing', life)
    const ops = pages.use('ops', lifetime())
    billing.set('billing words')
    ops.set('ops words')
    pages.keepOnly(new Set(['ops']))
    expect(billing.get()).toBeNull()
    expect(billing.load.get()).toEqual({ loaded: false, step: 'idle', error: null })
    expect(ops.get()).toBe('ops words')
    life.end()
    await flush()
    expect(pages.find('billing')).toBeNull()
  })

  it('stops what runs for what it empties', async () => {
    const pages = family<string | null>(null)
    const held = pages.use('billing', lifetime())
    let aborted = false
    const never = T.promise<string>(
      (signal) =>
        new Promise<string>(() => {
          signal.addEventListener('abort', () => {
            aborted = true
          })
        }),
    )
    void T.run(held.open(sourceOf(never as never)))
    await settle()
    pages.keepOnly(new Set())
    await settle()
    expect(aborted).toBe(true)
  })

  it('empties every entry and lets go of it when the session ends', () => {
    const pages = family<string | null>(null)
    const held = pages.use('billing', lifetime())
    held.set('personal')
    pages.reset()
    expect(pages.find('billing')).toBeNull()
    expect(held.get()).toBeNull()
    expect(pages.load.get()).toEqual({ loaded: false, step: 'idle', error: null })
  })

  it('tells the worst of its entries’ loads, and that it was read only when every entry was', async () => {
    const pages = family<string | null>(null)
    const first = pages.use('billing', lifetime())
    const second = pages.use('ops', lifetime())
    const heard: boolean[] = []
    pages.load.subscribe(() => heard.push(pages.load.get().loaded))
    await T.run(first.open(sourceOf(T.succeed('words'))))
    expect(pages.load.get()).toEqual({ loaded: false, step: 'idle', error: null })
    await T.run(second.open(sourceOf(T.succeed('words'))))
    expect(pages.load.get()).toEqual({ loaded: true, step: 'idle', error: null })
    expect(heard.at(-1)).toBe(true)
    expect(heard.slice(0, -1).every((loaded) => !loaded)).toBe(true)
  })

  it('counts its entries and what they run for the developers, and tells nothing they hold', async () => {
    const pages = family<string | null>(null)
    const moves: string[] = []
    const held = pages.use('SECRET-key', lifetime())
    const read = pages.inspect((move) => moves.push(move))
    const later = pages.use('SECRET-other', lifetime())
    held.set('SECRET-value')
    later.set('SECRET-value')
    await T.run(later.open(sourceOf(T.succeed('SECRET-answer'))))
    expect(read()).toEqual({
      running: false,
      resting: false,
      queued: false,
      patches: 0,
      attempts: 0,
      items: 2,
    })
    expect(moves).toEqual(['changed', 'changed', 'opened', 'asked', 'answered'])
    expect(JSON.stringify([read(), moves])).not.toContain('SECRET')
  })

  it('holds no entry that no page holds, after any course of pages coming and going and of access changing', async () => {
    const KEYS = ['a', 'b', 'c']
    const operation = fc.oneof(
      fc.record({ kind: fc.constant('hold' as const), key: fc.constantFrom(...KEYS) }),
      fc.record({ kind: fc.constant('end' as const), page: fc.nat(20) }),
      fc.record({
        kind: fc.constant('access' as const),
        keys: fc.subarray(KEYS),
      }),
      fc.record({ kind: fc.constant('session' as const) }),
    )
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { maxLength: 40 }), async (operations) => {
        const pages = family<string | null>(null)
        const live: Array<{ readonly key: string; readonly life: Lifetime; ended: boolean }> = []
        let allowed = new Set(KEYS)
        for (const step of operations) {
          if (step.kind === 'hold') {
            const life = lifetime()
            const held = pages.use(step.key, life)
            if (allowed.has(step.key)) held.set('words')
            live.push({ key: step.key, life, ended: false })
          } else if (step.kind === 'end') {
            const page = live[step.page % Math.max(live.length, 1)]
            if (page !== undefined && !page.ended) {
              page.ended = true
              page.life.end()
            }
          } else if (step.kind === 'access') {
            allowed = new Set(step.keys)
            pages.keepOnly(allowed)
          } else {
            pages.reset()
            for (const page of live) page.ended = true
          }
          await flush()
          for (const key of KEYS) {
            const holders = live.filter((page) => page.key === key && !page.ended).length
            const entry = pages.find(key)
            expect(entry !== null, `${key} is held only while a page holds it`).toBe(holders > 0)
            if (entry !== null && !allowed.has(key) && step.kind === 'access')
              expect(entry.get(), `${key} is empty once the person may not see it`).toBeNull()
          }
          expect(pages.inspect(() => {})().items).toBeLessThanOrEqual(KEYS.length)
        }
      }),
    )
  })
})
