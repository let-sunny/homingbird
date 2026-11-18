import type { Conversation, ConversationId, Topic } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  canRename,
  helpingFirst,
  isValidSlug,
  peopleConversations,
  similarTopics,
  slugFrom,
  topicLabel,
  topicNamed,
  topicOfRoom,
  topicRooms,
} from '../src/topics.ts'

const topic = (slug: string, fields: Partial<Topic> = {}): Topic => ({
  slug,
  description: `About ${slug}`,
  conversationId: `conv_${slug}` as ConversationId,
  helperCount: 1,
  helping: false,
  createdAt: 1,
  ...fields,
})

const room = (id: string, kind: Conversation['kind'], title: string | null = null): Conversation => ({
  id: id as ConversationId,
  kind,
  title,
  participantIds: ['mem_ana000000000' as never],
  createdAt: 1,
  lastActivityAt: 1,
  lastNote: null,
  unreadCount: 0,
  draftCount: 0,
})

describe('topicLabel', () => {
  it('shows a topic as a hashtag', () => {
    expect(topicLabel('billing')).toBe('#billing')
  })
})

describe('slugFrom', () => {
  it.each([
    ['Billing', 'billing'],
    ['#release calendar', 'release-calendar'],
    ['  Payments / Refunds ', 'payments-refunds'],
    ['--ops', 'ops'],
    ['typing-', 'typing-'],
  ])('turns %j into %j', (typed, slug) => {
    expect(slugFrom(typed)).toBe(slug)
  })

  it('always yields a valid slug or something a person is still typing', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (typed) => {
        const slug = slugFrom(typed).replace(/-+$/, '')
        expect(slug === '' || isValidSlug(slug)).toBe(true)
      }),
    )
  })

  it('leaves a valid slug unchanged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]([a-z0-9]|-[a-z0-9]){0,15}$/), (slug) => {
        expect(slugFrom(slug)).toBe(slug)
      }),
    )
  })
})

describe('similarTopics', () => {
  const topics = [topic('billing'), topic('billing-ops'), topic('general'), topic('bill')]

  it('puts the exact match first, then the others that contain or are contained', () => {
    expect(similarTopics(topics, 'Billing').map((each) => each.slug)).toEqual([
      'billing',
      'bill',
      'billing-ops',
    ])
  })

  it('finds nothing for an empty field', () => {
    expect(similarTopics(topics, ' # ')).toEqual([])
  })
})

describe('lookups', () => {
  it('finds a topic by slug and by its room', () => {
    const topics = [topic('billing'), topic('general')]
    expect(topicNamed(topics, 'general')?.slug).toBe('general')
    expect(topicNamed(topics, 'nope')).toBeNull()
    expect(topicOfRoom(topics, 'conv_billing' as ConversationId)?.slug).toBe('billing')
    expect(topicOfRoom(topics, 'conv_x' as ConversationId)).toBeNull()
  })

  it('splits topic rooms from conversations with people', () => {
    const all = [
      room('a', 'dm'),
      room('b', 'topic', 'zeta'),
      room('c', 'group', 'G'),
      room('d', 'topic', 'alpha'),
    ]
    expect(topicRooms(all).map((each) => each.id)).toEqual(['d', 'b'])
    expect(peopleConversations(all).map((each) => each.id)).toEqual(['a', 'c'])
  })
})

describe('canRename', () => {
  it('keeps general fixed', () => {
    expect(canRename('general')).toBe(false)
    expect(canRename('billing')).toBe(true)
  })
})

describe('helpingFirst', () => {
  it('lists the topics I help with first, then general, then by name', () => {
    const sorted = [topic('zeta'), topic('general'), topic('alpha'), topic('mid', { helping: true })].sort(
      helpingFirst,
    )
    expect(sorted.map((each) => each.slug)).toEqual(['mid', 'general', 'alpha', 'zeta'])
  })
})
