import { makeTestClock } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import type { CodeName } from '../../src/inspector/code-name.ts'
import { type Reading, type Snapshot, createRecording, tagOf } from '../../src/inspector/recording.ts'

const ROUTE = 'notes.list' as CodeName
const LIST = 'debates' as CodeName

const setUp = () => {
  const clock = makeTestClock(1_000_000)
  const recording = createRecording(clock)
  const reading: { now: Reading } = {
    now: {
      inside: { running: true, resting: false, queued: false, patches: 2, attempts: 3, items: 4 },
      load: { loaded: false, step: 'loading', error: null },
    },
  }
  const watch = recording.watch(LIST, () => reading.now)
  return { clock, recording, reading, watch }
}

describe('a recording', () => {
  it('keeps of a resource its counts, its last times and the tag of its last refusal', async () => {
    const { clock, recording, watch } = setUp()
    await clock.advance(5)
    watch.moved('asked')
    await clock.advance(10)
    watch.moved('failed', { _tag: 'Unavailable', message: 'SECRET' })
    expect(recording.snapshot().resources).toEqual([
      {
        path: LIST,
        step: 'loading',
        loaded: false,
        running: true,
        resting: false,
        queued: false,
        patches: 2,
        attempts: 3,
        items: 4,
        askedAt: 5,
        answeredAt: null,
        lastError: 'Unavailable',
      },
    ])
    watch.moved('answered')
    expect(recording.snapshot().resources[0]).toMatchObject({ answeredAt: 15, lastError: null })
    expect(recording.snapshot().now).toBe(15)
  })

  it('keeps each step with whether the list was read and why it failed', () => {
    const { recording, reading, watch } = setUp()
    watch.stepped()
    reading.now = {
      ...reading.now,
      load: { loaded: true, step: 'failed', error: { _tag: 'RateLimited', message: 'SECRET' } },
    }
    watch.stepped()
    expect(recording.snapshot().timeline).toEqual([
      { kind: 'step', at: 0, path: LIST, step: 'loading', loaded: false, error: null },
      { kind: 'step', at: 0, path: LIST, step: 'failed', loaded: true, error: 'RateLimited' },
    ])
  })

  it('shows a request while it runs, and how it went once it ended', async () => {
    const { clock, recording, watch } = setUp()
    const first = recording.asked(ROUTE)
    const second = recording.asked(ROUTE)
    watch.moved('opened')
    expect(recording.snapshot().timeline[0]).toMatchObject({ outcome: 'pending', ms: null, status: null })
    await clock.advance(70)
    second('ok', 200)
    first('NotFound', 404)
    expect(recording.snapshot().timeline).toMatchObject([
      { route: ROUTE, outcome: 'NotFound', ms: 70, status: 404 },
      { route: ROUTE, outcome: 'ok', ms: 70, status: 200 },
      { path: LIST, move: 'opened' },
    ])
  })

  it.each([99, 600, 200.5, Number.NaN, null])('keeps no status that is none: %j', (status) => {
    const { recording } = setUp()
    recording.asked(ROUTE)('ok', status)
    expect(recording.snapshot().timeline[0]).toMatchObject({ status: null })
  })

  it('keeps the newest hundred', () => {
    const { recording, watch } = setUp()
    const oldest = recording.asked(ROUTE)
    for (let one = 0; one < 100; one++) watch.moved('opened')
    oldest('ok', 200)
    const { timeline } = recording.snapshot()
    expect(timeline).toHaveLength(100)
    expect(timeline.every((entry) => entry.kind === 'move')).toBe(true)
  })

  it('tells of every change', () => {
    const { recording, watch } = setUp()
    let heard = 0
    recording.changes.subscribe(() => heard++)
    watch.moved('opened')
    recording.asked(ROUTE)('ok', 200)
    recording.clear()
    expect(heard).toBe(4)
  })

  it('forgets everything when cleared, the end of what ran too, and records on', () => {
    const { recording, watch } = setUp()
    const end = recording.asked(ROUTE)
    watch.moved('asked')
    recording.clear()
    end('ok', 200)
    expect(recording.snapshot().timeline).toEqual([])
    expect(recording.snapshot().resources[0]).toMatchObject({ askedAt: null, attempts: 0 })
    watch.moved('opened')
    expect(recording.snapshot().timeline).toHaveLength(1)
  })

  it('forgets everything at its end, and records nothing after it', () => {
    const { recording, watch } = setUp()
    const end = recording.asked(ROUTE)
    watch.moved('asked')
    recording.end()
    end('ok', 200)
    watch.moved('asked')
    watch.stepped()
    recording.asked(ROUTE)('ok', 200)
    expect(recording.snapshot().timeline).toEqual([])
    expect(recording.snapshot().resources[0]).toMatchObject({ askedAt: null, attempts: 0, lastError: null })
  })
})

describe('tagOf', () => {
  it('is the tag of a refusal the protocol lists, and never another text', () => {
    expect(tagOf({ _tag: 'Forbidden', message: 'SECRET' })).toBe('Forbidden')
    for (const error of [{ _tag: 'SECRET' }, { _tag: 'toString' }, { _tag: 7 }, {}, new Error('SECRET')])
      expect(tagOf(error)).toBe('Other')
  })
})

describe('what may leave a recording', () => {
  it('has no field of free text, so the compiler refuses one that is added', () => {
    const holdsNoFreeText: [FreeText<Snapshot>] extends [never] ? true : false = true
    const wouldNoticeOne: [FreeText<Snapshot & { body: string }>] extends [never] ? true : false = false
    expect([holdsNoFreeText, wouldNoticeOne]).toEqual([true, false])
  })
})

/** The free text anywhere in a type: text that is neither one of a few words nor a name of the code's. */
type FreeText<Held> = Held extends CodeName | number | boolean | null
  ? never
  : Held extends string
    ? string extends Held
      ? Held
      : never
    : Held extends ReadonlyArray<infer Item>
      ? FreeText<Item>
      : Held extends object
        ? { [Key in keyof Held]: FreeText<Held[Key]> }[keyof Held]
        : Held
