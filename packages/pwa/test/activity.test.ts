import type { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { threadsForActivity } from '../src/activity.ts'
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
