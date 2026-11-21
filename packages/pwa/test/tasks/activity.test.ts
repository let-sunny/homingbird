import type { AsRead, ConversationId } from '@homingbird/protocol'
import { Forbidden } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/activity.ts'
import { fail, testApp } from '../support/app.ts'
import { BEN, ROOM, conversation, draft, everything, member, note, serverInfo } from '../support/fixtures.ts'

const AWAITS = 'conv_awaits000000' as ConversationId

const notesOf = (id: ConversationId): AsRead.Note[] =>
  id === ROOM ? [draft('note_d1')] : [note('note_q', { conversationId: id, authorId: BEN })]

const handlers = {
  'inbox.list': () => ({
    items: [
      {
        note: note('note_q', { conversationId: AWAITS }),
        author: member(BEN, 'Ben'),
        conversation: conversation({ id: AWAITS }),
      },
    ],
  }),
  'conversations.get': ({ params }: { params: { id: string } }) =>
    conversation({ id: params.id as ConversationId }),
  'conversations.notes': ({ params }: { params: { id: string } }) => ({
    notes: notesOf(params.id as ConversationId),
    hasMore: false,
    notices: [],
  }),
  'reviews.list': () => ({ reviews: [] }),
  'debates.list': () => ({ debates: [] }),
}

describe('the activity tasks', () => {
  it('load the conversations with drafts or notes awaiting a reply, the reviews and the rooms', async () => {
    const { run, state, routes } = testApp(handlers)
    state.serverInfo.set(everything())
    state.conversations.set([conversation({ draftCount: 1 }), conversation({ id: AWAITS })])
    await run(tasks.loadActivity)
    expect(
      state.threads
        .get()
        .get(ROOM)
        ?.notes.map((one) => one.id),
    ).toEqual(['note_d1'])
    expect(
      state.threads
        .get()
        .get(AWAITS)
        ?.notes.map((one) => one.id),
    ).toEqual(['note_q'])
    expect(state.draftsRead.get().has(draft('note_d1').id)).toBe(true)
    expect(routes()).toEqual(expect.arrayContaining(['inbox.list', 'reviews.list', 'debates.list']))
    expect(state.debatesLoaded.get()).toBe(true)
    expect(state.threadsLoading.size).toBe(0)
  })

  it('still load the drafts when the inbox is refused, and no rooms while debate rooms are off', async () => {
    const { run, state, routes } = testApp({
      ...handlers,
      'inbox.list': () => fail(Forbidden({ message: 'no' })),
    })
    state.serverInfo.set(serverInfo())
    state.conversations.set([conversation({ draftCount: 1 }), conversation({ id: AWAITS })])
    await run(tasks.loadActivity)
    expect([...state.threads.get().keys()]).toEqual([ROOM])
    expect(routes()).not.toContain('debates.list')
  })

  it('load only the conversations that got drafts since, and none twice', async () => {
    const { run, state, routes } = testApp(handlers)
    state.conversations.set([conversation({ draftCount: 1 })])
    state.threadsLoading.add(ROOM)
    await run(tasks.loadDraftThreads)
    expect(routes()).toEqual([])
    state.threadsLoading.clear()
    await run(tasks.loadDraftThreads)
    expect(routes()).toEqual(['conversations.get', 'conversations.notes'])
    await run(tasks.loadDraftThreads)
    expect(routes()).toHaveLength(2)
  })
})
