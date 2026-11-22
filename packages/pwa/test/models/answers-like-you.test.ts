import type { AsRead, RoutePoint } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type PlaceRow, answersLikeYouModel } from '../../src/models/answers-like-you.ts'
import { timeShown } from '../../src/models/time.ts'
import { strings } from '../../src/strings.ts'
import { ROOM, figures, report, taught } from '../support/fixtures.ts'

const DAY = 24 * 60 * 60_000
const NOW = 40 * DAY
const words = strings.answersLikeYou

type Place = AsRead.AgentFigures['places'][number]

const place = (name: string | null, asWritten: number, edited: number, verdict: Place['verdict']): Place => ({
  place: name,
  written: asWritten + edited,
  sentAsWritten: asWritten,
  sentAfterEdits: edited,
  discarded: 0,
  skipped: 0,
  verdict,
})

const route = (name: string | null, fields: Partial<RoutePoint> = {}): RoutePoint => ({
  place: name,
  drafted: 0,
  principles: 0,
  heldUp: 0,
  chances: 0,
  ...fields,
})

const skipped = (id: string, name: string | null, daysAgo: number): AsRead.AgentMiss => ({
  outcome: 'skipped',
  noteId: `note_${id}` as AsRead.AgentMiss['noteId'],
  conversationId: ROOM,
  place: name,
  at: NOW - daysAgo * DAY,
})

const month = (
  current: ReadonlyArray<Place>,
  previous: ReadonlyArray<Place> = [],
  misses?: AsRead.AgentMiss[],
) =>
  report({
    generatedAt: NOW,
    periods: [
      { days: 7, current: figures(), previous: figures() },
      { days: 30, current: figures({ places: current }), previous: figures({ places: previous }) },
    ],
    ...(misses !== undefined && { misses }),
  })

const rowsOf = (model: ReturnType<typeof answersLikeYouModel>): ReadonlyArray<PlaceRow> => model!.rows

const byKey = (rows: ReadonlyArray<PlaceRow>, key: string): PlaceRow => rows.find((row) => row.key === key)!

