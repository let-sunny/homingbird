import { describe, expect, it } from 'vitest'
import type { CodeName } from '../../src/inspector/code-name.ts'
import type { Entry, ResourceRow } from '../../src/inspector/recording.ts'
import { inspectorWords } from '../../src/inspector/words.ts'
import { type TimelineFilter, inspectorModel } from '../../src/models/inspector.ts'
import { plainSpaces } from '../support/text.ts'

const LIST = 'debates' as CodeName
const ROUTE = 'notes.list' as CodeName
const ALL: TimelineFilter = { kind: 'all', name: '', failuresOnly: false }
const words = inspectorWords('en')

const row = (changes: Partial<ResourceRow> = {}): ResourceRow => ({
  path: LIST,
  step: 'idle',
  loaded: true,
  running: false,
  resting: false,
  queued: false,
  patches: 0,
  attempts: 1,
  items: 3,
  askedAt: 500,
  answeredAt: 1000,
  lastError: null,
  ...changes,
})

const listShown = (changes: Partial<ResourceRow>) => {
  const shown = inspectorModel({ now: 3500, resources: [row(changes)], timeline: [] }, ALL, words, 'en')
  return { ...shown, list: shown.lists[0]! }
}

const TIMELINE: ReadonlyArray<Entry> = [
  { kind: 'move', at: 1, path: LIST, move: 'opened', error: null },
  { kind: 'move', at: 2, path: LIST, move: 'failed', error: 'Unavailable' },
  { kind: 'move', at: 3, path: LIST, move: 'broke', error: null },
  { kind: 'step', at: 4, path: LIST, step: 'idle', loaded: true, error: null },
  { kind: 'step', at: 5, path: LIST, step: 'failed', loaded: false, error: 'Forbidden' },
  { kind: 'step', at: 6, path: LIST, step: 'failed', loaded: false, error: null },
  { kind: 'request', number: 0, at: 7, route: ROUTE, ms: null, outcome: 'pending', status: null },
  { kind: 'request', number: 1, at: 8, route: ROUTE, ms: 1234, outcome: 'ok', status: 200 },
  { kind: 'request', number: 2, at: 15_000, route: ROUTE, ms: 12_345, outcome: 'NotFound', status: 404 },
  { kind: 'request', number: 3, at: 16_000, route: ROUTE, ms: 1, outcome: 'interrupted', status: null },
]

const timelineShown = (filter: Partial<TimelineFilter> = {}) =>
  inspectorModel({ now: 0, resources: [], timeline: TIMELINE }, { ...ALL, ...filter }, words, 'en').timeline

describe('the lists', () => {
  it('say what a quiet list holds and how old its answer is', () => {
    const { list, summary } = listShown({})
    expect(summary).toBe('Loads, 0 running')
    expect(list.isFailed).toBe(false)
    expect(plainSpaces(Object.values(list.cells))).toEqual([
      'Idle',
      '2.5 sec ago',
      'No',
      'No',
      '0',
      'None',
      '3',
      '1',
      '3 sec ago',
    ])
  })

  it('say what was never asked for', () => {
    const { list } = listShown({ loaded: false, askedAt: null, answeredAt: null })
    expect(list.cells).toMatchObject({ step: 'Not asked', age: 'Never', asked: 'Never' })
  })

  it('say what runs, what waits behind it, and how the last attempt failed', () => {
    const { list, summary } = listShown({
      running: true,
      queued: true,
      patches: 2,
      step: 'loading',
      lastError: 'Unavailable',
    })
    expect(summary).toBe('Loads, 1 running')
    expect(list.cells).toMatchObject({ running: 'Yes', queued: 'Yes', patches: '2', error: 'Unavailable' })
    expect(listShown({ running: true, resting: true }).list.cells.running).toBe('Waiting to repeat')
    expect(listShown({ step: 'failed' }).list.isFailed).toBe(true)
  })
})

describe('the timeline', () => {
  it('says what happened, the newest first', () => {
    expect(timelineShown().map(({ name, what }) => plainSpaces(`${name}: ${what}`))).toEqual([
      'notes.list: Ended early · 1 ms',
      'notes.list: NotFound · 404 · 12 sec',
      'notes.list: Answered · 200 · 1.2 sec',
      'notes.list: On its way',
      'debates: Failed, not loaded',
      'debates: Failed, not loaded · Forbidden',
      'debates: Idle, loaded',
      'debates: Broke',
      'debates: Attempt failed · Unavailable',
      'debates: Opened',
    ])
    expect(plainSpaces(timelineShown()[1]!.at)).toBe('15 sec')
  })

  it('is narrowed to lists, to requests, to a name and to failures', () => {
    expect(timelineShown({ kind: 'list' })).toHaveLength(6)
    expect(timelineShown({ kind: 'request' })).toHaveLength(4)
    expect(timelineShown({ name: ' NOTES ' })).toHaveLength(4)
    expect(timelineShown({ failuresOnly: true }).map((line) => line.name)).toEqual([
      ROUTE,
      LIST,
      LIST,
      LIST,
      LIST,
    ])
    expect(timelineShown({ failuresOnly: true }).every((line) => line.isFailed)).toBe(true)
  })
})
