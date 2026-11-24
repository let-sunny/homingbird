import type { ConversationId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { MISSING } from '../../src/missing.ts'
import {
  chooseReplyTarget,
  forgetNote,
  forgetRelease,
  keepComposerTags,
  keepComposerText,
  loadOlderNotes,
  loadThread,
  markRead,
  openThread,
  recallNote,
  rememberNote,
  rememberNotices,
  replyTargetIn,
  replyTo,
  sendNote,
} from '../../src/tasks/notes.ts'
import { invalidate } from '../../src/tasks/resources.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { ANA, BEN, CY, ROOM, conversation, everything, me, note } from '../support/fixtures.ts'

const OTHER = 'conv_other0000000' as ConversationId

const SLACK_VIA = {
  tool: 'slack' as const,
  askerName: 'Pat Rivera',
  askerId: null,
  channelName: 'eng-help',
  edited: false,
  deleted: false,
  threadAt: '1763900300.000100',
  newerMessages: 0,
}

const receipt = (readAt: number | null) => ({
  memberId: ANA,
  state: readAt === null ? ('delivered' as const) : ('read' as const),
  deliveredAt: 1,
  readAt,
  draftingAt: null,
  repliedAt: null,
})

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

  it('keeps the older notes the person already loaded when the first page is read again', async () => {
    const app = testApp({
      'conversations.get': () => conversation(),
      'conversations.notes': () =>
        page([note('n5', { sentAt: 5 }), note('n6', { sentAt: 6 }), note('n7', { sentAt: 7 })], true),
    })
    app.state.threads.set(
      new Map([
        [
          ROOM,
          {
            notes: [
              note('n1', { sentAt: 1 }),
              note('n4', { sentAt: 4 }),
              note('n5', { sentAt: 5 }),
              note('n6', { sentAt: 6 }),
            ],
            hasMore: false,
          },
        ],
      ]),
    )
    await app.run(loadThread(ROOM))
    expect(app.state.threads.get().get(ROOM)).toEqual({
      notes: [
        note('n1', { sentAt: 1 }),
        note('n4', { sentAt: 4 }),
        note('n5', { sentAt: 5 }),
        note('n6', { sentAt: 6 }),
        note('n7', { sentAt: 7 }),
      ],
      hasMore: false,
    })
  })

  it('replaces the notes held when the first page no longer reaches them, as after many new notes', async () => {
    const app = testApp({
      'conversations.get': () => conversation(),
      'conversations.notes': () => page([note('n8', { sentAt: 8 }), note('n9', { sentAt: 9 })], true),
    })
    app.state.threads.set(
      new Map([[ROOM, { notes: [note('n1', { sentAt: 1 }), note('n2', { sentAt: 2 })], hasMore: false }]]),
    )
    await app.run(loadThread(ROOM))
    expect(app.state.threads.get().get(ROOM)).toEqual({
      notes: [note('n8', { sentAt: 8 }), note('n9', { sentAt: 9 })],
      hasMore: true,
    })
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
  it('writes and sends it as a reply to the note chosen, then forgets the reply target', async () => {
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
    await app.run(chooseReplyTarget(ROOM, 'q' as never))
    await app.run(sendNote(ROOM, 'Yes'))
    expect(app.sent[0]!.request).toEqual({ body: { body: 'Yes', conversationId: ROOM, inReplyTo: 'q' } })
    expect(app.sent[1]!.request).toEqual({
      params: { id: 'd1' },
      body: { expected: { body: 'Yes', conversationId: ROOM } },
    })
    expect(app.state.sendingIn.get().size).toBe(0)
    expect(
      app.state.threads
        .get()
        .get(ROOM)!
        .notes.map((one) => one.id),
    ).toEqual(['q', 'd1'])
  })

  it('is sent, and no longer sending, when only the reload after it fails', async () => {
    const app = testApp({
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
      'drafts.send': () => note('d1', { authorId: ANA }),
      'conversations.list': () => fail({ _tag: 'Unavailable', message: 'down' }),
    })
    app.state.session.set(me())
    expect((await app.run(sendNote(ROOM, 'Yes')))._tag).toBe('Ok')
    expect(app.state.sendingIn.get().size).toBe(0)
  })

  it('binds a reply typed to a question from Slack to that thread as the page shows it', async () => {
    const app = testApp({
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
      'drafts.send': () => note('d1', { authorId: ANA }),
    })
    app.state.session.set(me())
    const question = note('q', { authorId: BEN, origin: 'outside', via: SLACK_VIA })
    app.state.threads.set(new Map([[ROOM, { notes: [question], hasMore: false }]]))
    await app.run(chooseReplyTarget(ROOM, 'q' as never))
    await app.run(sendNote(ROOM, 'Yes'))
    expect(app.sent[1]!.request).toEqual({
      params: { id: 'd1' },
      body: { expected: { body: 'Yes', conversationId: ROOM, threadAt: SLACK_VIA.threadAt } },
    })
  })

  it('sends the people tagged in a group, names whom the note asks as shown, then forgets the tags', async () => {
    const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    const app = testApp({
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA, tags: [CY] }),
      'drafts.send': () => note('d1', { authorId: ANA, tags: [CY] }),
      'conversations.list': () => ({ conversations: [group] }),
    })
    app.state.session.set(me())
    app.state.serverInfo.set(everything())
    app.state.conversations.set([group])
    await app.run(keepComposerTags(ROOM, [CY, 'mem_gone00000000' as never]))
    await app.run(sendNote(ROOM, 'Cy?'))
    expect(app.sent[0]!.request).toEqual({ body: { body: 'Cy?', conversationId: ROOM, tags: [CY] } })
    expect(app.sent[1]!.request).toEqual({
      params: { id: 'd1' },
      body: { expected: { body: 'Cy?', conversationId: ROOM, tags: [CY] } },
    })
    expect(app.state.composerTags.get().size).toBe(0)
  })

  it('names the author a reply in a group asks when it tags nobody, and asks everyone with a new note', async () => {
    const group = conversation({ kind: 'group', participantIds: [ANA, BEN, CY] })
    const app = testApp({
      'drafts.create': () => note('d1', { status: 'draft', authorId: ANA }),
      'drafts.send': () => note('d1', { authorId: ANA }),
      'conversations.list': () => ({ conversations: [group] }),
    })
    app.state.session.set(me())
    app.state.serverInfo.set(everything())
    app.state.conversations.set([group])
    app.state.threads.set(new Map([[ROOM, { notes: [note('q', { authorId: BEN })], hasMore: false }]]))
    await app.run(chooseReplyTarget(ROOM, 'q' as never))
    await app.run(sendNote(ROOM, 'Yes'))
    expect(app.sent[0]!.request).toEqual({ body: { body: 'Yes', conversationId: ROOM, inReplyTo: 'q' } })
    expect(app.sent[1]!.request).toMatchObject({ body: { expected: { tags: [BEN] } } })
    await app.run(sendNote(ROOM, 'All of you'))
    const sends = app.sent.filter((one) => one.route === 'drafts.send')
    expect(sends.at(-1)!.request).toMatchObject({ body: { expected: { tags: [] } } })
  })

  it('keeps tags until they are taken out, one conversation at a time', async () => {
    const app = testApp()
    await app.run(keepComposerTags(ROOM, [BEN]))
    expect(app.state.composerTags.get().get(ROOM)).toEqual([BEN])
    await app.run(keepComposerTags(ROOM, []))
    expect(app.state.composerTags.get().has(ROOM)).toBe(false)
  })

  it('lets go of the sending mark after a failure, and sends a new note where no reply is chosen', async () => {
    const app = testApp({ 'drafts.create': () => fail({ _tag: 'Forbidden', message: 'no' }) })
    app.state.threads.set(new Map([[ROOM, { notes: [note('q', { authorId: BEN })], hasMore: false }]]))
    await app.run(sendNote(ROOM, 'Hi'))
    expect(app.sent[0]!.request).toEqual({ body: { body: 'Hi', conversationId: ROOM } })
    expect(app.state.sendingIn.get().size).toBe(0)
  })
})

