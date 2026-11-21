import type { MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { type TurnListInput, turnListModel } from '../../src/models/debate-turn-list.ts'
import { strings } from '../../src/strings.ts'
import { ANA, BEN } from '../support/fixtures.ts'

const turn = (position: number, memberId: MemberId, body: string) => ({
  position,
  memberId,
  agentName: 'Desk',
  body,
  at: position,
})

const input = (fields: Partial<TurnListInput> = {}): TurnListInput => ({
  viewerId: ANA,
  now: 10,
  focus: null,
  agentOf: (agent, memberId) => `${agent} of ${memberId}`,
  details: (shown) => ({ id: `author-${shown.position}` }) as never,
  cite: (text) => [{ kind: 'text', text }],
  ...fields,
})

const kinds = (groups: ReturnType<typeof turnListModel>) =>
  groups.map((group) =>
    group.kind === 'turn' ? group.turn.position : group.turns.map((one) => one.position),
  )

describe('turnListModel', () => {
  const turns = [
    turn(1, ANA, 'I now agree, though I have read no one.'),
    turn(2, BEN, 'Nothing new.'),
    turn(3, ANA, 'Turn 1 was wrong: I was wrong about the date.'),
    turn(4, BEN, 'Nothing new; ready to vote.'),
    turn(5, ANA, 'I was wrong, but nothing new; ready to vote.'),
    turn(6, BEN, 'Ready to vote.'),
    turn(7, ANA, 'One more point.'),
  ]

  it('numbers every turn and folds only runs of turns that add nothing, keeping a single one in line', () => {
    const groups = turnListModel(turns, input())
    expect(kinds(groups)).toEqual([1, 2, 3, [4, 5, 6], 7])
    expect(groups[3]).toMatchObject({
      kind: 'quiet',
      label: strings.debates.quietTurns({ count: 3, first: 4, last: 6 }),
      open: false,
    })
    expect(groups[1]).toMatchObject({
      turn: {
        label: strings.debates.turnLabel({ position: 2 }),
        filler: strings.debates.fillerMark,
        mine: false,
      },
    })
    expect(groups[0]).toMatchObject({
      turn: { author: `Desk of ${ANA}`, mine: true, details: { id: 'author-1' }, filler: null },
    })
  })

  it('marks a change of position only after an agent’s opening turn, and never on a turn that adds nothing', () => {
    const marks = turnListModel(turns, input()).flatMap((group) =>
      (group.kind === 'turn' ? [group.turn] : group.turns).map((one) => one.changedPosition),
    )
    expect(marks).toEqual([null, null, strings.debates.changedPositionMark, null, null, null, null])
  })

  it('opens the fold that holds the turn the person jumped to and marks that turn', () => {
    const groups = turnListModel(turns, input({ focus: 5 }))
    expect(groups[3]).toMatchObject({ open: true })
    expect(groups[3]!.kind === 'quiet' && groups[3]!.turns.map((one) => one.focused)).toEqual([
      false,
      true,
      false,
    ])
    expect(turnListModel([], input())).toEqual([])
  })
})
