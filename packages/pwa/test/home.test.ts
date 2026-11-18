import type { Conversation, ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { mostRecentConversation } from '../src/home.ts'

const conversation = (
  id: string,
  lastActivityAt: number,
  fields: Partial<Conversation> = {},
): Conversation => ({
  id: id as ConversationId,
  kind: 'dm',
  title: null,
  participantIds: ['mem_a' as never],
  createdAt: 1,
  lastActivityAt,
  lastNote: null,
  unreadCount: 0,
  draftCount: 1,
  archivedAt: null,
  ...fields,
})

describe('mostRecentConversation', () => {
  it('opens the conversation with the most recent activity', () => {
    expect(
      mostRecentConversation([conversation('a', 1), conversation('b', 5), conversation('c', 3)])?.id,
    ).toBe('b')
  })

  it('skips archived rooms', () => {
    expect(mostRecentConversation([conversation('a', 1), conversation('b', 9, { archivedAt: 9 })])?.id).toBe(
      'a',
    )
  })

  it('prefers a conversation with something in it over a newer empty room', () => {
    expect(
      mostRecentConversation([conversation('a', 1), conversation('b', 9, { kind: 'topic', draftCount: 0 })])
        ?.id,
    ).toBe('a')
    expect(mostRecentConversation([conversation('b', 9, { kind: 'topic', draftCount: 0 })])?.id).toBe('b')
  })

  it('opens nothing when there is nothing', () => {
    expect(mostRecentConversation([])).toBeNull()
  })
})
