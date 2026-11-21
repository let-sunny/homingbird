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
  tab: null,
  viewerId: ANA,
  members,
  agents: [],
  channels: [],
  directory: [],
  serverInfo: null,
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
        name: strings.debates.mine.agentOf({ agent: `${ANA} desk` }),
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
      taken: strings.debates.turnsTaken({ count: 1, total: 4 }),
      timing: strings.debates.turnTimes({
        first: formats.full.format(new Date(5)),
        last: formats.full.format(new Date(5)),
      }),
      groups: [
        {
          kind: 'turn',
          turn: {
            position: 1,
            label: strings.debates.turnLabel({ position: 1 }),
            mine: true,
            author: strings.debates.mine.agentOf({ agent: 'Ana desk' }),
            details: expect.objectContaining({ line: strings.authorship.agentYou }),
            time: timeShown(5, 10),
            body: [{ kind: 'text', text: 'We should.' }],
            filler: null,
            changedPosition: null,
            focused: false,
          },
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
    const drafting = room(debateRoomModel(input(debate({ status: 'concluding', draftsCloseAt: 3 }))))
    expect(drafting.result).toEqual({
      kind: 'waiting',
      text: strings.debates.waitingForResult,
      collecting: strings.debates.collectingUntil({ time: formats.full.format(new Date(3)) }),
      voting: null,
    })
    expect(room(debateRoomModel(input(debate({ status: 'concluding' })))).result).toMatchObject({
      text: strings.debates.waitingForResult,
      collecting: null,
      voting: null,
    })
    const voting = room(
      debateRoomModel(input(debate({ status: 'concluding', votingClosesAt: 4, votedBy: [BEN] }))),
    )
    expect(voting.result).toEqual({
      kind: 'waiting',
      text: strings.debates.waitingForVotes,
      collecting: null,
      voting: `${strings.debates.votingUntil({ time: formats.full.format(new Date(4)) })} ${strings.debates.votedCount({ count: 1 })}`,
    })
    expect(
      room(debateRoomModel(input(debate({ status: 'concluding', votingClosesAt: 4 })))).result,
    ).toMatchObject({
      voting: `${strings.debates.votingUntil({ time: formats.full.format(new Date(4)) })} ${strings.debates.votedCount({ count: 0 })}`,
    })
    expect(room(debateRoomModel(input(debate({ status: 'closed' })))).result).toMatchObject({
      kind: 'waiting',
      text: null,
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
        summary: [{ kind: 'text', text: 'Ship.' }],
        listHeading: strings.debates.reasons,
        reasons: [[{ kind: 'text', text: 'Tests pass.' }]],
        points: null,
        nextSteps: {
          none: null,
          steps: [
            {
              step: [{ kind: 'text', text: 'Tag it' }],
              owner: strings.debates.owner({ person: 'Ben' }),
              proposedBy: strings.debates.mine.proposedBy,
            },
            {
              step: [{ kind: 'text', text: 'Tell support' }],
              owner: null,
              proposedBy: strings.debates.proposedBy({ person: 'Ben' }),
            },
          ],
        },
        contributions: {
          rows: [
            {
              name: 'Ben',
              summary: [{ kind: 'text', text: 'Checked the tests.' }],
              credits: [
                { text: strings.debates.credit.gap_filled, hint: strings.debates.creditHint.gap_filled },
              ],
            },
          ],
        },
      },
      voteRecord: {
        none: null,
        tally: [
          {
            memberId: BEN,
            draft: strings.debates.draftOf({ person: 'Ben' }),
            votes: strings.debates.votes({ count: 2 }),
            chosen: true,
          },
          {
            memberId: ANA,
            draft: strings.debates.mine.draftOf,
            votes: strings.debates.votes({ count: 0 }),
            chosen: false,
          },
        ],
        tie: null,
        lines: [
          { kind: 'voted', memberId: ANA, text: strings.debates.mine.votedFor({ author: 'Ben' }) },
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
      chooseFirst: strings.debates.chooseDestination,
    })
    expect(model.votes).toEqual({
      voting: null,
      record: model.result?.kind === 'settled' ? model.result.voteRecord : 'expected a vote record',
    })
    expect(model.credit).toEqual({
      shared: null,
      rows: [
        {
          memberId: BEN,
          name: 'Ben',
          summary: [{ kind: 'text', text: 'Checked the tests.' }],
          credits: [{ text: strings.debates.credit.gap_filled, hint: strings.debates.creditHint.gap_filled }],
          turns: [{ kind: 'text', text: strings.debates.noTurnTaken }],
          filler: null,
          positionChange: null,
          keptSteps: [[{ kind: 'text', text: 'Tell support' }]],
        },
        {
          memberId: ANA,
          name: strings.debates.mine.agent,
          summary: null,
          credits: [],
          turns: expect.arrayContaining([
            { kind: 'turn', text: 'turn 1', href: '#/debate/debate_000000000000/turns?turn=1' },
          ]),
          filler: null,
          positionChange: null,
          keptSteps: [[{ kind: 'text', text: 'Tag it' }]],
        },
      ],
    })
    expect(model.moved).toEqual([])
    const moving = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            participants: [participant(ANA), participant(BEN)],
            turns: [
              { position: 1, memberId: BEN, agentName: 'Ben desk', body: 'Friday.', at: 5 },
              {
                position: 2,
                memberId: BEN,
                agentName: 'Ben desk',
                body: 'I now agree with Thursday.',
                at: 6,
              },
            ],
            result: { result: conclusion, draftedBy: BEN, draftedAt: 7 },
          }),
        ),
      ),
    )
    expect(moving.moved.map((move) => [move.memberId, move.text.map((part) => part.text).join('')])).toEqual([
      [
        BEN,
        strings.debates.movedLine({ agent: strings.debates.personAgent({ person: 'Ben' }), from: 1, to: 2 }),
      ],
    ])
    expect(model.tabs.map((tab) => [tab.tab, tab.current])).toEqual([
      ['result', true],
      ['votes', false],
      ['credit', false],
      ['turns', false],
    ])
  })

  it('opens a room still taking turns on its turns and any later one on its result, unless a tab is asked for', () => {
    const shownFor = (fields: Parameters<typeof debate>[0], tab: DebateRoomInput['tab'] = null) =>
      room(debateRoomModel(input(debate(fields), { tab })))
    const tabsOf = (model: ReturnType<typeof shownFor>) => model.tabs.map((tab) => tab.tab)
    const open = shownFor({})
    expect(open.shown).toBe('turns')
    expect(tabsOf(open)).toEqual(['turns'])
    expect(open.tabs).toEqual([
      {
        tab: 'turns',
        href: '#/debate/debate_000000000000/turns',
        label: strings.debates.tabs.turns,
        current: true,
      },
    ])
    expect(open.focusesTab).toBe(false)
    expect(shownFor({ status: 'unknown' }).shown).toBe('turns')
    expect(shownFor({}, 'votes').shown).toBe('turns')
    expect(shownFor({}, 'turns').focusesTab).toBe(true)
    const drafting = shownFor({ status: 'concluding' })
    expect([drafting.shown, tabsOf(drafting)]).toEqual(['result', ['result', 'turns']])
    const voting = shownFor({ status: 'concluding', votingClosesAt: 4 }, 'votes')
    expect([voting.shown, tabsOf(voting)]).toEqual(['votes', ['result', 'votes', 'turns']])
    expect(voting.votes).toEqual({
      voting: `${strings.debates.votingUntil({ time: formats.full.format(new Date(4)) })} ${strings.debates.votedCount({ count: 0 })}`,
      record: null,
    })
    const ended = shownFor({ status: 'ended' })
    expect([ended.shown, tabsOf(ended)]).toEqual(['result', ['result', 'turns']])
    const unread = shownFor({
      status: 'closed',
      result: { result: { kind: 'unknown' } as never, draftedBy: BEN, draftedAt: 6 },
    })
    expect([unread.shown, tabsOf(unread), unread.credit]).toEqual(['result', ['result', 'turns'], null])
    expect(shownFor({ status: 'closed' }, 'credit').shown).toBe('result')
  })

  it('shows every turn, folding only the runs of turns that add nothing, and opens on a turn the address names', () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      position: index + 1,
      memberId: index % 2 === 0 ? ANA : BEN,
      agentName: 'Desk',
      body: index < 5 ? `Point ${index + 1}` : 'Nothing new; ready to vote.',
      at: index + 1,
    }))
    const model = room(debateRoomModel(input(debate({ turns }), { tab: 'turns', turn: 7 })))
    if (model.turns.kind !== 'turns') throw new Error('expected turns')
    expect(model.turns.groups.map((group) => group.kind)).toEqual([
      'turn',
      'turn',
      'turn',
      'turn',
      'turn',
      'quiet',
    ])
    expect(model.turns.groups[5]).toMatchObject({
      label: strings.debates.quietTurns({ count: 3, first: 6, last: 8 }),
      open: true,
    })
    expect([model.focusTurn, model.focusesTab]).toEqual([7, false])
    expect(room(debateRoomModel(input(debate({ turns }), { tab: 'turns', turn: 40 }))).focusTurn).toBeNull()
    expect(model.turns.timing).toBe(
      strings.debates.turnTimes({
        first: formats.full.format(new Date(1)),
        last: formats.full.format(new Date(8)),
      }),
    )
  })

  it('opens the details of who wrote each turn and draft, with the model its agent stated, and puts it beside each vote', () => {
    const model = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            participants: [participant(ANA), participant(BEN)],
            turns: [
              { position: 1, memberId: BEN, agentName: 'Ben desk', body: 'Yes.', at: 5, agentModel: 'gpt-6' },
              { position: 2, memberId: ANA, agentName: 'Ana desk', body: 'No.', at: 6, agentModel: null },
            ],
            result: { result: conclusion, draftedBy: BEN, draftedAt: 7 },
            drafts: [{ draftedBy: BEN, draftedAt: 7, result: conclusion, votes: 1, agentModel: 'gpt-6' }],
            voteRecord: {
              votes: [{ voterId: ANA, draftBy: BEN, agentModel: 'claude-opus-5-5' }],
              droppedOut: [],
            },
          }),
        ),
      ),
    )
    if (model.turns.kind !== 'turns') throw new Error('expected turns')
    expect(
      model.turns.groups.map((group) =>
        group.kind === 'turn'
          ? [group.turn.details.id, group.turn.details.line, group.turn.details.details[0]!.text]
          : [],
      ),
    ).toEqual([
      [
        'author-debate_000000000000-turn-1',
        strings.authorship.agent({ name: 'Ben' }),
        strings.authorship.model({ model: 'gpt-6' }),
      ],
      ['author-debate_000000000000-turn-2', strings.authorship.agentYou, strings.authorship.modelNotStated],
    ])
    expect(model.drafts![0]!.details.details.map((detail) => detail.text)).toEqual([
      strings.authorship.model({ model: 'gpt-6' }),
      strings.authorship.connection({ name: `${BEN} desk` }),
      strings.debates.modelReported,
    ])
    expect(model.result).toMatchObject({
      voteRecord: {
        lines: [
          { kind: 'voted', memberId: ANA, model: strings.authorship.model({ model: 'claude-opus-5-5' }) },
          { kind: 'silent', memberId: BEN, model: null },
        ],
      },
    })
  })

  it('names no connection for a draft by an agent no longer listed, and leaves a vote’s model out when details are off', () => {
    const model = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            participants: [participant(ANA)],
            result: { result: conclusion, draftedBy: BEN, draftedAt: 7 },
            drafts: [{ draftedBy: BEN, draftedAt: 7, result: conclusion, votes: 1 }],
            voteRecord: { votes: [{ voterId: ANA, draftBy: BEN }], droppedOut: [] },
          }),
        ),
      ),
    )
    expect(model.drafts![0]!.details.details.map((detail) => detail.text)).toEqual([
      strings.authorship.modelNotStated,
      strings.debates.modelReported,
    ])
    expect(model.result).toMatchObject({ voteRecord: { lines: [{ kind: 'voted', model: null }] } })
    const voted = room(
      debateRoomModel(
        input(
          debate({
            status: 'closed',
            participants: [participant(ANA), participant(BEN)],
            result: { result: conclusion, draftedBy: BEN, draftedAt: 7 },
            voteRecord: { votes: [{ voterId: ANA, draftBy: BEN, agentModel: null }], droppedOut: [] },
          }),
        ),
      ),
    )
    expect(voted.result).toMatchObject({
      voteRecord: {
        lines: [
          { kind: 'voted', model: strings.authorship.modelNotStated },
          { kind: 'silent', model: null },
        ],
      },
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
        summary: [{ kind: 'text', text: 'Split.' }],
        listHeading: strings.debates.disagreements,
        reasons: null,
        points: [
          {
            category: 'information',
            point: 'Risk',
            categoryText: strings.debates.category.information,
            explanation: [{ kind: 'text', text: 'Weighed differently.' }],
          },
        ],
        nextSteps: { none: strings.debates.noNextSteps, steps: [] },
      },
      voteRecord: { none: strings.debates.noVote, tally: [], tie: null, lines: [] },
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
