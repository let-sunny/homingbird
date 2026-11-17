import type { ConversationId, DraftRequest, NoteId } from '@homingbird/protocol'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { requestAnsweredBy, upsertRequest, waitingRequests } from '../src/draft-requests.ts'

const here = 'conv_here00000000' as ConversationId
const elsewhere = 'conv_elsewhere000' as ConversationId

const request = (id: string, fields: Partial<DraftRequest> = {}): DraftRequest => ({
  id: id as DraftRequest['id'],
  conversationId: here,
  inReplyTo: null,
  instruction: '',
  agentId: null,
  createdAt: 1,
  expiresAt: 1000,
  cancelledAt: null,
  draftIds: [],
  ...fields,
})

describe('waitingRequests', () => {
  it('keeps only open, unanswered, unexpired requests of this conversation', () => {
    const requests = [
      request('waiting'),
      request('other-room', { conversationId: elsewhere }),
      request('withdrawn', { cancelledAt: 5 }),
      request('answered', { draftIds: ['note_1' as NoteId] }),
      request('expired', { expiresAt: 10 }),
    ]
    expect(waitingRequests(requests, here, 10).map((each) => each.id)).toEqual(['waiting'])
  })
})

describe('upsertRequest', () => {
  it('adds a new request and replaces a changed one by id', () => {
    const answered = request('a', { draftIds: ['note_1' as NoteId] })
    expect(upsertRequest([request('a'), request('b')], answered)).toEqual([request('b'), answered])
    expect(upsertRequest([], request('a'))).toEqual([request('a')])
  })

  it('forgets a request once it is withdrawn', () => {
    expect(upsertRequest([request('a'), request('b')], request('a', { cancelledAt: 3 }))).toEqual([
      request('b'),
    ])
  })

  it('never holds two requests with the same id', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 12 }), (ids) => {
        const held = ids.reduce<DraftRequest[]>((all, id) => upsertRequest(all, request(id)), [])
        expect(new Set(held.map((each) => each.id)).size).toBe(held.length)
      }),
    )
  })
})

describe('requestAnsweredBy', () => {
  it('finds the request a draft answers, if any', () => {
    const requests = [request('a', { draftIds: ['note_1' as NoteId, 'note_2' as NoteId] })]
    expect(requestAnsweredBy(requests, 'note_2' as NoteId)?.id).toBe('a')
    expect(requestAnsweredBy(requests, 'note_9' as NoteId)).toBeNull()
  })
})
