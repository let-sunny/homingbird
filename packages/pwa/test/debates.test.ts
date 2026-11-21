import {
  type AsRead,
  CredentialId,
  type Debate,
  DebateId,
  type DebateSummary,
  MemberId,
} from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  debateStage,
  draftsOf,
  graceOf,
  limitsFrom,
  listedDebates,
  mayChangeLimits,
  mayOptIn,
  peopleIn,
  summaryStage,
  takesPart,
  tookATurn,
  turnsLeftFor,
  voteRecordLines,
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

const room = (overrides: Partial<AsRead.Debate> = {}): AsRead.Debate => ({
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
  ...overrides,
})

describe('where a room stands', () => {
  it('gathers agents, debates, waits for the agents to settle the result, then closes', () => {
    expect(debateStage(room({ participants: [participant(ANA)] }))).toBe('gathering')
    expect(debateStage(room())).toBe('debating')
    expect(debateStage(room({ status: 'concluding' }))).toBe('awaiting-result')
    expect(debateStage(room({ status: 'concluding', votingClosesAt: null }))).toBe('awaiting-result')
    expect(debateStage(room({ status: 'concluding', votingClosesAt: 9 }))).toBe('voting')
    expect(debateStage(room({ status: 'closed', result: RESULT }))).toBe('closed')
    expect(debateStage(room({ status: 'ended', endedBecause: 'no_turns' }))).toBe('ended')
    expect(debateStage(room({ status: 'unknown' }))).toBe('unknown')
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

  it('lets the creator change limits only before the first turn, and counts each agent’s turns left', () => {
    expect(mayChangeLimits(room({ turns: [] }), ANA)).toBe(true)
    expect(mayChangeLimits(room(), ANA)).toBe(false)
    expect(mayChangeLimits(room({ turns: [] }), BEN)).toBe(false)
    expect(mayChangeLimits(room({ status: 'closed' }), ANA)).toBe(false)
    expect(turnsLeftFor(room(), ANA)).toBe(1)
    expect(turnsLeftFor(room({ limits: { ...room().limits, turnsPerAgent: 1 } }), ANA)).toBe(0)
    expect(turnsLeftFor(room(), BEN)).toBe(2)
  })
})

describe('the drafts of a result', () => {
  const draft = (draftedBy: MemberId, votes: number | null) => ({
    draftedBy,
    draftedAt: 2,
    result: RESULT.result,
    votes,
  })

  it('marks the chosen draft once the agents chose it, and none before', () => {
    const drafts = [draft(ANA, 2), draft(BEN, 1)]
    expect(draftsOf(room({ status: 'concluding', drafts, result: RESULT })).map((one) => one.chosen)).toEqual(
      [true, false],
    )
    expect(draftsOf(room({ status: 'concluding', drafts })).map((one) => one.chosen)).toEqual([false, false])
    expect(draftsOf(room())).toEqual([])
  })
})

describe('typed limits', () => {
  it('clamps each limit into its bounds, takes the default for a blank, and names limits that do not add up', () => {
    expect(
      limitsFrom({ turnsPerAgent: '0', totalTurns: '500', minutes: '', turnCharacters: '1200' }),
    ).toEqual({
      limits: { turnsPerAgent: 1, totalTurns: 100, minutes: 60, turnCharacters: 1200, graceMinutes: 5 },
    })
    expect(limitsFrom({ turnsPerAgent: '9', totalTurns: '', minutes: '30', turnCharacters: '300' })).toEqual({
      limits: { turnsPerAgent: 4, minutes: 30, turnCharacters: 300, graceMinutes: 5 },
    })
    expect(
      limitsFrom({
        turnsPerAgent: '2',
        totalTurns: '4',
        minutes: '30',
        turnCharacters: '300',
        graceMinutes: '30',
      }),
    ).toMatchObject({ limits: { graceMinutes: 30 } })
    expect(
      limitsFrom({
        turnsPerAgent: '2',
        totalTurns: '4',
        minutes: '30',
        turnCharacters: '300',
        graceMinutes: '15',
      }),
    ).toMatchObject({ limits: { graceMinutes: 5 } })
    expect(limitsFrom({ turnsPerAgent: '4', totalTurns: '3', minutes: '30', turnCharacters: '300' })).toEqual(
      {
        problem: 'Turns per agent cannot be more than the total turns.',
      },
    )
  })
})

describe('the grace and the vote record', () => {
  it('reads the room’s grace, five minutes when it says none', () => {
    expect(graceOf({ ...room().limits, graceMinutes: 10 })).toBe(10)
    expect(graceOf(room().limits)).toBe(5)
    expect(graceOf({ ...room().limits, graceMinutes: 'unknown' })).toBe(5)
  })

  it('lets only a person whose agent took a turn post the result', () => {
    expect(tookATurn(room(), ANA)).toBe(true)
    expect(tookATurn(room(), BEN)).toBe(false)
  })

  it('lists each vote, then each agent that dropped out or did not vote in time', () => {
    const closed = room({
      status: 'closed',
      participants: [participant(ANA), participant(BEN), participant(CY)],
      drafts: [
        { draftedBy: ANA, draftedAt: 1, result: RESULT.result, votes: 1 },
        { draftedBy: BEN, draftedAt: 2, result: RESULT.result, votes: 0 },
      ],
      voteRecord: { votes: [{ voterId: BEN, draftBy: ANA }], droppedOut: [CY] },
    })
    expect(voteRecordLines(closed)).toEqual([
      { kind: 'voted', memberId: BEN, draftBy: ANA },
      { kind: 'silent', memberId: ANA, draftBy: null },
      { kind: 'dropped-out', memberId: CY, draftBy: null },
    ])
  })

  it('lists nothing when the result was the only draft and nobody voted', () => {
    expect(voteRecordLines(room({ voteRecord: { votes: [], droppedOut: [] } }))).toEqual([])
    expect(voteRecordLines(room())).toEqual([])
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
    totalTurns: 4,
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
    expect(summaryStage(summary('room00000000', 'concluding', 1))).toBe('awaiting-result')
  })

  it('names everyone a room mentions once', () => {
    expect(peopleIn(room({ memberIds: [ANA, BEN, CY] }))).toEqual([ANA, BEN, CY])
  })
})
