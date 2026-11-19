import type { AsRead } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type DebateRoomInput, debateRoomModel, resultDestination } from '../../src/models/debate-room.ts'
import { timeShown } from '../../src/models/time.ts'
import { formats, strings } from '../../src/strings.ts'
import { ANA, BEN, CY, channel, credential, debate, entry, member } from '../support/fixtures.ts'

const members = new Map([
  [ANA, member(ANA, 'Ana')],
  [BEN, member(BEN, 'Ben')],
])

const input = (room: DebateRoomInput['debate'], fields: Partial<DebateRoomInput> = {}): DebateRoomInput => ({
  debate: room,
  viewerId: ANA,
  members,
  agents: [],
  channels: [],
  directory: [],
  now: 10,
  ...fields,
})

const room = (model: ReturnType<typeof debateRoomModel>) => {
  if (model.kind !== 'room') throw new Error('expected a room')
  return model
}

const participant = (memberId: typeof ANA, fields: Partial<AsRead.Debate['participants'][number]> = {}) => ({
  memberId,
  agentId: null,
  agentName: `${memberId} desk`,
  joinedAt: 1,
  ...fields,
})

const conclusion = {
  kind: 'conclusion' as const,
  conclusion: 'Ship.',
  reasons: ['Tests pass.'],
  nextSteps: [
    { step: 'Tag it', owner: BEN, proposedBy: ANA },
    { step: 'Tell support', owner: null, proposedBy: BEN },
  ],
  contributions: [{ memberId: BEN, summary: 'Checked the tests.', credits: ['gap_filled' as const] }],
}

