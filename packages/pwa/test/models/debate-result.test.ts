import type { MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { resultBody, resultModel } from '../../src/models/debate-result.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY, debate } from '../support/fixtures.ts'

const nameOf = (id: MemberId) => (id === ANA ? 'Ana' : id === BEN ? 'Ben' : 'Cy')
const someone = { nameOf, viewerId: 'mem_viewer000000' as MemberId }
const ana = { nameOf, viewerId: ANA }

describe('resultModel', () => {
  it('waits while the agents settle the result, and shows who drafted it once settled', () => {
    expect(resultModel(debate({ status: 'concluding' }), 'awaiting-result', someone)).toEqual({
      kind: 'waiting',
      text: strings.debates.waitingForResult,
      collecting: null,
      voting: null,
    })
    const settled = resultModel(
      debate({
        status: 'closed',
        result: { result: { kind: 'unknown' } as never, draftedBy: BEN, draftedAt: 1 },
      }),
      'closed',
      someone,
    )
    expect(settled).toEqual({
      kind: 'settled',
      draftedBy: strings.debates.draftedBy({ person: 'Ben' }),
      body: { kind: 'unknown', text: strings.debates.unknownResult },
      voteRecord: null,
    })
  })

  it('says what the room waits for in each phase, and nothing about the turns once it is closed', () => {
    const textIn = (stage: 'awaiting-result' | 'voting' | 'closed', fields: Parameters<typeof debate>[0]) =>
      resultModel(debate(fields), stage, someone)
    expect(textIn('awaiting-result', { status: 'concluding', draftsCloseAt: 3 })).toMatchObject({
      text: strings.debates.waitingForResult,
    })
    expect(textIn('voting', { status: 'concluding', votingClosesAt: 4 })).toMatchObject({
      text: strings.debates.waitingForVotes,
    })
    expect(textIn('closed', { status: 'closed' })).toEqual({
      kind: 'waiting',
      text: null,
      collecting: null,
      voting: null,
    })
  })
})

describe('resultBody', () => {
  it('words a conclusion with its reasons, steps and contributions', () => {
    const body = resultBody(
      {
        kind: 'conclusion',
        conclusion: 'Ship.',
        reasons: ['Ready.'],
        nextSteps: [{ step: 'Tag', owner: ANA, proposedBy: BEN }],
        contributions: [{ memberId: ANA, summary: 'Tested.', credits: ['gap_filled'] }],
      } as never,
      someone,
    )
    expect(body).toMatchObject({
      kind: 'known',
      heading: strings.debates.conclusion,
      reasons: ['Ready.'],
      nextSteps: {
        steps: [
          {
            step: 'Tag',
            owner: strings.debates.owner({ person: 'Ana' }),
            proposedBy: strings.debates.proposedBy({ person: 'Ben' }),
          },
        ],
      },
      contributions: {
        rows: [
          {
            name: 'Ana',
            credits: [
              { text: strings.debates.credit.gap_filled, hint: strings.debates.creditHint.gap_filled },
            ],
          },
        ],
      },
    })
  })

  it('words what changed minds, what is still open, where the agents differed and the turn behind each credit', () => {
    const body = resultBody(
      {
        kind: 'conclusion',
        conclusion: 'Ship.',
        reasons: ['Ready.'],
        nextSteps: [],
        contributions: [
          { memberId: ANA, summary: 'Tested.', credits: [{ credit: 'position_changed', turn: 3 }] },
        ],
        changedMinds: [{ turn: 2, line: 'The rehearsal failed.' }],
        stillOpen: ['Who tells support?'],
        points: [{ point: 'Date', category: 'goals', explanation: 'Friday or January.' }],
      } as never,
      someone,
    )
    expect(body).toMatchObject({
      points: null,
      differences: {
        heading: strings.debates.differences,
        points: [{ point: 'Date', categoryText: strings.debates.category.goals }],
      },
      changedMinds: {
        heading: strings.debates.changedMinds,
        items: [{ turn: strings.debates.changedMind({ turn: 2 }), line: 'The rehearsal failed.' }],
      },
      stillOpen: { heading: strings.debates.stillOpen, items: ['Who tells support?'] },
      contributions: {
        rows: [
          {
            credits: [
              { text: strings.debates.credit.position_changed, turn: strings.debates.earnedIn({ turn: 3 }) },
            ],
          },
        ],
      },
    })
    const plain = resultBody(
      { kind: 'conclusion', conclusion: 'Ship.', reasons: [], nextSteps: [], contributions: [] } as never,
      someone,
    )
    expect(plain).toMatchObject({ differences: null, changedMinds: null, stillOpen: null })
    const none = resultBody(
      {
        kind: 'no_conclusion',
        summary: 'Split.',
        points: [{ point: 'Date', category: 'goals', explanation: 'Why' }],
        nextSteps: [],
        contributions: [],
      } as never,
      someone,
    )
    expect(none).toMatchObject({
      differences: null,
      changedMinds: null,
      stillOpen: null,
      points: [{ point: 'Date' }],
    })
  })

  it('calls the viewer’s own agent theirs, never by the viewer’s name', () => {
    const body = resultBody(
      {
        kind: 'conclusion',
        conclusion: 'Ship.',
        reasons: [],
        nextSteps: [{ step: 'Tag', owner: ANA, proposedBy: ANA }],
        contributions: [{ memberId: ANA, summary: 'Tested.', credits: [] }],
      } as never,
      ana,
    )
    expect(body).toMatchObject({
      nextSteps: {
        steps: [{ owner: strings.debates.mine.owner, proposedBy: strings.debates.mine.proposedBy }],
      },
      contributions: { rows: [{ name: strings.debates.mine.agent }] },
    })
  })
})

describe('the vote record', () => {
  const voted = (viewer: typeof someone, droppedOut: ReadonlyArray<MemberId> = []) =>
    resultModel(
      debate({
        status: 'closed',
        participants: [ANA, BEN, CY].map((memberId) => ({ memberId, agentName: 'Desk' })) as never,
        drafts: [
          { draftedBy: ANA, draftedAt: 1, result: { kind: 'unknown' }, votes: 1 },
          { draftedBy: BEN, draftedAt: 2, result: { kind: 'unknown' }, votes: 1 },
        ] as never,
        voteRecord: {
          votes: [
            { voterId: ANA, draftBy: BEN },
            { voterId: BEN, draftBy: ANA },
          ],
          droppedOut,
        } as never,
        result: { result: { kind: 'unknown' } as never, draftedBy: ANA, draftedAt: 1 },
      }),
      'closed',
      viewer,
    )

  it('names everyone when the viewer took no part', () => {
    expect(voted(someone)).toMatchObject({
      draftedBy: strings.debates.draftedBy({ person: 'Ana' }),
      voteRecord: {
        lines: [
          { text: strings.debates.votedFor({ voter: 'Ana', author: 'Ben' }) },
          { text: strings.debates.votedFor({ voter: 'Ben', author: 'Ana' }) },
          { text: strings.debates.didNotVote({ person: 'Cy' }) },
        ],
      },
    })
  })

  it('says “your agent” for the viewer’s own vote and draft', () => {
    expect(voted(ana)).toMatchObject({
      draftedBy: strings.debates.mine.draftedBy,
      voteRecord: {
        lines: [
          { text: strings.debates.mine.votedFor({ author: 'Ben' }) },
          { text: strings.debates.mine.votedForMine({ voter: 'Ben' }) },
          { text: strings.debates.didNotVote({ person: 'Cy' }) },
        ],
      },
    })
    expect(voted({ nameOf, viewerId: CY })).toMatchObject({
      voteRecord: { lines: [{}, {}, { text: strings.debates.mine.didNotVote }] },
    })
    expect(voted({ nameOf, viewerId: CY }, [CY])).toMatchObject({
      voteRecord: { lines: [{}, {}, { text: strings.debates.mine.droppedOutWithoutVote }] },
    })
  })
})
