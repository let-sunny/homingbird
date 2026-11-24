import { arbitrary } from '@homingbird/kernel/testing'
import { type ConversationId, DebateSuggestion, Review } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { threadsForActivity, withoutReview, withoutSuggestion } from '../src/activity.ts'
import { ROOM, conversation } from './support/fixtures.ts'

const room = (id: string, fields: Parameters<typeof conversation>[0] = {}) =>
  conversation({ id: id as ConversationId, ...fields })

describe('threadsForActivity', () => {
  it('loads the conversations with drafts, unread notes or notes awaiting a reply, once each', () => {
    const rooms = [
      room('conv_drafts000000', { draftCount: 1 }),
      room('conv_unread000000', { unreadCount: 2 }),
      room('conv_awaits000000'),
      room('conv_quiet0000000'),
      room('conv_archived0000', { draftCount: 1, archivedAt: 5 }),
      room('conv_loading00000', { draftCount: 1 }),
      room(ROOM, { draftCount: 1 }),
    ]
    expect(
      threadsForActivity(
        rooms,
        new Map([[ROOM, { notes: [], hasMore: false }]]),
        ['conv_awaits000000' as ConversationId],
        new Set(['conv_loading00000' as ConversationId]),
      ),
    ).toEqual(['conv_drafts000000', 'conv_unread000000', 'conv_awaits000000'])
  })
})

describe('the changes a running request repeats on its answer', () => {
  it('take out the decided answer alone, and twice means the same as once', () => {
    fc.assert(
      fc.property(fc.array(arbitrary(Review), { maxLength: 4 }), fc.nat(), (reviews, chosen) => {
        const decided =
          reviews[chosen % Math.max(1, reviews.length)]?.note.id ?? ('note_none00000000' as never)
        const once = withoutReview(decided)(reviews)
        expect(withoutReview(decided)(once)).toEqual(once)
        expect(once).toEqual(reviews.filter((review) => review.note.id !== decided))
      }),
      { numRuns: 100 },
    )
  })

  it('take out the settled suggestion alone, and twice means the same as once', () => {
    fc.assert(
      fc.property(
        fc.array(arbitrary(DebateSuggestion), { maxLength: 4 }),
        fc.nat(),
        (suggestions, chosen) => {
          const settled = suggestions[chosen % Math.max(1, suggestions.length)]?.id ?? ('sugg_none' as never)
          const once = withoutSuggestion(settled)(suggestions)
          expect(withoutSuggestion(settled)(once)).toEqual(once)
          expect(once).toEqual(suggestions.filter((suggestion) => suggestion.id !== settled))
        },
      ),
      { numRuns: 100 },
    )
  })
})