describe('debateRoomModel', () => {
  it('waits for the room and says when the person may not see it', () => {
    expect(debateRoomModel(input(null))).toEqual({ kind: 'loading' })
    expect(debateRoomModel(input('missing'))).toEqual({ kind: 'missing', text: strings.debates.notFound })
  })

  it('shows an open room waiting for agents, with its limits, and lets its opener change them', () => {
    const model = room(
      debateRoomModel(input(debate({ visibility: 'private' }), { agents: [credential('cred_desk')] })),
    )
    expect(model).toMatchObject({
      question: 'Ship on Friday?',
      stage: 'gathering',
      stageText: strings.debates.stage.gathering,
      isPrivate: true,
      closesAt: strings.debates.closesAt({ time: formats.full.format(new Date(2)) }),
      mayChangeLimits: true,
      limitsFixed: false,
      participants: [],
      optIn: { kind: 'choose', agents: [{ value: 'cred_desk', label: 'cred_desk' }] },
      turns: { kind: 'none', text: strings.debates.waitingForSecond },
      ended: null,
      result: null,
      drafts: null,
      closed: null,
    })
    expect(model.limits).toBe(
      strings.debates.limitsSummary({ perAgent: 2, total: 4, minutes: 30, characters: 300 }),
    )
    expect(room(debateRoomModel(input(debate())))).toMatchObject({
      optIn: { kind: 'no-agent', text: strings.debates.noAgent },
    })
  })

  it('shows the agents taking part, their turns left, who dropped out, and the turns so far', () => {
    const model = room(
      debateRoomModel(
        input(
          debate({
            participants: [participant(ANA), participant(BEN, { takingPart: false })],
            turns: [{ position: 1, memberId: ANA, agentName: 'Ana desk', body: 'We should.', at: 5 }],
          }),
        ),
      ),
    )
    expect(model.stage).toBe('debating')
    expect(model.limitsFixed).toBe(true)
    expect(model.mayChangeLimits).toBe(false)
    expect(model.optIn).toBeNull()
    expect(model.participants).toEqual([
      {
        memberId: ANA,
        name: strings.debates.agentOf({ agent: `${ANA} desk`, person: 'Ana' }),
        turnsLeft: strings.debates.turnsLeft({ count: 1 }),
        droppedOut: null,
      },
      {
        memberId: BEN,
        name: strings.debates.agentOf({ agent: `${BEN} desk`, person: 'Ben' }),
        turnsLeft: strings.debates.turnsLeft({ count: 2 }),
        droppedOut: strings.debates.droppedOut,
      },
    ])
    expect(model.turns).toEqual({
      kind: 'turns',
      turns: [
        {
          position: 1,
          mine: true,
          author: strings.debates.agentOf({ agent: 'Ana desk', person: 'Ana' }),
          time: timeShown(5, 10),
          body: 'We should.',
        },
      ],
    })
  })

  it('says an agent dropped out while the room concludes, and no longer once it closed', () => {
    const dropped = (status: AsRead.Debate['status']) =>
      room(
        debateRoomModel(input(debate({ status, participants: [participant(BEN, { takingPart: false })] }))),
      ).participants[0]!.droppedOut
    expect(dropped('concluding')).toBe(strings.debates.droppedOut)
    expect(dropped('closed')).toBeNull()
  })

  it('says why an ended room ended, and that a later stage has no turns', () => {
    const ended = room(debateRoomModel(input(debate({ status: 'ended', endedBecause: 'one_agent_left' }))))
    expect(ended.ended).toBe(strings.debates.ended.one_agent_left)
    expect(ended.closesAt).toBeNull()
    expect(ended.turns).toEqual({ kind: 'none', text: strings.debates.noTurns })
    expect(room(debateRoomModel(input(debate({ status: 'ended' })))).ended).toBe(
      strings.debates.ended.no_turns,
    )
  })

  it('waits for the result while drafts are collected and the agents vote', () => {
    const waiting = room(
      debateRoomModel(
        input(debate({ status: 'concluding', draftsCloseAt: 3, votingClosesAt: 4, votedBy: [BEN] })),
      ),
    )
    expect(waiting.result).toEqual({
      kind: 'waiting',
      text: strings.debates.waitingForResult,
      collecting: strings.debates.collectingUntil({ time: formats.full.format(new Date(3)) }),
      voting: `${strings.debates.votingUntil({ time: formats.full.format(new Date(4)) })} ${strings.debates.votedCount({ count: 1 })}`,
    })
    expect(room(debateRoomModel(input(debate({ status: 'concluding' })))).result).toMatchObject({
      collecting: null,
      voting: null,
    })
    expect(
      room(debateRoomModel(input(debate({ status: 'concluding', votingClosesAt: 4 })))).result,
    ).toMatchObject({
      voting: `${strings.debates.votingUntil({ time: formats.full.format(new Date(4)) })} ${strings.debates.votedCount({ count: 0 })}`,
    })
  })

  it('shows a closed room’s result, its drafts, the vote record, and how to post or export it', () => {
    const model = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            participants: [participant(ANA), participant(BEN), participant(CY)],
            turns: [{ position: 1, memberId: ANA, agentName: 'Ana desk', body: 'Yes.', at: 5 }],
            result: { result: conclusion, draftedBy: BEN, draftedAt: 6 },
            drafts: [
              { draftedBy: BEN, draftedAt: 6, result: conclusion, votes: 2 },
              { draftedBy: ANA, draftedAt: 7, result: { kind: 'unknown' } as never, votes: null },
            ],
            voteRecord: { votes: [{ voterId: ANA, draftBy: BEN }], droppedOut: [CY] },
          }),
          {
            channels: [channel('billing', { joined: true }), channel('ops')],
            directory: [entry(ANA, 'Ana'), entry(BEN, 'Ben'), entry(CY, 'Cy', { canMessage: false })],
          },
        ),
      ),
    )
    expect(model.result).toMatchObject({
      kind: 'settled',
      draftedBy: strings.debates.draftedBy({ person: 'Ben' }),
      body: {
        kind: 'known',
        heading: strings.debates.conclusion,
        summary: 'Ship.',
        listHeading: strings.debates.reasons,
        reasons: ['Tests pass.'],
        points: null,
        nextSteps: {
          none: null,
          steps: [
            {
              step: 'Tag it',
              owner: strings.debates.owner({ person: 'Ben' }),
              proposedBy: strings.debates.proposedBy({ person: 'Ana' }),
            },
            { step: 'Tell support', owner: null, proposedBy: strings.debates.proposedBy({ person: 'Ben' }) },
          ],
        },
        contributions: {
          rows: [
            { name: 'Ben', summary: 'Checked the tests.', credits: [strings.debates.credit.gap_filled] },
          ],
        },
      },
      voteRecord: {
        title: strings.debates.voteRecordTitle,
        none: null,
        lines: [
          { kind: 'voted', memberId: ANA, text: strings.debates.votedFor({ voter: 'Ana', author: 'Ben' }) },
          { kind: 'silent', memberId: BEN, text: strings.debates.didNotVote({ person: 'Ben' }) },
          {
            kind: 'dropped-out',
            memberId: CY,
            text: strings.debates.droppedOutWithoutVote({ person: strings.formerMember }),
          },
        ],
      },
    })
    expect(model.drafts).toEqual([
      expect.objectContaining({ memberId: BEN, chosen: true, votes: strings.debates.votes({ count: 2 }) }),
      expect.objectContaining({
        memberId: ANA,
        chosen: false,
        votes: null,
        body: { kind: 'unknown', text: strings.debates.unknownResult },
      }),
    ])
    expect(model.closed).toEqual({
      mayPost: true,
      channels: [{ value: 'billing', label: '#billing' }],
      people: [{ value: BEN, label: 'Ben' }],
    })
  })

  it('shows a result without a conclusion as its points of disagreement, and a vote record with no vote', () => {
    const disagreement = {
      kind: 'disagreement' as const,
      summary: 'Split.',
      points: [{ point: 'Risk', category: 'information' as const, explanation: 'Weighed differently.' }],
      nextSteps: [],
      contributions: [],
    }
    const model = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            createdBy: BEN,
            result: { result: disagreement as never, draftedBy: ANA, draftedAt: 6 },
            voteRecord: { votes: [], droppedOut: [] },
          }),
        ),
      ),
    )
    expect(model.result).toMatchObject({
      body: {
        heading: strings.debates.noConclusion,
        summary: 'Split.',
        listHeading: strings.debates.disagreements,
        reasons: null,
        points: [
          {
            category: 'information',
            point: 'Risk',
            categoryText: strings.debates.category.information,
            explanation: 'Weighed differently.',
          },
        ],
        nextSteps: { none: strings.debates.noNextSteps, steps: [] },
      },
      voteRecord: { none: strings.debates.noVote, lines: [] },
    })
    expect(model.closed!.mayPost).toBe(false)
    const unrecorded = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            result: { result: disagreement as never, draftedBy: ANA, draftedAt: 6 },
          }),
        ),
      ),
    )
    expect(unrecorded.result).toMatchObject({ voteRecord: null })
  })
})

describe('resultDestination', () => {
  it('posts to the channel chosen first, else to the person, else nowhere yet', () => {
    expect(resultDestination('billing', BEN)).toEqual({ channel: 'billing' })
    expect(resultDestination('', BEN)).toEqual({ to: BEN })
    expect(resultDestination('', '')).toBeNull()
  })
})
