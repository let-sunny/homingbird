import { Task as T, makeTestClock } from '@homingbird/kernel'
import type { ApiError } from '@homingbird/protocol'
import { signal } from '@homingbird/ui'
import { describe, expect, it } from 'vitest'
import { type Source, resource } from '../../src/resource.ts'
import { createState } from '../../src/state.ts'
import { settle } from '../support/app.ts'
import { recordOf, timelineText } from '../support/timeline.ts'

const clock = makeTestClock(0)

const sourceOf = <A>(ask: T.Task<A, ApiError>): Source<A> => ({
  ask,
  clock,
  ended: new AbortController().signal,
  hearsChanges: true,
  answered: () => {},
  failed: () => {},
  broke: () => {},
})

describe('watchState', () => {
  it('finds every resource of the state, the one added a moment ago too', () => {
    const state = createState('')
    const resources = Object.keys(state).filter(
      (key) => 'reset' in (state[key as keyof typeof state] as object),
    )
    const paths = (made: object) =>
      recordOf(made, clock)
        .snapshot()
        .resources.map((row) => row.path)
    expect(resources.length).toBeGreaterThan(5)
    expect(paths(createState(''))).toEqual(resources)
    expect(paths({ ...createState(''), newest: resource([]), pages: { first: resource([]) } })).toEqual([
      ...resources,
      'newest',
      'pages.first',
    ])
  })

  it('looks at nothing that is put in the state, only at what it was made of', () => {
    const recording = recordOf(
      {
        map: new Map([['SECRET', resource([])]]),
        held: signal({ SECRET: resource([]) }),
        set: new Set(['SECRET']),
        none: null,
        text: 'SECRET',
      },
      clock,
    )
    expect(recording.snapshot().resources).toEqual([])
  })

  it('tells what the machine does, in order, with what it holds', async () => {
    const list = resource<ReadonlyArray<string>>([])
    const recording = recordOf({ list }, clock)
    let answer = (_: ReadonlyArray<string>): void => {}
    const source = sourceOf(
      T.promise(
        () =>
          new Promise<ReadonlyArray<string>>((resolve) => {
            answer = resolve
          }),
      ),
    )
    void T.run(list.open(source))
    await settle()
    list.update((all) => [...all, 'SECRET'])
    void T.run(list.invalidate(source))
    await settle()
    expect(recording.snapshot().resources[0]).toMatchObject({
      running: true,
      queued: true,
      patches: 1,
      attempts: 1,
      items: 1,
      step: 'loading',
    })
    answer(['SECRET'])
    await settle()
    answer([])
    await settle()
    void T.run(list.refresh(source))
    void T.run(list.again(source))
    await settle()
    list.expire()
    list.reset()
    expect(recording.snapshot().resources[0]).toMatchObject({ running: false, queued: false, patches: 0 })
    expect(timelineText(recording).replaceAll('+0ms list ', '').split('\n')).toEqual([
      'opened',
      '=> loading not loaded',
      'asked',
      'changed',
      'invalidated',
      'answered',
      '=> idle loaded',
      '=> loading loaded',
      'asked',
      'answered',
      '=> idle loaded',
      'refreshed',
      '=> loading loaded',
      'again',
      '=> loading loaded',
      'asked',
      'expired',
      'reset',
      '=> idle not loaded',
    ])
  })

  it('tells of an attempt that failed and waits to be repeated, and of one that broke', async () => {
    const list = resource(0)
    const recording = recordOf({ list }, clock)
    void T.run(list.open(sourceOf(T.fail<ApiError>({ _tag: 'Unavailable', message: 'SECRET' }))))
    await settle()
    expect(recording.snapshot().resources[0]).toMatchObject({
      resting: true,
      lastError: 'Unavailable',
      items: 0,
    })
    void T.run(list.again(sourceOf(T.die(new Error('SECRET')))))
    await settle()
    expect(timelineText(recording)).toContain('list failed Unavailable')
    expect(timelineText(recording)).toContain('list broke')
    expect(timelineText(recording)).not.toContain('SECRET')
  })
})
