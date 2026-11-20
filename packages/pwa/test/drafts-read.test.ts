import type { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import {
  asRead,
  isChangedSinceRead,
  withDraftRead,
  withDraftsAsRead,
  withReviewsAsRead,
} from '../src/drafts-read.ts'
import { ROOM, draft, note } from './support/fixtures.ts'

const OTHER = 'conv_other000000' as ConversationId

describe('drafts as the person read them', () => {
  it('remembers each draft as it first arrives, and keeps that version when the draft changes', () => {
    const first = withDraftsAsRead(
      new Map(),
      new Map([[ROOM, { notes: [note('n1'), draft('d1')], hasMore: false }]]),
    )
    expect([...first]).toEqual([['d1', { body: 'body of d1', conversationId: ROOM }]])
    const changed = draft('d1', { body: 'rewritten' })
    const later = withDraftsAsRead(first, new Map([[ROOM, { notes: [changed], hasMore: false }]]))
    expect(later).toBe(first)
    expect(isChangedSinceRead(later, changed)).toBe(true)
  })

  it('counts a move to another room as a change, and a draft it never saw as unchanged', () => {
    const read = withDraftsAsRead(new Map(), new Map([[ROOM, { notes: [draft('d1')], hasMore: false }]]))
    expect(isChangedSinceRead(read, draft('d1', { conversationId: OTHER }))).toBe(true)
    expect(isChangedSinceRead(read, draft('d1'))).toBe(false)
    expect(isChangedSinceRead(read, draft('d2', { body: 'anything' }))).toBe(false)
  })

  it('takes the draft as read again once the person says so', () => {
    const read = withDraftsAsRead(new Map(), new Map([[ROOM, { notes: [draft('d1')], hasMore: false }]]))
    const changed = draft('d1', { body: 'rewritten' })
    const again = withDraftRead(read, changed)
    expect(isChangedSinceRead(again, changed)).toBe(false)
    expect(again.get(changed.id)).toEqual(asRead(changed))
    expect(isChangedSinceRead(read, changed)).toBe(true)
  })

  it('remembers each answer a manager reviews as it first reached the page', () => {
    const answer = draft('d1')
    const review = { note: answer, question: null, channel: 'wiki', agent: answer as never, privately: false }
    const read = withReviewsAsRead(new Map(), [review])
    expect(read.get(answer.id)).toEqual(asRead(answer))
    expect(withReviewsAsRead(read, [{ ...review, note: draft('d1', { body: 'changed' }) }])).toBe(read)
  })
})
