import type { Debate } from '../src/debates.ts'
import { CredentialId, DebateId, MemberId } from '../src/ids.ts'

export const ANA = MemberId.of('ana000000000')
export const BEN = MemberId.of('ben000000000')
export const GONE = MemberId.of('gone00000000')

export const PEOPLE = new Map([
  [ANA, { name: 'Ana', email: 'ana@example.com' }],
  [BEN, { name: 'Ben', email: 'ben@example.com' }],
])

export const nameOf = (id: MemberId): string => PEOPLE.get(id)?.name ?? 'A former member'

export const roomOf = (overrides: Partial<Debate> = {}): Debate => ({
  id: DebateId.of('debate000000'),
  question: 'Should we ship the billing migration this week?',
  visibility: 'private',
  status: 'closed',
  createdBy: ANA,
  createdAt: Date.UTC(2026, 10, 2, 9),
  deadlineAt: Date.UTC(2026, 10, 2, 10),
  concludedAt: Date.UTC(2026, 10, 2, 9, 30),
  closedAt: Date.UTC(2026, 10, 2, 9, 45),
  endedBecause: null,
  resultRound: 0,
  limits: { turnsPerAgent: 2, totalTurns: 4, minutes: 60, turnCharacters: 500 },
  memberIds: [ANA, BEN],
  participants: [
    { memberId: ANA, agentId: CredentialId.of('anaagent0000'), agentName: 'Laptop', joinedAt: 1 },
    { memberId: BEN, agentId: CredentialId.of('benagent0000'), agentName: 'Desk', joinedAt: 2 },
  ],
  turns: [
    {
      position: 1,
      memberId: ANA,
      agentName: 'Laptop',
      body: 'The March report\nsays the rollback failed.',
      at: Date.UTC(2026, 10, 2, 9, 5),
    },
    {
      position: 2,
      memberId: BEN,
      agentName: 'Desk',
      body: 'I had not read it.',
      at: Date.UTC(2026, 10, 2, 9, 10),
    },
  ],
  result: {
    result: {
      kind: 'conclusion',
      conclusion: 'Ship on Thursday.',
      reasons: ['The rollback is tested.'],
      contributions: [
        { memberId: ANA, summary: 'Named the March report.', credits: ['gap_filled'] },
        { memberId: BEN, summary: 'Changed position.', credits: [] },
      ],
      nextSteps: [
        { step: 'Share the rollback plan.', owner: BEN, proposedBy: ANA },
        { step: 'Decide the date.', owner: null, proposedBy: BEN },
      ],
    },
    draftedBy: ANA,
    draftedAt: Date.UTC(2026, 10, 2, 9, 40),
  },
  voteRecord: { votes: [{ voterId: BEN, draftBy: ANA }], droppedOut: [] },
  ...overrides,
})

export const NO_CONCLUSION: NonNullable<Debate['result']> = {
  result: {
    kind: 'no_conclusion',
    summary: 'They did not agree.',
    points: [{ point: 'Risk', category: 'open_question', explanation: 'Nobody knew the load.' }],
    contributions: [
      { memberId: ANA, summary: 'Asked about the load.', credits: ['disagreement_separated'] },
      { memberId: BEN, summary: 'Named the goal.', credits: [] },
    ],
    nextSteps: [],
  },
  draftedBy: BEN,
  draftedAt: 3,
}
