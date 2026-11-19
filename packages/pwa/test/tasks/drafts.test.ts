import { describe, expect, it } from 'vitest'
import {
  approveDraft,
  askAgent,
  discardDraft,
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
    expect(sent[0]!.request).toEqual({ params: { id: 'd1' }, body: {} })
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
      body: { body: 'Edited' },
    })
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
