import { DRAFT_CHANGED } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import {
  approveDraft,
  askAgent,
  confirmDraftRead,
  discardDraft,
  holdDiscard,
  holdSend,
  readdressDraft,
  reportDraftSeen,
  saveDraft,
  withdrawRequest,
} from '../../src/tasks/drafts.ts'
import { fail, testApp } from '../support/app.ts'
import { ROOM, conversation, draft, note } from '../support/fixtures.ts'

const request = {
  id: 'dreq_1',
  conversationId: ROOM,
  inReplyTo: null,
  instruction: '',
  agentId: null,
  createdAt: 1,
  expiresAt: 2,
  cancelledAt: null,
  draftIds: [],
}

const answers = {
  'drafts.send': () => note('d1'),
  'drafts.update': () => draft('d1', { conversationId: 'conv_moved0000000' as never }),
  'insights.mine': () => fail({ _tag: 'Unavailable', message: 'down' }),
  'principles.list': () => fail({ _tag: 'Unavailable', message: 'down' }),
  'conversations.get': () => conversation(),
  'conversations.notes': () => ({ notes: [], hasMore: false, notices: [] }),
  'conversations.list': () => ({ conversations: [] }),
  'draftRequests.create': () => request,
  'draftRequests.cancel': () => ({ ...request, cancelledAt: 3 }),
  'drafts.seen': () => fail({ _tag: 'Unavailable', message: 'down' }),
}

