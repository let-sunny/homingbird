import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type MemberDraft,
  type OrganizationActivity,
  type SentNote,
  organizationFiguresIn,
  organizationInsightsOf,
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
  origin = 'human',
): SentNote => ({
  id: `n${++noteCount}`,
  authorId,
  place,
  sentAt: NOW - hoursAgo * HOUR,
  inReplyTo,
  origin,
})

const draft = (
  authorId: string | null,
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

const empty: OrganizationActivity = { sent: [], drafts: [], skips: [], received: [] }

describe('organizationFiguresIn', () => {
  it('never counts a draft or skip whose decider is unknown as a person who decided', () => {
    const team = people(5)
    const activity: OrganizationActivity = {
      ...empty,
      sent: team.map((id) => note(id, 'billing', 1)),
      drafts: [
        ...people(4).map((id) => draft(id, 'billing', 'as_written')),
        draft(null, 'billing', 'discarded'),
        draft(null, 'billing', 'discarded'),
      ],
      skips: [{ memberId: null, place: 'billing', at: NOW - HOUR }],
    }
    const figures = organizationFiguresIn(activity, lastWeek, NOW, settings)!
    expect(figures.sentAsWritten).toBeNull()
    expect(figures.discarded).toBeNull()
    expect(figures.skipped).toBe(1)
    expect(figures.channelAgents).toBeNull()
    const enough = { ...activity, drafts: [...activity.drafts, draft(team[4]!, 'billing', 'edited')] }
    expect(organizationFiguresIn(enough, lastWeek, NOW, settings)).toMatchObject({
      sentAsWritten: 4,
      sentAfterEdits: 1,
      discarded: 2,
    })
  })

  it('shows nothing at all while fewer people than the minimum were active', () => {
    const activity = { ...empty, sent: people(4).map((id) => note(id, 'billing', 1)) }
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)).toBeNull()
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
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)).toMatchObject({
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
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)).toMatchObject({
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
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)?.debateResultsSent).toBeNull()
    expect(organizationFiguresIn(noResults, lastWeek, NOW, settings)?.debateResultsSent).toBeNull()
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
      received: [],
    }
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)).toMatchObject({
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
    const hidden = organizationFiguresIn(fewDeciders, lastWeek, NOW, settings)!
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
    const figures = organizationFiguresIn(oneSmallPlace, lastWeek, NOW, settings)!
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
      organizationFiguresIn(twoLargePlaces, lastWeek, NOW, settings)!.places.map(
        (place) => place.sentAsWritten,
      ),
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
    const figures = organizationFiguresIn(activity, lastWeek, NOW, settings)!
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
      received: [],
    }
    const insights = organizationInsightsOf(activity, { members: 7, blocks: 2 }, NOW, settings)
    expect(JSON.stringify(insights)).not.toContain('mem_secret')
  })
})

describe('drafts by program and model', () => {
  it('hides a label only one person used even when no other group is hidden, since it can name them', () => {
    const [ana, ben, cy] = people(3, 'd')
    const codex = people(3, 'e')
    const activity: OrganizationActivity = {
      sent: [ana!, ben!, cy!, ...codex].map((id) => note(id, null, 1)),
      drafts: [
        { ...draft(ana!, null, 'as_written'), client: 'Ana desk', model: null },
        { ...draft(ben!, null, 'as_written'), client: 'Claude Code', model: null },
        { ...draft(cy!, null, 'edited'), client: 'Claude Code', model: null },
        ...codex.map((id) => ({ ...draft(id, null, 'as_written'), client: 'Codex', model: null })),
      ],
      skips: [],
      received: [],
    }
    const figures = organizationFiguresIn(activity, lastWeek, NOW, { ...settings, minimumGroupSize: 1 })!
    expect(figures.byClient.map((each) => each.label)).toEqual(['Codex'])
    expect(figures.hiddenLabels).toBeGreaterThan(0)
    expect(JSON.stringify(figures)).not.toContain('Ana desk')
  })

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
      received: [],
    }
    const figures = organizationFiguresIn(activity, lastWeek, NOW, settings)!
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
    const shown = organizationFiguresIn(wider, lastWeek, NOW, settings)!
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
      received: [],
    }
    const figures = organizationFiguresIn(activity, lastWeek, NOW, settings)!
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
      received: [],
    }
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)!.byClient[0]?.sentAsWritten).toBe(5)
    const few = {
      ...activity,
      drafts: activity.drafts.map((each, index) =>
        index < 5 && index > 0 ? { ...each, outcome: null } : each,
      ),
    }
    expect(organizationFiguresIn(few, lastWeek, NOW, settings)!.byClient[0]?.sentAsWritten).toBeNull()
  })
})

describe('the figures beside the approval mix', () => {
  it('gives the typical decision time once enough people decided a draft they had seen', () => {
    const team = people(5)
    const activity: OrganizationActivity = {
      ...empty,
      sent: team.map((id) => note(id, null, 1)),
      drafts: [
        ...team.map((id, index) => draft(id, null, 'as_written', index + 1)),
        { ...draft(team[0]!, null, 'edited'), seenAt: null },
      ],
    }
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)?.medianDecisionMs).toBe(3_000)
    const unseen: OrganizationActivity = {
      ...activity,
      drafts: activity.drafts.map((each) => (each.authorId === team[4] ? { ...each, seenAt: null } : each)),
    }
    expect(organizationFiguresIn(unseen, lastWeek, NOW, settings)?.medianDecisionMs).toBeNull()
  })

  it('splits what was sent by who wrote it, hidden together with the draft decisions', () => {
    const team = people(5)
    const sent = [
      ...team.map((id) => note(id, null, 1, null, 'agent')),
      note(team[0]!, null, 2, null, 'human_edited'),
      note(team[1]!, null, 2),
      note(team[2]!, null, 2),
    ]
    const decided: OrganizationActivity = {
      ...empty,
      sent,
      drafts: team.map((id) => draft(id, null, 'as_written')),
    }
    expect(organizationFiguresIn(decided, lastWeek, NOW, settings)?.authorship).toEqual({
      agent: 5,
      humanEdited: 1,
      human: 2,
    })
    const fewDeciders = { ...decided, drafts: decided.drafts.slice(0, 4) }
    expect(organizationFiguresIn(fewDeciders, lastWeek, NOW, settings)?.authorship).toBeNull()
  })

  it('shows delivery once enough people with an agent received a note', () => {
    const team = people(5)
    const activity: OrganizationActivity = {
      ...empty,
      sent: team.map((id) => note(id, null, 1)),
      received: team.map((recipientId) => ({
        recipientId,
        sentAt: NOW - HOUR,
        hasAgent: true,
        pickedUpAt: NOW - HOUR + 60_000,
      })),
    }
    expect(organizationFiguresIn(activity, lastWeek, NOW, settings)?.delivery).toEqual({
      received: 5,
      toAgents: 5,
      pickedUpQuickly: 5,
      medianPickupMs: 60_000,
      waitedWithoutAgent: 0,
    })
    expect(organizationFiguresIn({ ...activity, received: [] }, lastWeek, NOW, settings)?.delivery).toBeNull()
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
    expect(insights.weeks).toHaveLength(8)
    expect(insights.quickWarning).toBe(false)
    expect(DAY_MS).toBe(24 * HOUR)
  })
})
