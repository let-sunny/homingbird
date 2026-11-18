import type { Conversation, ConversationId, Topic } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  answeringFirst,
  canRename,
  isPrivate,
  isValidSlug,
  peopleConversations,
  similarTopics,
  slugFrom,
  topicLabel,
  topicNamed,
  topicOfRoom,
  topicRooms,
  withTopic,
  withoutRoom,
} from '../src/topics.ts'

const topic = (slug: string, fields: Partial<Topic> = {}): Topic => ({
  slug,
  description: `About ${slug}`,
  conversationId: `conv_${slug}` as ConversationId,
  visibility: 'open',
  memberCount: 1,
  helperCount: 1,
  joined: false,
  answering: false,
  managing: false,
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

describe('answeringFirst', () => {
  it('lists the topics I answer in first, then the ones I am in, then general, then by name', () => {
    const sorted = [
      topic('zeta'),
      topic('general'),
      topic('alpha'),
      topic('joined', { joined: true }),
      topic('mid', { joined: true, answering: true }),
    ].sort(answeringFirst)
    expect(sorted.map((each) => each.slug)).toEqual(['mid', 'joined', 'general', 'alpha', 'zeta'])
  })
})

describe('private topics in the list', () => {
  it('tells a private topic from an open one', () => {
    expect(isPrivate(topic('payroll', { visibility: 'private' }))).toBe(true)
    expect(isPrivate(topic('billing'))).toBe(false)
  })

  it('replaces a changed topic in place, or adds a new one in name order', () => {
    const listed = [topic('billing'), topic('general')]
    expect(withTopic(listed, topic('billing', { joined: true })).map((each) => each.joined)).toEqual([
      true,
      false,
    ])
    expect(withTopic(listed, topic('deploys')).map((each) => each.slug)).toEqual([
      'billing',
      'deploys',
      'general',
    ])
  })

  it('drops a private room I left, and keeps an open one or one I still manage as an administrator', () => {
    const listed = [
      topic('billing', { joined: true, answering: true }),
      topic('payroll', { visibility: 'private', joined: true, managing: true }),
    ]
    expect(withoutRoom(listed, 'conv_payroll' as ConversationId, false).map((each) => each.slug)).toEqual([
      'billing',
    ])
    expect(withoutRoom(listed, 'conv_billing' as ConversationId, false)[0]).toMatchObject({
      slug: 'billing',
      joined: false,
      answering: false,
    })
    expect(withoutRoom(listed, 'conv_payroll' as ConversationId, true)[1]).toMatchObject({
      slug: 'payroll',
      joined: false,
      managing: true,
    })
  })
})
