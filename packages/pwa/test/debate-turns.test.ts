import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { changesPosition, citedTurns, isFillerTurn, positionMoveOf } from '../src/debate-turns.ts'

const cited = (text: string, last = 20) =>
  citedTurns(text, last).flatMap((part) => (part.kind === 'turn' ? [part.position] : []))

describe('citedTurns', () => {
  it('keeps every character of the text, in order, whatever it cites', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(fc.string(), fc.constantFrom('turn 3', 'turns 2, 4 and 9', '턴 5', '7번 차례', ' ')),
          {
            maxLength: 8,
          },
        ),
        fc.integer({ min: 0, max: 12 }),
        (pieces, last) => {
          const text = pieces.join('')
          const parts = citedTurns(text, last)
          expect(parts.map((part) => part.text).join('')).toBe(text)
          for (const part of parts) if (part.kind === 'turn') expect(part.position).toBeLessThanOrEqual(last)
          expect(
            parts.every((part, index) => part.kind === 'turn' || parts[index + 1]?.kind !== 'text'),
          ).toBe(true)
        },
      ),
    )
  })

  it('links each turn number an English or Korean citation names, and only turns the room has', () => {
    expect(cited('Turn 4 moved me; see turns 2, 5, and 9.')).toEqual([4, 2, 5, 9])
    expect(cited('Turns 3-5 and turns 6 to 7 or 8 & 9.')).toEqual([3, 5, 6, 7, 8, 9])
    expect(cited('턴 4와 2, 5번 차례, 그리고 3번째 턴, 차례 6')).toEqual([4, 2, 5, 3, 6])
    expect(cited('turn 0, turn 21, return 4, 12 turns, turn four', 20)).toEqual([])
    expect(citedTurns('See turn 2.', 3)).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'turn', text: 'turn 2', position: 2 },
      { kind: 'text', text: '.' },
    ])
    expect(citedTurns('turns 2 and 9', 3)).toEqual([
      { kind: 'text', text: 'turns ' },
      { kind: 'turn', text: '2', position: 2 },
      { kind: 'text', text: ' and 9' },
    ])
    expect(citedTurns('', 3)).toEqual([])
  })
})

describe('isFillerTurn', () => {
  it('tells a short turn that only says the room is ready from one that adds something', () => {
    expect(isFillerTurn('Nothing new; short turn only to bring the room to drafting.')).toBe(true)
    expect(isFillerTurn('Agreed. Ready to vote.')).toBe(true)
    expect(isFillerTurn('새로운 내용은 없어요. 투표할 준비가 됐어요.')).toBe(true)
    expect(
      isFillerTurn('Nothing new on the dates, but the clause says the notice must be received.'.repeat(5)),
    ).toBe(false)
    expect(isFillerTurn('The rollback rehearsal failed on Tuesday.')).toBe(false)
  })
})

describe('changesPosition', () => {
  it('finds a turn whose agent says it moved, in English or Korean', () => {
    expect(changesPosition('Turn 3 moved me: I now support Dec 10.')).toBe(true)
    expect(changesPosition('That changes my recommendation.')).toBe(true)
    expect(changesPosition('I drop my Friday date.')).toBe(true)
    expect(changesPosition('3번 차례를 보고 입장을 바꿨어요.')).toBe(true)
    expect(changesPosition('Friday still works for Finance.')).toBe(false)
  })
})

describe('positionMoveOf', () => {
  const turns = [
    { position: 1, memberId: 'a', body: 'I now agree, before reading anyone.' },
    { position: 2, memberId: 'b', body: 'Friday.' },
    { position: 3, memberId: 'a', body: 'More detail.' },
    { position: 4, memberId: 'a', body: 'Turn 2 moved me.' },
  ]

  it('names the turn an agent moved in and its turn before, never its opening turn', () => {
    expect(positionMoveOf(turns, 'a')).toEqual({ from: turns[2], to: turns[3] })
    expect(positionMoveOf(turns, 'b')).toBeNull()
    expect(positionMoveOf(turns.slice(0, 2), 'a')).toBeNull()
  })
})
