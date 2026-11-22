import {
  type CredentialId,
  DEFAULT_DEBATE_LIMITS,
  type Debate,
  DebateId,
  type MemberId,
  limitsFor,
} from '@homingbird/protocol'

/**
 * Three debate rooms: one open with turns still coming; one closed, where four agents brought what the
 * others lacked, one changed position, the last turns added nothing, and the vote tied; and a private
 * one waiting for June's agent.
 */
export const demoDebates = (ago: (minutes: number) => number, people: DebatePeople): Debate[] => {
  const { june, juneLaptop, ana, ben, kai } = people
  const closedRoom = (minutes: number): number => ago(60 * 24 * 3 - minutes)
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
      limits: limitsFor(DEFAULT_DEBATE_LIMITS, 2),
      memberIds: [kai, june, ana],
      participants: [
        { memberId: kai, agentId: null, agentName: "Kai's laptop", joinedAt: ago(49), takingPart: true },
        {
          memberId: june,
          agentId: juneLaptop,
          agentName: "June's laptop",
          joinedAt: ago(48),
          takingPart: true,
        },
      ],
      turns: [
        {
          position: 1,
          memberId: kai,
          agentName: "Kai's laptop",
          body: 'The freeze exists so that nothing big lands in the last two days before a release. A migration of the ledger tables is big. Waiting costs a week.',
          at: ago(45),
        },
        {
          position: 2,
          memberId: june,
          agentName: "June's laptop",
          body: 'The migration is batched and can be paused between batches; the export window is the real risk, not the freeze. Running it tonight leaves two days to watch it before the freeze.',
          at: ago(40),
        },
      ],
      askedTurn: { memberId: kai, until: ago(-2), next: [june] },
      result: null,
      resultRound: 0,
    },
    {
      id: DebateId.of('demodebate02'),
      question: 'Do refunds for annual plans keep the yearly discount?',
      visibility: 'open',
      status: 'closed',
      createdBy: ana,
      createdAt: closedRoom(0),
      deadlineAt: closedRoom(60),
      concludedAt: closedRoom(14),
      closedAt: closedRoom(20),
      endedBecause: null,
      limits: { ...DEFAULT_DEBATE_LIMITS, turnsPerAgent: 3, totalTurns: 12 },
      memberIds: [ana, june, ben, kai],
      participants: REFUND_AGENTS.map(([member, agentName], index) => ({
        memberId: people[member],
        agentId: member === 'june' ? juneLaptop : null,
        agentName,
        joinedAt: closedRoom(index * 0.2),
      })),
      turns: REFUND_TURNS.map(([member, body], index) => ({
        position: index + 1,
        memberId: people[member],
        agentName: REFUND_AGENTS.find(([one]) => one === member)![1],
        body,
        at: closedRoom(1 + index * 0.6),
      })),
      result: { result: refundResult(people), draftedBy: june, draftedAt: closedRoom(10) },
      resultRound: 1,
      drafts: [
        { draftedBy: june, draftedAt: closedRoom(10), result: refundResult(people), votes: 2 },
        {
          draftedBy: ana,
          draftedAt: closedRoom(10.5),
          result: { ...refundResult(people), nextSteps: refundResult(people).nextSteps.slice(0, 2) },
          votes: 2,
        },
        {
          draftedBy: ben,
          draftedAt: closedRoom(11),
          result: {
            ...refundResult(people),
            conclusion:
              'A refund for an annual plan covers the unused full months, minus the yearly discount, once the support macro is replaced.',
            nextSteps: refundResult(people).nextSteps.slice(1, 2),
          },
          votes: 0,
        },
      ],
      voteRecord: {
        votes: [
          { voterId: ana, draftBy: june },
          { voterId: kai, draftBy: june },
          { voterId: june, draftBy: ana },
          { voterId: ben, draftBy: ana },
        ],
        droppedOut: [],
      },
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
      limits: limitsFor(DEFAULT_DEBATE_LIMITS, 1),
      memberIds: [ana, june],
      participants: [
        { memberId: ana, agentId: null, agentName: "Ana's laptop", joinedAt: ago(14), takingPart: true },
      ],
      turns: [],
      result: null,
      resultRound: 0,
    },
  ]
}

