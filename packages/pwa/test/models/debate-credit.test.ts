import type { MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { creditModel, creditedChanges, positionMoveIn, turnQuoted } from '../../src/models/debate-credit.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN, CY } from '../support/fixtures.ts'

const nameOf = (id: MemberId) => (id === ANA ? 'Ana' : id === BEN ? 'Ben' : 'Cy')
const cite = (text: string) => [{ kind: 'text' as const, text }]
const people = { nameOf, viewerId: ANA, cite }

const turn = (position: number, memberId: MemberId, body: string) => ({
  position,
  memberId,
  agentName: 'Desk',
  body,
  at: position,
})

const settled = (contributions: ReadonlyArray<unknown>, nextSteps: ReadonlyArray<unknown> = []) => ({
  result: { kind: 'conclusion', conclusion: 'Ship.', reasons: ['R'], contributions, nextSteps } as never,
  draftedBy: BEN,
  draftedAt: 1,
})

describe('creditModel', () => {
  it('has nothing to show before a result, or for a result this version cannot read', () => {
    expect(creditModel({ turns: [], result: null }, people)).toBeNull()
    expect(
      creditModel(
        { turns: [], result: { result: { kind: 'unknown' } as never, draftedBy: BEN, draftedAt: 1 } },
        people,
      ),
    ).toBeNull()
  })

  it('says a credit every agent got once, and keeps on each agent only what sets it apart', () => {
    const model = creditModel(
      {
        turns: [
          turn(1, ANA, 'Thursday.'),
          turn(2, BEN, 'Friday, because of the freeze.'),
          turn(3, ANA, 'Turn 2 moved me: I now agree with Friday.'),
          turn(4, BEN, 'Nothing new; ready to vote.'),
        ],
        result: settled(
          [
            { memberId: ANA, summary: 'Moved to Friday.', credits: ['gap_filled', 'position_changed'] },
            {
              memberId: BEN,
              summary: 'Raised the freeze.',
              credits: ['gap_filled', 'disagreement_separated', 'position_changed'],
            },
          ],
          [
            { step: 'Tag it', owner: null, proposedBy: BEN },
            { step: 'Tell support', owner: null, proposedBy: CY },
            { step: 'Tell billing', owner: null, proposedBy: CY },
          ],
        ),
      },
      people,
    )!
    expect(model.shared).toBe(strings.debates.sharedCredits({ credits: strings.debates.credit.gap_filled }))
    expect(model.rows).toEqual([
      {
        memberId: ANA,
        name: strings.debates.mine.agent,
        summary: cite('Moved to Friday.'),
        credits: [],
        turns: cite(strings.debates.turnsTook({ count: 2, positions: '1, 3' })),
        filler: null,
        positionChange: {
          text: cite(strings.debates.positionChange({ from: 1, to: 3 })),
          from: turnQuoted(turn(1, ANA, 'Thursday.')),
          to: turnQuoted(turn(3, ANA, 'Turn 2 moved me: I now agree with Friday.')),
        },
        keptSteps: [],
      },
      {
        memberId: BEN,
        name: 'Ben',
        summary: cite('Raised the freeze.'),
        credits: [
          {
            text: strings.debates.credit.disagreement_separated,
            hint: strings.debates.creditHint.disagreement_separated,
            turn: null,
          },
        ],
        turns: cite(strings.debates.turnsTook({ count: 2, positions: '2, 4' })),
        filler: strings.debates.fillerCount({ count: 1 }),
        positionChange: null,
        keptSteps: [cite('Tag it')],
      },
      {
        memberId: CY,
        name: 'Cy',
        summary: null,
        credits: [],
        turns: cite(strings.debates.noTurnTaken),
        filler: null,
        positionChange: null,
        keptSteps: [cite('Tell support'), cite('Tell billing')],
      },
    ])
  })

  it('takes a change of position from the turn its credit names, not from the words, once credits name turns', () => {
    const turns = [
      turn(1, ANA, 'Thursday.'),
      turn(2, BEN, 'The freeze starts Friday.'),
      turn(3, ANA, 'Friday, then.'),
      turn(4, BEN, 'I now agree with Friday.'),
    ]
    const result = settled([
      { memberId: ANA, summary: 'Moved.', credits: [{ credit: 'position_changed', turn: 3 }] },
      { memberId: BEN, summary: 'Raised it.', credits: [{ credit: 'gap_filled', turn: 2 }] },
    ])
    const model = creditModel({ turns, result }, people)!
    expect(model.rows[0]!.positionChange).toMatchObject({
      from: turnQuoted(turns[0]!),
      to: turnQuoted(turns[2]!),
    })
    expect(model.rows[1]!.positionChange).toBeNull()
    expect(model.rows[1]!.credits).toEqual([
      {
        text: strings.debates.credit.gap_filled,
        hint: strings.debates.creditHint.gap_filled,
        turn: strings.debates.earnedIn({ turn: 2 }),
      },
    ])
    expect(creditedChanges({ result })).toEqual([3])
    expect(creditedChanges({ result: null })).toBeNull()
    expect(creditedChanges({ result: { ...result!, result: { kind: 'unknown' } as never } })).toBeNull()
    const first = settled([
      { memberId: ANA, summary: 'Moved.', credits: [{ credit: 'position_changed', turn: 1 }] },
      { memberId: BEN, summary: 'Raised it.', credits: [] },
    ])
    expect(positionMoveIn({ turns, result: first }, ANA)).toBeNull()
    expect(positionMoveIn({ turns, result: first }, BEN)).toBeNull()
  })

  it('shares no credit when one agent alone contributed', () => {
    const model = creditModel(
      { turns: [], result: settled([{ memberId: BEN, summary: 'Alone.', credits: ['gap_filled'] }]) },
      people,
    )!
    expect(model.shared).toBeNull()
    expect(model.rows[0]!.credits).toEqual([
      { text: strings.debates.credit.gap_filled, hint: strings.debates.creditHint.gap_filled, turn: null },
    ])
  })

  it('quotes the start of a turn under its number', () => {
    expect(turnQuoted({ position: 4, body: `${'a'.repeat(200)}` })).toEqual({
      label: strings.debates.turnLabel({ position: 4 }),
      excerpt: `${'a'.repeat(159)}…`,
    })
  })
})