describe('deciding on drafts', () => {
  it('sends a draft as written or edited, discards its alternatives, and refreshes what it changed', async () => {
    const { run, sent, state } = testApp(answers)
    await run(approveDraft(draft('d1'), null, [draft('d2')]))
    const asRead = { body: draft('d1').body, conversationId: draft('d1').conversationId }
    expect(sent[0]!.request).toEqual({ params: { id: 'd1' }, body: { expected: asRead } })
    expect(sent.map((one) => one.route)).toEqual(
      expect.arrayContaining([
        'drafts.discard',
        'insights.mine',
        'principles.list',
        'conversations.get',
        'conversations.list',
      ]),
    )
    expect(state.agentReport.get()).toBe('failed')
    await run(approveDraft(draft('d1'), 'Edited', []))
    expect(sent.filter((one) => one.route === 'drafts.send')[1]!.request).toEqual({
      params: { id: 'd1' },
      body: { body: 'Edited', expected: asRead },
    })
  })

  it('binds a reply to a question from Slack to the thread’s newest message as the card showed it', async () => {
    const { run, sent, state } = testApp(answers)
    const question = note('q1', {
      origin: 'outside',
      via: {
        tool: 'slack',
        askerName: 'Bob',
        askerId: null,
        channelName: 'billing-help',
        edited: false,
        deleted: false,
        threadAt: '1700000001.000200',
        newerMessages: 0,
      },
    })
    state.threads.set(new Map([[ROOM, { notes: [question], hasMore: false }]]))
    const reply = draft('d1', { inReplyTo: question.id })
    await run(approveDraft(reply, null, []))
    expect(sent[0]!.request).toEqual({
      params: { id: 'd1' },
      body: { expected: { body: reply.body, conversationId: ROOM, threadAt: '1700000001.000200' } },
    })
  })

  it('reads the thread again when the draft changed after the person read it, and sends nothing', async () => {
    const { run, sent } = testApp({
      ...answers,
      'drafts.send': () => fail({ _tag: 'Conflict', message: 'This draft changed; read it again.' }),
    })
    const exit = await run(approveDraft(draft('d1'), null, [draft('d2')]))
    expect(exit).toMatchObject({ _tag: 'Err' })
    expect(sent.map((one) => one.route)).toEqual([
      'drafts.send',
      'conversations.get',
      'conversations.notes',
      'notes.get',
    ])
  })

  it('reads the draft’s new room too when its agent moved it, so the person finds it there', async () => {
    const MOVED = 'conv_moved0000000' as never
    const { run, sent, state } = testApp({
      ...answers,
      'drafts.send': () => fail({ _tag: 'Conflict', message: DRAFT_CHANGED }),
      'notes.get': () => draft('d1', { conversationId: MOVED, body: 'elsewhere' }),
      'conversations.notes': () => ({
        notes: [draft('d1', { conversationId: MOVED, body: 'elsewhere' })],
        hasMore: false,
        notices: [],
      }),
    })
    await run(approveDraft(draft('d1'), null, []))
    expect(sent.filter((one) => one.route === 'conversations.get').map((one) => one.request)).toEqual([
      { params: { id: ROOM } },
      { params: { id: MOVED } },
    ])
    expect(state.threads.get().get(MOVED)!.notes[0]!.body).toBe('elsewhere')
  })

  it('reads nothing more when the draft was sent or discarded elsewhere, or stayed in its room', async () => {
    for (const now of [note('d1'), draft('d1', { body: 'rewritten' })]) {
      const { run, sent } = testApp({
        ...answers,
        'drafts.send': () => fail({ _tag: 'Conflict', message: DRAFT_CHANGED }),
        'notes.get': () => now,
      })
      await run(approveDraft(draft('d1'), null, []))
      expect(sent.filter((one) => one.route === 'conversations.get')).toHaveLength(1)
    }
  })

  it('takes what the person saved or moved, and a draft they read again, as read', async () => {
    const { run, state } = testApp({ ...answers, 'drafts.update': () => draft('d1', { body: 'Better' }) })
    await run(saveDraft(draft('d1'), 'Better'))
    expect(state.draftsRead.get().get('d1' as never)).toEqual({ body: 'Better', conversationId: ROOM })
    const changed = draft('d1', { body: 'from the agent' })
    await run(confirmDraftRead(changed))
    expect(state.draftsRead.get().get('d1' as never)).toEqual({
      body: 'from the agent',
      conversationId: ROOM,
    })
    const moved = testApp(answers)
    await moved.run(readdressDraft(draft('d1'), 'billing'))
    expect(moved.state.draftsRead.get().get('d1' as never)!.conversationId).toBe('conv_moved0000000')
  })

  it('leaves the thread alone when sending fails for another reason', async () => {
    const { run, sent } = testApp({
      ...answers,
      'drafts.send': () => fail({ _tag: 'Forbidden', message: 'No.' }),
    })
    await run(approveDraft(draft('d1'), null, []))
    expect(sent.map((one) => one.route)).toEqual(['drafts.send'])
  })

  it('keeps the refusal when reading the thread again fails too', async () => {
    const { run, sent } = testApp({
      ...answers,
      'drafts.send': () => fail({ _tag: 'Conflict', message: 'This draft changed; read it again.' }),
      'conversations.get': () => fail({ _tag: 'Unavailable', message: 'down' }),
    })
    expect(await run(approveDraft(draft('d1'), null, []))).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Fail', error: { _tag: 'Conflict' } },
    })
    expect(sent[0]!.route).toBe('drafts.send')
  })

  it('saves an edit, discards a draft, and sends it to another channel’s room', async () => {
    const { run, routes, page, state } = testApp(answers)
    await run(saveDraft(draft('d1'), 'Better'))
    state.threads.set(new Map([[ROOM, { notes: [draft('d1')], hasMore: false }]]))
    await run(discardDraft(draft('d1')))
    expect(state.threads.get().get(ROOM)!.notes).toEqual([])
    await run(readdressDraft(draft('d1'), 'billing'))
    expect(page.visited).toEqual(['go #/c/conv_moved0000000'])
    expect(routes()).toContain('drafts.discard')
  })

  it('holds a send and a discard until they are carried out, and carries out a held one first', async () => {
    const { run, routes, state } = testApp(answers)
    const words = heldWordsFor('Ben')
    await run(holdSend(draft('d1'), null, [draft('d3')], words.send))
    expect(routes()).toEqual([])
    expect(state.held.get()).toMatchObject([
      { noteId: 'd1', conversationId: ROOM, kind: 'send', review: false, settles: 2, words: words.send },
    ])
    await run(holdDiscard(draft('d2'), words.discard))
    expect(routes()[0]).toBe('drafts.send')
    expect(state.held.get()).toMatchObject([
      { noteId: 'd1', phase: 'done' },
      { noteId: 'd2', kind: 'discard', settles: 1, phase: 'waiting', words: words.discard },
    ])
  })

  it('asks the agent for a draft and forgets the release it answers, and withdraws a request', async () => {
    const { run, state } = testApp(answers)
    state.releases.set(new Map([['q' as never, { reason: null, agentName: null }]]))
    await run(askAgent({ destination: { conversationId: ROOM }, instruction: '', agentId: null }))
    expect(state.releases.get().size).toBe(1)
    await run(askAgent({ destination: { inReplyTo: 'q' as never }, instruction: ' Yes ', agentId: null }))
    expect(state.releases.get().size).toBe(0)
    await run(withdrawRequest(request as never))
    expect(state.draftRequests.get()).toEqual([])
  })

  it('reports a draft seen and drops a failure', async () => {
    const { run } = testApp(answers)
    expect((await run(reportDraftSeen('d1' as never)))._tag).toBe('Ok')
  })
})
