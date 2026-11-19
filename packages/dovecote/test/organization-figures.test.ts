import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type MemberDraft,
  type OrganizationActivity,
  type SentNote,
  organizationFiguresIn,
  organizationInsightsOf,
  placesShown,
} from '../src/domain/organization-figures.ts'
import { DAY_MS, periodEndingAt } from '../src/domain/trust-figures.ts'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60_000
const settings = { quickApprovalSeconds: 3, minimumGroupSize: 5 }
const lastWeek = periodEndingAt(NOW, 7, 0)

const people = (count: number, prefix = 'm'): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`)

let noteCount = 0
const note = (
  authorId: string,
  place: string | null,
  hoursAgo: number,
  inReplyTo: string | null = null,
): SentNote => ({
  id: `n${++noteCount}`,
  authorId,
  place,
  sentAt: NOW - hoursAgo * HOUR,
  inReplyTo,
})

const draft = (
  authorId: string,
  place: string | null,
  outcome: MemberDraft['outcome'],
  seconds = 30,
): MemberDraft => ({
  authorId,
  place,
  createdAt: NOW - 2 * HOUR,
  seenAt: NOW - HOUR - seconds * 1000,
  decidedAt: NOW - HOUR,
  outcome,
})

const empty: OrganizationActivity = { sent: [], drafts: [], skips: [] }

describe('placesShown', () => {
  const group = (place: string | null, members: ReadonlyArray<string>) => ({
    place,
    people: new Set(members),
  })

  it('shows every group of at least the minimum and hides the smaller ones', () => {
    const shown = placesShown(
      [
        group('billing', people(6, 'b')),
        group(null, people(5, 'd')),
        group('payroll', people(2, 'p')),
        group('security', people(3, 's')),
      ],
      5,
    )
    expect(shown).toEqual({ shown: ['billing', null], hidden: ['payroll', 'security'] })
  })

  it('hides one more group when the hidden ones together are still too few, so no remainder gives one away', () => {
    const shown = placesShown(
      [group('billing', people(9, 'b')), group('deploys', people(6, 'd')), group('payroll', people(2, 'p'))],
      5,
    )
    expect(shown).toEqual({ shown: ['billing'], hidden: ['payroll', 'deploys'] })
  })

  it('leaves the hidden groups together either empty or at least the minimum, whatever the groups are', () => {
    const groups = fc.array(
      fc.record({
        place: fc.option(fc.string({ minLength: 1, maxLength: 3 })),
        people: fc
          .uniqueArray(fc.constantFrom(...people(14)), { maxLength: 12 })
          .map((each) => new Set(each)),
      }),
      { maxLength: 8 },
    )
    fc.assert(
      fc.property(groups, fc.integer({ min: 5, max: 8 }), (all, minimum) => {
        const { shown, hidden } = placesShown(all, minimum)
        const hiddenPeople = new Set(
          all.filter((each) => hidden.includes(each.place)).flatMap((each) => [...each.people]),
        )
        expect(shown.length + hidden.length).toBe(all.length)
        expect(hiddenPeople.size === 0 || hiddenPeople.size >= minimum || shown.length === 0).toBe(true)
        for (const each of all.filter(
          (candidate) => shown.includes(candidate.place) && !hidden.includes(candidate.place),
        ))
          expect(each.people.size).toBeGreaterThanOrEqual(minimum)
      }),
    )
  })
})

describe('organizationFiguresIn', () => {
  it('shows nothing at all while fewer people than the minimum were active', () => {
    const activity = { ...empty, sent: people(4).map((id) => note(id, 'billing', 1)) }
    expect(organizationFiguresIn(activity, lastWeek, settings)).toBeNull()
  })

  it('counts active members, notes, replies and the median time to the first reply from someone else', () => {
    const team = people(5)
    const first = note(team[0]!, null, 10)
    const second = note(team[1]!, 'billing', 8)
    const unanswered = note(team[2]!, 'billing', 6)
    const activity: OrganizationActivity = {
      ...empty,
      sent: [
        first,
        note(team[0]!, null, 9, first.id),
        note(team[3]!, null, 8, first.id),
        note(team[4]!, null, 6, first.id),
        second,
        note(team[3]!, 'billing', 4, second.id),
        unanswered,
      ],
    }
    expect(organizationFiguresIn(activity, lastWeek, settings)).toMatchObject({
      activeMembers: 5,
      notesSent: 7,
      newNotes: 3,
      answered: 2,
      medianFirstReplyMs: 3 * HOUR,
    })
  })

  it('counts sent debate results on their own line, apart from notes, replies and active members', () => {
    const team = people(5)
    const activity: OrganizationActivity = {
      ...empty,
      sent: team.map((id) => note(id, null, 2)),
      debateResults: [
        ...team.map((authorId) => ({ authorId, sentAt: NOW - HOUR })),
        { authorId: 'outsider', sentAt: NOW - HOUR },
        { authorId: team[0]!, sentAt: NOW - 30 * DAY_MS },
      ],
    }
    expect(organizationFiguresIn(activity, lastWeek, settings)).toMatchObject({
      activeMembers: 5,
      notesSent: 5,
      debateResultsSent: 6,
    })
  })

  it('hides the debate results while fewer people than the minimum sent one', () => {
    const team = people(5)
    const noResults: OrganizationActivity = { ...empty, sent: team.map((id) => note(id, null, 2)) }
    const activity: OrganizationActivity = {
      ...noResults,
      debateResults: team.slice(0, 4).map((authorId) => ({ authorId, sentAt: NOW - HOUR })),
    }
    expect(organizationFiguresIn(activity, lastWeek, settings)?.debateResultsSent).toBeNull()
    expect(organizationFiguresIn(noResults, lastWeek, settings)?.debateResultsSent).toBeNull()
  })

  it('counts the approval mix, quick approvals and skips across everyone', () => {
    const team = people(5)
    const activity: OrganizationActivity = {
      sent: team.map((id) => note(id, 'billing', 1)),
      drafts: [
        draft(team[0]!, 'billing', 'as_written', 1),
        draft(team[1]!, 'billing', 'as_written', 30),
        draft(team[2]!, 'billing', 'edited'),
        draft(team[3]!, 'billing', 'discarded'),
        draft(team[4]!, 'billing', 'discarded'),
        draft(team[4]!, 'billing', null),
      ],
      skips: [{ memberId: team[0]!, place: 'billing', at: NOW - HOUR }],
    }
    expect(organizationFiguresIn(activity, lastWeek, settings)).toMatchObject({
      agentDraftsWritten: 6,
      sentAsWritten: 2,
      sentAfterEdits: 1,
      discarded: 2,
      quickApprovals: 1,
      skipped: 1,
      places: [
        { place: 'billing', notesSent: 5, sentAsWritten: 2, sentAfterEdits: 1, discarded: 2, skipped: 1 },
      ],
      hiddenPlaces: 0,
    })
  })

  it('hides draft decisions while fewer than the minimum people decided agent drafts, everywhere and per place', () => {
    const team = people(10)
    const sent = team.map((id, index) => note(id, index < 5 ? 'billing' : 'deploys', 1))
    const fewDeciders: OrganizationActivity = {
      ...empty,
      sent,
      drafts: team.slice(0, 4).map((id) => draft(id, 'billing', 'as_written', 1)),
    }
    const hidden = organizationFiguresIn(fewDeciders, lastWeek, settings)!
    expect(hidden).toMatchObject({
      sentAsWritten: null,
      sentAfterEdits: null,
      discarded: null,
      quickApprovals: null,
    })
    expect(hidden.places.map((place) => place.sentAsWritten)).toEqual([null, null])
    const oneSmallPlace: OrganizationActivity = {
      ...empty,
      sent,
      drafts: [
        ...team.slice(0, 5).map((id) => draft(id, 'billing', 'as_written')),
        draft(team[5]!, 'deploys', 'discarded'),
      ],
    }
    const figures = organizationFiguresIn(oneSmallPlace, lastWeek, settings)!
    expect(figures).toMatchObject({ sentAsWritten: 5, discarded: 1 })
    expect(figures.places.map((place) => [place.place, place.sentAsWritten, place.discarded])).toEqual([
      ['billing', null, null],
      ['deploys', null, null],
    ])
    const twoLargePlaces: OrganizationActivity = {
      ...empty,
      sent,
      drafts: team.map((id, index) => draft(id, index < 5 ? 'billing' : 'deploys', 'as_written')),
    }
    expect(
      organizationFiguresIn(twoLargePlaces, lastWeek, settings)!.places.map((place) => place.sentAsWritten),
    ).toEqual([5, 5])
  })

  it('leaves out a channel with fewer than the minimum people and says how many were left out', () => {
    const billing = people(6, 'b')
    const payroll = people(2, 'p')
    const deploys = people(5, 'd')
    const activity: OrganizationActivity = {
      ...empty,
      sent: [
        ...billing.map((id) => note(id, 'billing', 1)),
        ...payroll.map((id) => note(id, 'payroll', 1)),
        ...deploys.map((id) => note(id, 'deploys', 1)),
      ],
    }
    const figures = organizationFiguresIn(activity, lastWeek, settings)!
    expect(figures.places.map((place) => place.place)).toEqual(['billing'])
    expect(figures.hiddenPlaces).toBe(2)
    expect(figures.notesSent).toBe(13)
  })

  it('never names a member anywhere in what it returns', () => {
    const team = people(7, 'mem_secret')
    const activity: OrganizationActivity = {
      sent: team.map((id, index) => note(id, index % 2 === 0 ? 'billing' : null, index + 1)),
      drafts: team.map((id) => draft(id, 'billing', 'as_written')),
      skips: team.map((id) => ({ memberId: id, place: null, at: NOW - HOUR })),
    }
    const insights = organizationInsightsOf(activity, { members: 7, blocks: 2 }, NOW, settings)
    expect(JSON.stringify(insights)).not.toContain('mem_secret')
  })
})

describe('drafts by program and model', () => {
  it('shows a program or model only when at least the minimum people used it', () => {
    const many = people(5, 'a')
    const few = people(2, 'b')
    const activity: OrganizationActivity = {
      sent: [...many, ...few].map((id) => note(id, null, 1)),
      drafts: [
        ...many.map((id) => ({
          ...draft(id, null, 'as_written'),
          client: 'Claude Code',
          model: 'claude-opus-5-5',
        })),
        ...few.map((id) => ({ ...draft(id, null, 'edited'), client: 'Rare tool', model: 'rare-model' })),
      ],
      skips: [],
    }
    const figures = organizationFiguresIn(activity, lastWeek, settings)!
    expect(figures.byClient.map((each) => each.label)).toEqual([])
    expect(figures.hiddenLabels).toBe(4)
    const more = people(5, 'c')
    const wider: OrganizationActivity = {
      ...activity,
      sent: [...activity.sent, ...more.map((id) => note(id, null, 1))],
      drafts: [
        ...activity.drafts,
        ...more.map((id) => ({ ...draft(id, null, 'edited'), client: 'Rare tool', model: null })),
      ],
    }
    const shown = organizationFiguresIn(wider, lastWeek, settings)!
    expect(shown.byClient.map((each) => [each.label, each.written])).toEqual([
      ['Rare tool', 7],
      ['Claude Code', 5],
    ])
    expect(shown.byClient.map((each) => each.sentAsWritten)).toEqual([0, 5])
  })

  it('hides a label’s decisions when one person decided all its drafts, though five people wrote them', () => {
    const writers = people(5, 'w')
    const activity: OrganizationActivity = {
      sent: writers.map((id) => note(id, null, 1)),
      drafts: writers.map((id, index) => ({
        ...draft(id, null, index === 0 ? 'edited' : null),
        client: 'Claude Code',
        model: 'claude-opus-5-5',
      })),
      skips: [],
    }
    const figures = organizationFiguresIn(activity, lastWeek, settings)!
    expect(figures.byClient).toEqual([
      { label: 'Claude Code', written: 5, sentAsWritten: null, sentAfterEdits: null, discarded: null },
    ])
    expect(figures.byModel[0]).toMatchObject({ written: 5, sentAfterEdits: null })
    expect(figures.sentAfterEdits).toBeNull()
  })

  it('hides every label’s decisions while the organization’s decisions are hidden', () => {
    const writers = people(5, 'w')
    const activity: OrganizationActivity = {
      sent: writers.map((id) => note(id, null, 1)),
      drafts: [
        ...writers.map((id) => ({ ...draft(id, null, 'as_written'), client: 'Claude Code' })),
        ...people(5, 'x').map((id) => ({ ...draft(id, null, null), client: 'Claude Code' })),
      ],
      skips: [],
    }
    expect(organizationFiguresIn(activity, lastWeek, settings)!.byClient[0]?.sentAsWritten).toBe(5)
    const few = {
      ...activity,
      drafts: activity.drafts.map((each, index) =>
        index < 5 && index > 0 ? { ...each, outcome: null } : each,
      ),
    }
    expect(organizationFiguresIn(few, lastWeek, settings)!.byClient[0]?.sentAsWritten).toBeNull()
  })
})

describe('organizationInsightsOf', () => {
  it('gives the block count only when the organization has at least the minimum members', () => {
    expect(organizationInsightsOf(empty, { members: 4, blocks: 1 }, NOW, settings).blocks).toBeNull()
    expect(organizationInsightsOf(empty, { members: 5, blocks: 1 }, NOW, settings).blocks).toBe(1)
  })

  it('compares the last 7 and 30 days with the period before', () => {
    const team = people(5)
    const activity = {
      ...empty,
      sent: [...team.map((id) => note(id, null, 1)), ...team.map((id) => note(id, null, 24 * 10))],
    }
    const insights = organizationInsightsOf(activity, { members: 5, blocks: 0 }, NOW, settings)
    expect(insights.periods.map((period) => period.days)).toEqual([7, 30])
    expect(insights.periods[0]!.current?.notesSent).toBe(5)
    expect(insights.periods[0]!.previous?.notesSent).toBe(5)
    expect(insights.periods[1]!.current?.notesSent).toBe(10)
    expect(insights.periods[1]!.previous).toBeNull()
    expect(insights).toMatchObject({ generatedAt: NOW, quickApprovalSeconds: 3, minimumGroupSize: 5 })
    expect(DAY_MS).toBe(24 * HOUR)
  })
})
