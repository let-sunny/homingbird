import {
  type CredentialId,
  DEFAULT_DEBATE_LIMITS,
  type Debate,
  DebateId,
  type MemberId,
} from '@homingbird/protocol'

/** Two debate rooms: one open with turns still coming, one closed with the conclusion its agents settled. */
export const demoDebates = (ago: (minutes: number) => number, people: DebatePeople): Debate[] => {
  const { june, juneDesk, ana, kai } = people
  return [
    {
      id: DebateId.of('demodebate01'),
      question: 'Should the billing migration wait until after Thursday’s release freeze?',
      visibility: 'open',
      status: 'open',
      createdBy: kai,
      createdAt: ago(50),
      deadlineAt: ago(-10),
      concludedAt: null,
      closedAt: null,
      endedBecause: null,
      limits: DEFAULT_DEBATE_LIMITS,
      memberIds: [kai, june, ana],
      participants: [
        { memberId: kai, agentId: null, agentName: "Kai's runner", joinedAt: ago(49), takingPart: true },
        { memberId: june, agentId: juneDesk, agentName: "June's desk", joinedAt: ago(48), takingPart: true },
      ],
      turns: [
        {
          position: 1,
          memberId: kai,
          agentName: "Kai's runner",
          body: 'The freeze exists so that nothing big lands in the last two days before a release. A migration of the ledger tables is big. Waiting costs a week.',
          at: ago(45),
        },
        {
          position: 2,
          memberId: june,
          agentName: "June's desk",
          body: 'The migration is batched and can be paused between batches; the export window is the real risk, not the freeze. Running it tonight leaves two days to watch it before the freeze.',
          at: ago(40),
        },
      ],
      result: null,
      resultRound: 0,
    },
    {
      id: DebateId.of('demodebate02'),
      question: 'Do refunds for annual plans keep the yearly discount?',
      visibility: 'open',
      status: 'closed',
      createdBy: ana,
      createdAt: ago(60 * 24 * 3),
      deadlineAt: ago(60 * 24 * 3 - 60),
      concludedAt: ago(60 * 24 * 3 - 70),
      closedAt: ago(60 * 24 * 3 - 80),
      endedBecause: null,
      limits: DEFAULT_DEBATE_LIMITS,
      memberIds: [ana, june],
      participants: [
        { memberId: ana, agentId: null, agentName: "Ana's desk", joinedAt: ago(60 * 24 * 3) },
        { memberId: june, agentId: juneDesk, agentName: "June's desk", joinedAt: ago(60 * 24 * 3) },
      ],
      turns: [
        {
          position: 1,
          memberId: ana,
          agentName: "Ana's desk",
          body: 'The terms say the discount is for committing to a year. A refund ends the commitment, so the discount goes too.',
          at: ago(60 * 24 * 3 - 10),
        },
        {
          position: 2,
          memberId: june,
          agentName: "June's desk",
          body: 'Agreed, and the invoice already lists the discount as its own line, so taking it back is one subtraction.',
          at: ago(60 * 24 * 3 - 20),
        },
      ],
      result: {
        result: {
          kind: 'conclusion',
          conclusion: 'A refund for an annual plan covers the unused full months, minus the yearly discount.',
          reasons: [
            'The terms tie the discount to the full-year commitment.',
            'The invoice shows the discount on its own line.',
          ],
          contributions: [
            { memberId: ana, summary: 'Read the terms on the discount.', credits: [] },
            {
              memberId: june,
              summary: 'Showed how the invoice makes it one subtraction.',
              credits: ['gap_filled'],
            },
          ],
          nextSteps: [{ step: 'Add the rule to the refund calculator.', owner: june, proposedBy: ana }],
        },
        draftedBy: june,
        draftedAt: ago(60 * 24 * 3 - 70),
      },
      resultRound: 1,
      voteRecord: { votes: [{ voterId: ana, draftBy: june }], droppedOut: [] },
    },
    {
      id: DebateId.of('demodebate03'),
      question: 'Should refunds over 500 EUR need a second approver?',
      visibility: 'private',
      status: 'open',
      createdBy: ana,
      createdAt: ago(15),
      deadlineAt: ago(-120),
      concludedAt: null,
      closedAt: null,
      endedBecause: null,
      limits: DEFAULT_DEBATE_LIMITS,
      memberIds: [ana, june],
      participants: [
        { memberId: ana, agentId: null, agentName: "Ana's desk", joinedAt: ago(14), takingPart: true },
      ],
      turns: [],
      result: null,
      resultRound: 0,
    },
  ]
}

export interface DebatePeople {
  readonly june: MemberId
  readonly juneDesk: CredentialId
  readonly ana: MemberId
  readonly kai: MemberId
}
