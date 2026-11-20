import { describe, expect, it } from 'vitest'
import type { MemberDraft } from '../src/domain/organization-figures.ts'
import { isQuickApprovalHigh, quickWeeksOf } from '../src/domain/quick-weeks.ts'
import { DAY_MS } from '../src/domain/trust-figures.ts'

const NOW = 1_700_000_000_000
const settings = { quickApprovalSeconds: 3, minimumGroupSize: 5 }

const sentAsWritten = (authorId: string, daysAgo: number, seconds: number): MemberDraft => ({
  authorId,
  place: null,
  createdAt: NOW - daysAgo * DAY_MS - 60_000,
  seenAt: NOW - daysAgo * DAY_MS - seconds * 1000,
  decidedAt: NOW - daysAgo * DAY_MS,
  outcome: 'as_written',
})

/** Ten drafts sent as written by five people in the week `daysAgo` falls in, `quick` of them quickly. */
const week = (daysAgo: number, quick: number): MemberDraft[] =>
  Array.from({ length: 10 }, (_, index) => sentAsWritten(`m${index % 5}`, daysAgo, index < quick ? 1 : 30))

describe('quickWeeksOf', () => {
  it('gives eight weeks, oldest first, with their drafts sent as written and the quick ones', () => {
    const { weeks } = quickWeeksOf(week(1, 2), NOW, settings)
    expect(weeks).toHaveLength(8)
    expect(weeks[0]!.start).toBe(NOW - 56 * DAY_MS)
    expect(weeks[7]).toEqual({ start: NOW - 7 * DAY_MS, sentAsWritten: 10, quickApprovals: 2 })
    expect(weeks[6]).toEqual({ start: NOW - 14 * DAY_MS, sentAsWritten: null, quickApprovals: null })
  })

  it('warns when a quarter or more were quick in each of the last two weeks', () => {
    expect(quickWeeksOf([...week(1, 3), ...week(8, 3)], NOW, settings).quickWarning).toBe(true)
    expect(quickWeeksOf([...week(1, 3), ...week(8, 2)], NOW, settings).quickWarning).toBe(false)
    expect(quickWeeksOf([...week(1, 3), ...week(15, 3)], NOW, settings).quickWarning).toBe(false)
  })

  it('hides a week as the draft decisions of the same days are hidden: by the people who decided a draft', () => {
    const fewPeople = week(1, 5).map((draft) => ({
      ...draft,
      authorId: draft.authorId === 'm4' ? 'm0' : draft.authorId,
    }))
    expect(quickWeeksOf(fewPeople, NOW, settings).weeks[7]).toMatchObject({ sentAsWritten: null })
    const oneDiscarded = [...fewPeople, { ...sentAsWritten('m4', 1, 30), outcome: 'discarded' as const }]
    expect(quickWeeksOf(oneDiscarded, NOW, settings).weeks[7]).toEqual({
      start: NOW - 7 * DAY_MS,
      sentAsWritten: 10,
      quickApprovals: 5,
    })
  })
  it('counts only drafts sent as written', () => {
    const edited = week(1, 10).map((draft) => ({ ...draft, outcome: 'edited' as const }))
    expect(quickWeeksOf([...week(1, 0), ...edited], NOW, settings).weeks[7]).toMatchObject({
      sentAsWritten: 10,
      quickApprovals: 0,
    })
  })
})

describe('isQuickApprovalHigh', () => {
  it('needs a shown week with at least ten drafts sent as written', () => {
    expect(isQuickApprovalHigh({ start: 0, sentAsWritten: 10, quickApprovals: 3 })).toBe(true)
    expect(isQuickApprovalHigh({ start: 0, sentAsWritten: 9, quickApprovals: 9 })).toBe(false)
    expect(isQuickApprovalHigh({ start: 0, sentAsWritten: 12, quickApprovals: 2 })).toBe(false)
    expect(isQuickApprovalHigh({ start: 0, sentAsWritten: null, quickApprovals: null })).toBe(false)
    expect(isQuickApprovalHigh({ start: 0, sentAsWritten: 10, quickApprovals: null })).toBe(false)
  })
})