describe('the reply target', () => {
  it('is none until the person chooses a note, even when a note waits for their reply', async () => {
    const app = testApp()
    app.state.session.set(me())
    app.state.conversations.set([conversation()])
    const waiting = note('q', {
      authorId: BEN,
      receipts: [
        { memberId: ANA, state: 'read', deliveredAt: 1, readAt: 1, draftingAt: null, repliedAt: null },
      ],
    })
    app.state.threads.set(new Map([[ROOM, { notes: [waiting], hasMore: false }]]))
    expect(replyTargetIn(app.state, ROOM)).toBeNull()
    await app.run(chooseReplyTarget(ROOM, 'q' as never))
    expect(replyTargetIn(app.state, ROOM)).toBe('q')
    await app.run(chooseReplyTarget(ROOM, null))
    expect(replyTargetIn(app.state, ROOM)).toBeNull()
  })

  it('answers a note by making it the reply target and asking the composer to take the focus', async () => {
    const app = testApp({})
    await app.run(replyTo(ROOM, 'q' as never))
    expect(replyTargetIn(app.state, ROOM)).toBe('q')
    expect(app.state.composerFocus.get()).toBe(ROOM)
  })

  it('keeps unsent text in memory, and in this browser once signed in, and forgets it once cleared', async () => {
    const app = testApp({})
    const key = `homingbird.composer.${ANA}`
    await app.run(keepComposerText(ROOM, 'Typed'))
    expect(app.page.local.has(key)).toBe(false)
    await app.run(keepComposerText(ROOM, ''))
    app.state.session.set(me())
    const typed: unknown[] = []
    app.state.typedIn.subscribe((ids) => typed.push([...ids]))
    await app.run(keepComposerText(ROOM, 'Typed'))
    await app.run(keepComposerText(ROOM, 'Typed more'))
    expect(app.state.composerTexts.get()).toEqual(new Map([[ROOM, 'Typed more']]))
    expect(JSON.parse(app.page.local.get(key)!)).toEqual({ [ROOM]: 'Typed more' })
    await app.run(keepComposerText(ROOM, 'Typed more'))
    await app.run(keepComposerText(ROOM, '  '))
    expect(app.state.composerTexts.get().size).toBe(0)
    expect(app.page.local.has(key)).toBe(false)
    expect(typed).toEqual([[ROOM], []])
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

  it('lowers the conversation’s unread count once a note it counted is read', async () => {
    const unread = note('n1', { authorId: BEN, receipts: [receipt(null)] })
    const read = note('n1', { authorId: BEN, receipts: [receipt(5)] })
    const { run, state } = testApp({ 'notes.read': () => read })
    state.session.set(me())
    state.conversations.set([conversation({ unreadCount: 2 }), conversation({ id: OTHER, unreadCount: 1 })])
    await run(markRead(unread))
    expect(state.conversations.get().map((room) => room.unreadCount)).toEqual([1, 1])
    await run(markRead(read))
    expect(state.conversations.get().map((room) => room.unreadCount)).toEqual([1, 1])
  })

  it('lowers the count to what was left, once, on a list that may have counted before or after, and asks for it again', async () => {
    const first = hold<unknown>()
    const lists = [first.waiting, { conversations: [conversation({ unreadCount: 1 })] }]
    let asked = 0
    const { app, run, state } = testApp({
      'notes.read': ({ params }) => note(params.id, { authorId: BEN, receipts: [receipt(5)] }),
      'conversations.list': () => lists[asked++],
    })
    state.session.set(me())
    state.conversations.set([conversation({ unreadCount: 3 })])
    app.launch(invalidate('conversations'))
    await settle()
    for (const id of ['n1', 'n2']) await run(markRead(note(id, { authorId: BEN, receipts: [receipt(null)] })))
    const shown: number[] = []
    state.conversations.subscribe((rooms) => shown.push(rooms[0]!.unreadCount))
    first.release({ conversations: [conversation({ unreadCount: 2 })] })
    await settle()
    expect(shown).toEqual([1, 1])
    expect(asked).toBe(2)
  })

  it('never lowers an unread count below none, nor while nobody is signed in', async () => {
    const unread = note('n1', { authorId: BEN, receipts: [receipt(null)] })
    const read = note('n1', { authorId: BEN, receipts: [receipt(5)] })
    const { run, state } = testApp({ 'notes.read': () => read })
    state.conversations.set([conversation({ unreadCount: 1 })])
    await run(markRead(unread))
    expect(state.conversations.get()[0]!.unreadCount).toBe(1)
    state.session.set(me())
    state.conversations.set([conversation({ unreadCount: 0 })])
    await run(markRead(unread))
    expect(state.conversations.get()[0]!.unreadCount).toBe(0)
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

describe('recalling a note', () => {
  it('asks the server to recall it and files the recalled note in its thread', async () => {
    const recalled = note('n1', { authorId: ANA, status: 'withdrawn', autoSent: true })
    const { run, sent, state } = testApp({
      'notes.recall': () => recalled,
      'conversations.list': () => ({ conversations: [] }),
    })
    state.threads.set(
      new Map([[ROOM, { notes: [note('n1', { authorId: ANA, autoSent: true })], hasMore: false }]]),
    )
    await run(recallNote(note('n1')))
    expect(sent.map((one) => [one.route, one.request])).toContainEqual([
      'notes.recall',
      { params: { id: 'n1' } },
    ])
    expect(state.threads.get().get(ROOM)!.notes).toEqual([recalled])
  })
})
