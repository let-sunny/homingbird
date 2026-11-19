import { describe, expect, it } from 'vitest'
import { MISSING } from '../../src/missing.ts'
import {
  chooseReplyTarget,
  forgetNote,
  forgetRelease,
  loadOlderNotes,
  loadThread,
  markRead,
  openThread,
  rememberNote,
  rememberNotices,
  replyTargetIn,
  sendNote,
} from '../../src/tasks/notes.ts'
import { fail, testApp } from '../support/app.ts'
import { ANA, BEN, ROOM, conversation, me, note } from '../support/fixtures.ts'

const page = (notes: ReturnType<typeof note>[], hasMore = false, notices: unknown[] = []) => ({
  notes,
  hasMore,
  notices,
})

describe('loading a conversation', () => {
  it('keeps the conversation, its notes and what the server remembered for the person', async () => {
    const { run, state } = testApp({
      'conversations.get': () => conversation(),
      'conversations.notes': () =>
        page([note('n1')], true, [
          {
            kind: 'released',
            noteId: 'n1',
            conversationId: ROOM,
            reason: 'busy',
            agentName: 'Desk',
            channel: null,
            at: 1,
          },
          {
            kind: 'channel_archived',
            noteId: 'd1',
            conversationId: ROOM,
            reason: null,
            agentName: null,
            channel: 'billing',
            at: 1,
          },
          {
            kind: 'channel_archived',
            noteId: 'd2',
            conversationId: ROOM,
            reason: null,
            agentName: null,
            channel: null,
            at: 1,
          },
        ]),
    })
    await run(loadThread(ROOM))
    expect(state.conversations.get().map((one) => one.id)).toEqual([ROOM])
    expect(state.threads.get().get(ROOM)).toEqual({ notes: [note('n1')], hasMore: true })
    expect(state.releases.get().get('n1' as never)).toEqual({ reason: 'busy', agentName: 'Desk' })
    expect(state.archiveDiscards.get().get(ROOM)).toEqual([{ noteId: 'd1', channel: 'billing' }])
    await run(loadThread(ROOM))
    expect(state.conversations.get()).toHaveLength(1)
  })

  it('asks again while the conversation changes under the request, five times at most', async () => {
    const app = testApp({
      'conversations.get': () => conversation(),
      'conversations.notes': () => {
        app.state.changes.count(ROOM)
        return page([])
      },
    })
    await app.run(loadThread(ROOM))
    expect(app.routes().filter((route) => route === 'conversations.get')).toHaveLength(5)
  })

  it('shows a conversation the person may not see as missing', async () => {
    const { run } = testApp({ 'conversations.get': () => fail({ _tag: 'NotFound', message: 'no' }) })
    expect(await run(openThread(ROOM))).toEqual({ _tag: 'Ok', value: MISSING })
    const other = testApp({ 'conversations.get': () => fail({ _tag: 'Forbidden', message: 'no' }) })
    expect((await other.run(openThread(ROOM)))._tag).toBe('Err')
  })

  it('loads older notes before the oldest sent one, keeping notes that arrived meanwhile', async () => {
    const app = testApp({
      'conversations.notes': () => page([note('old', { sentAt: 1 }), note('n1', { sentAt: 5 })]),
    })
    await app.run(loadOlderNotes(ROOM))
    expect(app.routes()).toEqual([])
    app.state.threads.set(
      new Map([[ROOM, { notes: [note('d', { sentAt: null }), note('n1', { sentAt: 5 })], hasMore: true }]]),
    )
    await app.run(loadOlderNotes(ROOM))
    expect(app.sent[0]!.request).toEqual({ params: { id: ROOM }, query: { before: '5' } })
    expect(
      app.state.threads
        .get()
        .get(ROOM)!
        .notes.map((one) => one.id),
    ).toEqual(['old', 'd', 'n1'])
    app.state.threads.set(new Map([[ROOM, { notes: [note('d', { sentAt: null })], hasMore: true }]]))
    await app.run(loadOlderNotes(ROOM))
    expect(app.routes()).toHaveLength(1)
  })
})

describe('sending a note', () => {
  it('writes and sends it as a reply to the note awaiting one, then forgets the reply target', async () => {
    const question = note('q', {
      authorId: BEN,
      receipts: [
        { memberId: ANA, state: 'read', deliveredAt: 1, readAt: 1, draftingAt: null, repliedAt: null },
      ],
    })
    const app = testApp({
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
      'drafts.send': () => note('d1', { authorId: ANA }),
      'conversations.list': () => ({ conversations: [conversation()] }),
    })
    app.state.session.set(me())
    app.state.conversations.set([conversation()])
    app.state.threads.set(new Map([[ROOM, { notes: [question], hasMore: false }]]))
    await app.run(sendNote(ROOM, 'Yes'))
    expect(app.sent[0]!.request).toEqual({ body: { body: 'Yes', conversationId: ROOM, inReplyTo: 'q' } })
    expect(app.state.sendingIn.get().size).toBe(0)
    expect(
      app.state.threads
        .get()
        .get(ROOM)!
        .notes.map((one) => one.id),
    ).toEqual(['q', 'd1'])
  })

  it('lets go of the sending mark after a failure, and sends a new note where no reply is chosen', async () => {
    const app = testApp({ 'drafts.create': () => fail({ _tag: 'Forbidden', message: 'no' }) })
    app.state.replyTargets.set(new Map([[ROOM, null]]))
    await app.run(sendNote(ROOM, 'Hi'))
    expect(app.sent[0]!.request).toEqual({ body: { body: 'Hi', conversationId: ROOM } })
    expect(app.state.sendingIn.get().size).toBe(0)
  })
})

describe('the reply target', () => {
  it('is the note chosen, none in a channel or while signed out, else the one awaiting a reply', async () => {
    const app = testApp()
    expect(replyTargetIn(app.state, ROOM)).toBeNull()
    app.state.session.set(me())
    app.state.conversations.set([conversation({ kind: 'channel' })])
    expect(replyTargetIn(app.state, ROOM)).toBeNull()
    await app.run(chooseReplyTarget(ROOM, 'n1' as never))
    expect(replyTargetIn(app.state, ROOM)).toBe('n1')
  })
})

describe('keeping notes', () => {
  it('files a note and counts the change for every conversation that showed it', () => {
    const { state } = testApp()
    state.threads.set(new Map([['conv_other0000000' as never, { notes: [note('n1')], hasMore: false }]]))
    rememberNote(state)(note('n1'))
    expect(state.changes.changesTo('conv_other0000000' as never)).toBe(1)
    expect(state.changes.changesTo(ROOM)).toBe(1)
    forgetNote(state, ROOM, 'n1' as never)
    forgetNote(state, 'conv_none00000000' as never, 'n1' as never)
    expect(state.threads.get().get(ROOM)?.notes ?? []).toEqual([])
  })

  it('marks a note read, and forgets a release once a draft answers it', async () => {
    const { run, state, routes } = testApp({ 'notes.read': () => note('n1') })
    await run(markRead(note('n1')))
    expect(routes()).toEqual(['notes.read'])
    rememberNotices(state, ROOM, [])
    state.releases.set(new Map([['n1' as never, { reason: null, agentName: null }]]))
    const before = state.releases.get()
    forgetRelease(state, 'n2' as never)
    expect(state.releases.get()).toBe(before)
    forgetRelease(state, 'n1' as never)
    expect(state.releases.get().size).toBe(0)
  })
})
