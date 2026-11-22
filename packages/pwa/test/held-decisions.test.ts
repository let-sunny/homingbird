import { describe, expect, it } from 'vitest'
import {
  conversationsWithoutHeld,
  heldLineFor,
  heldWordsFor,
  keptEditLine,
  reviewsWithoutHeld,
  undoableHeld,
} from '../src/held-decisions.ts'
import { strings } from '../src/strings.ts'
import { CHANNEL_ROOM, ROOM, conversation, draft } from './support/fixtures.ts'

const held = (
  noteId: string,
  phase: 'waiting' | 'committing' | 'done',
  kind: 'send' | 'discard' = 'send',
) => ({
  noteId: noteId as never,
  conversationId: ROOM,
  kind,
  phase,
  settles: 1,
  words: heldWordsFor('Ben')[kind],
})

const ids = (...values: string[]) => values as never[]

describe('what a card shows in its place while a decision on it is held', () => {
  it('says when a send goes with Undo while it waits, that it is on its way without Undo, and sent only once carried out', () => {
    expect(heldLineFor([held('d1', 'waiting')], ids('d0', 'd1'))).toEqual({
      noteId: 'd1',
      className: 'held-line is-send',
      text: strings.heldSendingIn({ names: 'Ben', seconds: 5 }),
      undo: strings.undo,
    })
    expect(heldLineFor([held('d1', 'committing')], ids('d1'))).toMatchObject({
      text: strings.heldSending({ names: 'Ben' }),
      undo: null,
    })
    expect(heldLineFor([held('d1', 'done')], ids('d1'))?.text).toBe(strings.heldSent({ names: 'Ben' }))
    expect(heldLineFor([held('d1', 'waiting', 'discard')], ids('d1'))).toMatchObject({
      className: 'held-line is-discard',
      text: strings.heldDiscardingIn({ seconds: 5 }),
    })
    expect(heldLineFor([held('d1', 'committing', 'discard')], ids('d1'))?.text).toBe(strings.heldDiscarding)
    expect(heldLineFor([held('d1', 'waiting')], ids('d2'))).toBeNull()
  })

  it('finds the one decision that can still be undone', () => {
    expect(undoableHeld([held('d1', 'done'), held('d2', 'waiting')])?.noteId).toBe('d2')
    expect(undoableHeld([held('d1', 'committing')])).toBeNull()
  })

  it('says a card keeps an unsent edit only when it does', () => {
    expect(keptEditLine(new Map([['d1' as never, 'mine']]), 'd1' as never)).toBe(strings.draftEditKept)
    expect(keptEditLine(new Map(), 'd1' as never)).toBeNull()
  })

  it('names who a send goes to while it waits, once sent, and when the page closed first', () => {
    expect(heldWordsFor('Ana')).toEqual({
      send: {
        waiting: strings.heldSendingIn({ names: 'Ana', seconds: 5 }),
        pending: strings.heldSending({ names: 'Ana' }),
        done: strings.heldSent({ names: 'Ana' }),
        notDone: strings.heldNotSent({ names: 'Ana' }),
      },
      discard: {
        waiting: strings.heldDiscardingIn({ seconds: 5 }),
        pending: strings.heldDiscarding,
        done: strings.heldDiscarded,
        notDone: strings.heldNotDiscarded,
      },
    })
  })
})

describe('what is counted while a decision is held', () => {
  it('leaves out the answers a held decision decides', () => {
    const reviews = [{ note: draft('d1') }, { note: draft('d3') }] as never[]
    expect(reviewsWithoutHeld(reviews, [])).toBe(reviews)
    expect(reviewsWithoutHeld(reviews, [held('d1', 'waiting')])).toEqual([reviews[1]])
  })

  it('lowers a conversation’s drafts by what a held decision settles, until the server counts it', () => {
    const rooms = [conversation({ draftCount: 3 }), conversation({ id: CHANNEL_ROOM, draftCount: 1 })]
    expect(conversationsWithoutHeld(rooms, [])).toBe(rooms)
    expect(conversationsWithoutHeld(rooms, [held('d1', 'done')])).toBe(rooms)
    const lowered = conversationsWithoutHeld(rooms, [
      { ...held('d1', 'waiting'), settles: 2 },
      { ...held('d2', 'committing'), settles: 2 },
      { ...held('d3', 'waiting'), settles: 0 },
    ])
    expect(lowered.map((room) => room.draftCount)).toEqual([0, 1])
    expect(lowered[1]).toBe(rooms[1])
  })
})