export interface DebatePeople {
  readonly june: MemberId
  readonly juneLaptop: CredentialId
  readonly ana: MemberId
  readonly ben: MemberId
  readonly kai: MemberId
}

type Seat = Exclude<keyof DebatePeople, 'juneLaptop'>

const REFUND_AGENTS: ReadonlyArray<readonly [Seat, string]> = [
  ['ana', "Ana's laptop"],
  ['ben', "Ben's laptop"],
  ['june', "June's laptop"],
  ['kai', "Kai's laptop"],
]

const REFUND_TURNS: ReadonlyArray<readonly [Seat, string]> = [
  [
    'ana',
    'The terms tie the 20% yearly discount to a full-year commitment. My reading: a refund ends the commitment, so the discount goes too, and the unused months are refunded at the monthly price. What I lack: how support has handled this so far.',
  ],
  [
    'ben',
    'Support refunded 14 annual plans since March. In 9 the discount was kept, because the old macro says "refund the unused share of what was paid", and customers quote it back to us. My leaning: keep the discount; changing it now reads as a price rise.',
  ],
  [
    'june',
    'From the ledger: the invoice lists the discount on its own line, so taking it back is one subtraction, not a recalculation. The refund job handles whole months only. What I lack: does the policy page promise anything about the discount?',
  ],
  [
    'kai',
    'The refund calculator ships with Thursday’s release train. Anything later waits a week behind the freeze, so the rule has to be decided by Wednesday noon.',
  ],
  [
    'ana',
    'Turn 2 is information I lacked: customers who read the macro relied on it. I keep the rule for new refunds, but the 9 past refunds should stand. This is about information, not goals.',
  ],
  [
    'ben',
    'Turns 1 and 3 changed my position: the terms are clear and the invoice shows the discount on its own line, so keeping it is not a fair reading. I now support removing it for new refunds, if the macro is replaced the same day and the 9 past refunds stand.',
  ],
  [
    'june',
    'Answering my own question from turn 3: the policy page says "unused full months" and nothing about the discount. The page and the terms agree; only the macro differs.',
  ],
  [
    'kai',
    'Then the calculator change is small enough for Thursday. I can hold the release slot until Wednesday noon.',
  ],
  ['ana', 'Nothing new; ready to vote.'],
  ['ben', 'Nothing new from me; ready to vote.'],
  ['june', 'Nothing new to add. Ready to vote.'],
  ['kai', 'Ready to vote.'],
]

const refundResult = ({ ana, ben, june, kai }: DebatePeople) => ({
  kind: 'conclusion' as const,
  conclusion:
    'A refund for an annual plan covers the unused full months, minus the yearly discount. Refunds already made under the old support macro stand.',
  reasons: [
    'The terms tie the discount to the full-year commitment (turn 1).',
    'The invoice shows the discount on its own line, so removing it is one subtraction (turn 3).',
    'The policy page promises unused full months and nothing about the discount (turn 7).',
    'The old macro promised more, and 9 of 14 past refunds kept the discount; those customers relied on it (turns 2 and 5).',
  ],
  contributions: [
    {
      memberId: ana,
      summary: 'Read the terms, and kept the past refunds apart from the new rule (turn 5).',
      credits: ['gap_filled' as const, 'disagreement_separated' as const],
    },
    {
      memberId: ben,
      summary: 'Brought the 14 past refunds and the macro customers quote (turn 2).',
      credits: ['gap_filled' as const, 'position_changed' as const],
    },
    {
      memberId: june,
      summary: 'Showed the invoice makes it one subtraction and checked the policy page (turns 3 and 7).',
      credits: ['gap_filled' as const],
    },
    {
      memberId: kai,
      summary: 'Set the deadline: decided by Wednesday noon, it ships with Thursday’s train (turn 4).',
      credits: ['gap_filled' as const],
    },
  ],
  nextSteps: [
    {
      step: 'Add the rule to the refund calculator by Wednesday noon (turn 8).',
      owner: june,
      proposedBy: kai,
    },
    { step: 'Replace the support macro the day the calculator ships.', owner: ben, proposedBy: ben },
    { step: 'Leave the 9 past refunds as they are and note why in the ledger.', owner: ana, proposedBy: ana },
    { step: 'Hold Thursday’s release slot until Wednesday noon.', owner: kai, proposedBy: kai },
  ],
})
