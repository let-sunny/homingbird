import { CredentialId, type Debate, DebateId, type DebateSummary, MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  debateStage,
  limitsFrom,
  listedDebates,
  mayChangeLimits,
  mayDecide,
  mayOptIn,
  peopleIn,
  summaryStage,
  takesPart,
  turnsLeftFor,
} from '../src/debates.ts'

const ANA = MemberId.of('ana000000000')
const BEN = MemberId.of('ben000000000')
const CY = MemberId.of('cy0000000000')

const participant = (memberId: MemberId) => ({
  memberId,
  agentId: CredentialId.of(`${memberId.slice(4, 7)}agent00000`),
  agentName: 'Agent',
  joinedAt: 1,
})

const RESULT = {
  result: {
    kind: 'conclusion' as const,
    conclusion: 'Ship.',
    reasons: ['Tested.'],
    contributions: [],
    nextSteps: [],
  },
  draftedBy: ANA,
  draftedAt: 3,
}

const room = (overrides: Partial<Debate> = {}): Debate => ({
  id: DebateId.of('debate000000'),
  question: 'Ship?',
  visibility: 'open',
  status: 'open',
  createdBy: ANA,
  createdAt: 1,
  deadlineAt: 2,
  concludedAt: null,
  closedAt: null,
  endedBecause: null,
  resultRound: 0,
  limits: { turnsPerAgent: 2, totalTurns: 4, minutes: 30, turnCharacters: 300 },
  memberIds: [ANA, BEN],
  participants: [participant(ANA), participant(BEN)],
  turns: [{ position: 1, memberId: ANA, agentName: 'Agent', body: 'x', at: 1 }],
  result: null,
  approvals: [
    { memberId: ANA, approvedAt: null },
    { memberId: BEN, approvedAt: 5 },
  ],
  ...overrides,
})

describe('where a room stands', () => {
  it('gathers agents, debates, waits for a result, waits for approval, then closes', () => {
    expect(debateStage(room({ participants: [participant(ANA)] }))).toBe('gathering')
    expect(debateStage(room())).toBe('debating')
    expect(debateStage(room({ status: 'concluding' }))).toBe('awaiting-result')
    expect(debateStage(room({ status: 'concluding', result: RESULT }))).toBe('awaiting-approval')
    expect(debateStage(room({ status: 'closed', result: RESULT }))).toBe('closed')
    expect(debateStage(room({ status: 'ended', endedBecause: 'no_turns' }))).toBe('ended')
  })

  it('lets only a participant’s person who has not approved yet decide on the result', () => {
    const waiting = room({ status: 'concluding', result: RESULT })
    expect(mayDecide(waiting, ANA)).toBe(true)
    expect(mayDecide(waiting, BEN)).toBe(false)
    expect(mayDecide(waiting, CY)).toBe(false)
    expect(mayDecide(room(), ANA)).toBe(false)
  })

  it('offers opting in to people whose agent is not in an open room with room to spare', () => {
    expect(mayOptIn(room(), CY)).toBe(true)
    expect(mayOptIn(room(), ANA)).toBe(false)
    expect(mayOptIn(room({ status: 'concluding' }), CY)).toBe(false)
    const full = room({
      participants: Array.from({ length: 8 }, (_, index) => participant(MemberId.of(`p${index}00000000000`))),
    })
    expect(mayOptIn(full, CY)).toBe(false)
    expect(takesPart(room(), BEN)).toBe(true)
  })

  it('lets the creator change limits while the room is open, and counts each agent’s turns left', () => {
    expect(mayChangeLimits(room(), ANA)).toBe(true)
    expect(mayChangeLimits(room(), BEN)).toBe(false)
    expect(mayChangeLimits(room({ status: 'closed' }), ANA)).toBe(false)
    expect(turnsLeftFor(room(), ANA)).toBe(1)
    expect(turnsLeftFor(room({ limits: { ...room().limits, turnsPerAgent: 1 } }), ANA)).toBe(0)
    expect(turnsLeftFor(room(), BEN)).toBe(2)
  })
})

describe('typed limits', () => {
  it('clamps each limit into its bounds, takes the default for a blank, and names limits that do not add up', () => {
    expect(
      limitsFrom({ turnsPerAgent: '0', totalTurns: '500', minutes: '', turnCharacters: '1200' }),
    ).toEqual({
      limits: { turnsPerAgent: 1, totalTurns: 100, minutes: 60, turnCharacters: 1200 },
    })
    expect(limitsFrom({ turnsPerAgent: '9', totalTurns: '4', minutes: '30', turnCharacters: '300' })).toEqual(
      {
        problem: 'Turns per agent cannot be more than the total turns.',
      },
    )
  })
})

describe('the list of rooms', () => {
  const summary = (id: string, status: DebateSummary['status'], createdAt: number): DebateSummary => ({
    id: DebateId.of(id),
    question: 'Q?',
    visibility: 'open',
    status,
    createdBy: ANA,
    createdAt,
    deadlineAt: 9,
    participantIds: [],
    turnCount: 0,
    resultDrafted: false,
    joined: false,
  })

  it('puts rooms still under way first, newest first within each', () => {
    const listed = listedDebates([
      summary('closed000000', 'closed', 3),
      summary('ended0000000', 'ended', 4),
      summary('older0000000', 'open', 1),
      summary('newer0000000', 'concluding', 2),
    ])
    expect(listed.map((one) => one.id)).toEqual([
      'deb_newer0000000',
      'deb_older0000000',
      'deb_ended0000000',
      'deb_closed000000',
    ])
  })

  it('tells the stage of a listed room from its counts', () => {
    expect(summaryStage(summary('room00000000', 'open', 1))).toBe('gathering')
    expect(summaryStage({ ...summary('room00000000', 'concluding', 1), resultDrafted: true })).toBe(
      'awaiting-approval',
    )
  })

  it('names everyone a room mentions once', () => {
    expect(peopleIn(room({ memberIds: [ANA, BEN, CY] }))).toEqual([ANA, BEN, CY])
  })
})