describe('answersLikeYouModel', () => {
  it('waits for the report, and for the principles while teaching is on, and shows nothing without a place', () => {
    expect(answersLikeYouModel(null, taught(), true)).toBeNull()
    expect(answersLikeYouModel('failed', taught(), true)).toBeNull()
    expect(answersLikeYouModel(month([place('billing', 1, 0, 'too_few')]), null, true)).toBeNull()
    expect(answersLikeYouModel(month([]), taught(), true)).toBeNull()
  })

  it('puts each place on its step, with what reaching each step means and takes', () => {
    const model = answersLikeYouModel(
      month([
        place('deploys', 10, 2, 'usually_as_written'),
        place('billing', 21, 12, 'mixed'),
        place(null, 2, 2, 'too_few'),
      ]),
      taught({
        routes: [
          route('deploys', { drafted: 12, principles: 1, heldUp: 4 }),
          route('billing', { drafted: 33, principles: 2, heldUp: 3 }),
          route(null, { drafted: 4, principles: 1 }),
          route('design', { drafted: 3 }),
        ],
      }),
      true,
    )!
    expect(model.title).toBe(words.title)
    expect(model.rows.map((row) => [row.key, row.track?.step])).toEqual([
      ['billing', 3],
      ['deploys', 4],
      ['direct', 2],
      ['design', 1],
    ])
    const billing = byKey(model.rows, 'billing')
    expect(billing).toMatchObject({
      name: '#billing',
      count: words.decided({ asWritten: 21, decided: 33, share: '64%' }),
      sentence: words.next.holding({ now: 6 }),
      slipped: false,
    })
    expect(billing.track!.label).toBe(words.trackLabel({ place: '#billing' }))
    expect(billing.track!.now).toBe(words.stepOf({ step: 3, name: words.steps.holding }))
    expect(billing.track!.steps.map((step) => [step.id, step.reached, step.current, step.last])).toEqual([
      ['step-billing-1', true, false, false],
      ['step-billing-2', true, false, false],
      ['step-billing-3', true, true, false],
      ['step-billing-4', false, false, true],
    ])
    expect(billing.track!.steps[2]).toMatchObject({
      name: words.steps.holding,
      meaning: words.meaning.holding,
      toReach: words.toReach.holding({ minimum: 10 }),
    })
    expect(byKey(model.rows, 'deploys').sentence).toBe(words.next.likeYou)
    expect(byKey(model.rows, 'direct')).toMatchObject({
      name: strings.trust.directMessages,
      sentence: words.next.taught,
    })
    expect(byKey(model.rows, 'design')).toMatchObject({
      count: words.undecided({ count: 3 }),
      sentence: words.next.drafting,
    })
    expect(model.steps!.items.map((step) => step.name)).toEqual([
      words.steps.drafting,
      words.steps.taught,
      words.steps.holding,
      words.steps.likeYou,
    ])
    expect(model.steps!.items[3]!.toReach).toBe(words.toReach.likeYou)
    expect(model.footnote).toBe(words.footnote)
  })

  it('calls a lost last step a chance to teach, and says when too few drafts were decided to tell', () => {
    const rows = rowsOf(
      answersLikeYouModel(
        month(
          [
            place('support', 6, 4, 'mixed'),
            place('ops', 3, 2, 'too_few'),
            place('sales', 2, 9, 'often_edited'),
          ],
          [
            place('support', 9, 1, 'usually_as_written'),
            place('ops', 9, 1, 'usually_as_written'),
            place('sales', 1, 1, 'too_few'),
          ],
        ),
        taught({
          routes: [
            route('support', { principles: 1, heldUp: 1 }),
            route('ops', { principles: 1, heldUp: 1 }),
            route('sales', { principles: 1, heldUp: 1 }),
          ],
        }),
        true,
      ),
    )
    expect(byKey(rows, 'support')).toMatchObject({ slipped: true, sentence: words.next.slipped })
    expect(byKey(rows, 'support').track!.step).toBe(3)
    expect(byKey(rows, 'ops')).toMatchObject({
      slipped: false,
      sentence: words.next.tooFew({ count: 5, minimum: 10 }),
    })
    expect(byKey(rows, 'sales')).toMatchObject({ slipped: false, sentence: words.next.holding({ now: 1 }) })
  })

  it('offers the next thing to do: teach from its chances, a first principle, its skipped notes, or more', () => {
    const rows = rowsOf(
      answersLikeYouModel(
        month(
          [
            place('billing', 9, 1, 'usually_as_written'),
            place('deploys', 9, 1, 'usually_as_written'),
            place('support', 1, 0, 'too_few'),
          ],
          [],
          [skipped('1', 'deploys', 2), skipped('2', 'deploys', 31), skipped('3', 'billing', 40)],
        ),
        taught({
          routes: [
            route('ops', { chances: 2, principles: 1 }),
            route('design', { drafted: 2 }),
            route(null, { drafted: 1 }),
            route('deploys', { principles: 1, heldUp: 1 }),
            route('billing', { principles: 1, heldUp: 1 }),
            route('sales', { drafted: 1, principles: 1 }),
          ],
        }),
        true,
      ),
    )
    expect(byKey(rows, 'ops')).toMatchObject({
      count: words.noDrafts,
      action: { kind: 'chances', label: words.teachFromChances({ count: 2 }), href: '#/agent/teaching' },
    })
    expect(byKey(rows, 'design').action).toEqual({
      kind: 'teach',
      label: words.teachFirst({ place: '#design' }),
      seed: { topic: '', place: 'design' },
    })
    expect(byKey(rows, 'direct').action).toEqual({
      kind: 'teach',
      label: words.teachAnywhere,
      seed: { topic: '', place: null },
    })
    expect(byKey(rows, 'deploys').action).toEqual({
      kind: 'skipped',
      label: words.reviewSkipped({ count: 1 }),
      notes: [
        {
          key: 'note_1',
          time: timeShown(NOW - 2 * DAY, NOW),
          href: `#/c/${ROOM}?note=note_1`,
          open: strings.teach.openConversation,
        },
      ],
    })
    expect(byKey(rows, 'billing').action).toEqual({
      kind: 'teach',
      label: words.teachMore({ place: '#billing' }),
      seed: { topic: '', place: 'billing' },
    })
    expect(byKey(rows, 'support')).toMatchObject({
      sentence: words.next.drafting,
      action: { kind: 'teach', label: words.teachFirst({ place: '#support' }) },
    })
    expect(byKey(rows, 'sales').action).toMatchObject({ label: words.teachMore({ place: '#sales' }) })
  })

  it('offers a principle for any channel in direct messages, at every step', () => {
    const rows = rowsOf(
      answersLikeYouModel(
        month([place(null, 9, 1, 'usually_as_written')]),
        taught({ routes: [route(null, { principles: 1, heldUp: 1 })] }),
        true,
      ),
    )
    expect(rows[0]!.action).toMatchObject({ kind: 'teach', label: words.teachAnywhere })
  })

  it('lists the most drafted places first, and direct messages after channels with as many', () => {
    const rows = rowsOf(
      answersLikeYouModel(
        month([]),
        taught({
          routes: [route(null, { drafted: 2 }), route('b', { drafted: 2 }), route('a', { drafted: 5 })],
        }),
        true,
      ),
    )
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'direct'])
  })

  it('shows each place’s count and sentence alone without teaching, or when the principles could not load', () => {
    const report = month([place('billing', 9, 1, 'usually_as_written'), place(null, 3, 3, 'mixed')])
    for (const model of [
      answersLikeYouModel(report, null, false),
      answersLikeYouModel(report, 'failed', true),
    ]) {
      expect(model!.steps).toBeNull()
      expect(model!.rows.map((row) => [row.key, row.track, row.action, row.sentence])).toEqual([
        ['billing', null, null, words.next.likeYou],
        ['direct', null, null, words.next.tooFew({ count: 6, minimum: 10 })],
      ])
    }
  })
})
