import type { AsRead, MemberId, NoteId } from '@homingbird/protocol'
import { Conflict, Forbidden, NotFound } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { heldWordsFor } from '../../src/held-decisions.ts'
import * as tasks from '../../src/tasks/channel-agents.ts'
import { fail, testApp } from '../support/app.ts'
import { CY, conversation, draft, everything, member, note, serverInfo } from '../support/fixtures.ts'

const AGENT = 'mem_agent0000000' as MemberId

const review = (fields: Partial<AsRead.Review> = {}): AsRead.Review => ({
  note: draft('note_answer00000', { authorId: AGENT, inReplyTo: 'note_question000' as NoteId }),
  question: note('note_question000', { authorId: CY }),
  channel: 'payments-wiki',
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  privately: false,
  ...fields,
})

const agentView: AsRead.ChannelAgent = {
  agent: member(AGENT, 'Payments wiki', { kind: 'channel_agent' }),
  channel: 'payments-wiki',
  credentials: [],
}

describe('the channel agent tasks', () => {
  it('load the waiting answers only while channel agents are on, and close the notices of the others', async () => {
    const { run, state, routes, page } = testApp({ 'reviews.list': () => ({ reviews: [review()] }) })
    state.serverInfo.set(serverInfo())
    await run(tasks.loadReviews)
    expect(routes()).toEqual([])
    state.serverInfo.set(everything())
    page.notifications.set(`review:${review().note.id}`, 0).set('review:note_sent000000', 0)
    await run(tasks.loadReviews)
    expect(state.reviews.get()).toEqual([review()])
    expect([...page.notifications.keys()]).toEqual([`review:${review().note.id}`])
    expect(state.reviewsRead.get().get(review().note.id)).toEqual({
      body: review().note.body,
      conversationId: review().note.conversationId,
    })
  })

  it('send an answer bound to how the manager first read it, edited or not', async () => {
    const { run, state, sent } = testApp({ 'reviews.list': () => ({ reviews: [] }) })
    state.serverInfo.set(everything())
    state.reviews.set([review()])
    const changed = review({ note: { ...review().note, body: 'Changed by the agent' } })
    await run(tasks.sendReview(changed, null))
    await run(tasks.sendReview(changed, 'Edited'))
    const sends = sent.filter((one) => one.route === 'drafts.send').map((one) => one.request)
    expect(sends).toEqual([
      {
        params: { id: changed.note.id },
        body: { expected: { body: review().note.body, conversationId: review().note.conversationId } },
      },
      {
        params: { id: changed.note.id },
        body: {
          body: 'Edited',
          expected: { body: review().note.body, conversationId: review().note.conversationId },
        },
      },
    ])
    expect(state.reviews.get()).toEqual([])
  })

  it('read the answers again when a send is refused because the agent changed it', async () => {
    const { run, state, routes } = testApp({
      'drafts.send': () => fail(Conflict({ message: 'This draft changed; read it again.' })),
      'reviews.list': () => ({ reviews: [] }),
    })
    state.serverInfo.set(everything())
    const outcome = await run(tasks.sendReview(review(), null))
    expect(outcome._tag).toBe('Err')
    expect(routes()).toEqual(['drafts.send', 'reviews.list'])
    const other = testApp({ 'drafts.send': () => fail(Forbidden({ message: 'No.' })) })
    await other.run(tasks.sendReview(review(), null))
    expect(other.routes()).toEqual(['drafts.send'])
  })

  it('discard an answer, and remember one the manager read again', async () => {
    const { run, state, routes, sent } = testApp({ 'reviews.list': () => ({ reviews: [] }) })
    const bodies = (route: string) =>
      sent.filter((one) => one.route === route).map((one) => (one.request as { body: unknown }).body)
    state.serverInfo.set(everything())
    await run(tasks.discardReview(review(), '  '))
    await run(tasks.discardReview(review(), ' Out of date. '))
    expect(routes()).toEqual(['drafts.discard', 'reviews.list', 'drafts.discard', 'reviews.list'])
    expect(bodies('drafts.discard')).toEqual([{}, { reason: 'Out of date.' }])
    const changed = review({ note: { ...review().note, body: 'New' } })
    await run(tasks.confirmReviewRead(changed))
    expect(state.reviewsRead.get().get(changed.note.id)?.body).toBe('New')
  })

  it('hold a send or discard of an answer, asking nothing of the server until it is carried out', async () => {
    const { run, state, routes } = testApp({ 'reviews.list': () => ({ reviews: [] }) })
    state.serverInfo.set(everything())
    const words = heldWordsFor('#payments-wiki')
    await run(tasks.holdReviewSend(review(), 'Edited', words.send))
    expect([routes(), state.held.get()]).toMatchObject([
      [],
      [{ noteId: review().note.id, kind: 'send', review: true, settles: 0, words: words.send }],
    ])
    await run(tasks.holdReviewDiscard(review({ note: draft('note_other000000') }), 'Why', words.discard))
    expect(routes()).toEqual(['drafts.send', 'reviews.list'])
    expect(state.held.get().at(-1)).toMatchObject({ kind: 'discard', review: true, words: words.discard })
  })

  it('reads the room again after sending an answer when the page shows it, so the note takes the card’s place', async () => {
    const { run, state, routes } = testApp({
      'reviews.list': () => ({ reviews: [] }),
      'conversations.get': () => conversation({ id: review().note.conversationId }),
      'conversations.notes': () => ({ notes: [], hasMore: false, notices: [] }),
    })
    state.serverInfo.set(everything())
    await run(tasks.sendReview(review(), null))
    expect(routes()).toEqual(['drafts.send', 'reviews.list'])
    state.threads.set(new Map([[review().note.conversationId, { notes: [], hasMore: false }]]))
    await run(tasks.sendReview(review(), null))
    expect(routes().slice(2)).toEqual([
      'drafts.send',
      'reviews.list',
      'conversations.get',
      'conversations.notes',
    ])
  })

  it('learn what became of an answer: the note once sent, nothing when it cannot be read', async () => {
    const answer = note('note_answer00000', { authorId: AGENT, approvedBy: CY })
    const sent = testApp({ 'notes.get': () => answer })
    expect(await sent.run(tasks.loadDecidedAnswer(answer.id))).toEqual({ _tag: 'Ok', value: answer })
    const gone = testApp({ 'notes.get': () => fail(NotFound({ message: 'No such note.' })) })
    expect(await gone.run(tasks.loadDecidedAnswer(answer.id))).toEqual({ _tag: 'Ok', value: null })
    const refused = testApp({ 'notes.get': () => fail(Forbidden({ message: 'No.' })) })
    expect((await refused.run(tasks.loadDecidedAnswer(answer.id)))._tag).toBe('Err')
  })

  it('load a channel’s agent, forgetting it when there is none, and refusing other failures', async () => {
    const found = testApp({ 'channels.agent.get': () => agentView })
    expect(await found.run(tasks.loadChannelAgent('payments-wiki'))).toEqual({ _tag: 'Ok', value: agentView })
    expect(found.state.channelAgents.get().get('payments-wiki')).toEqual(agentView)
    const gone = testApp({
      'channels.agent.get': () => fail(NotFound({ message: 'This channel has no agent.' })),
    })
    gone.state.channelAgents.set(new Map([['payments-wiki', agentView]]))
    expect(await gone.run(tasks.loadChannelAgent('payments-wiki'))).toEqual({ _tag: 'Ok', value: null })
    expect(gone.state.channelAgents.get().has('payments-wiki')).toBe(false)
    const refused = testApp({ 'channels.agent.get': () => fail(Forbidden({ message: 'No.' })) })
    expect((await refused.run(tasks.loadChannelAgent('payments-wiki')))._tag).toBe('Err')
  })

  it('load how the agent is doing for a manager, nothing for anyone else, and fail on other refusals', async () => {
    const figures = {
      generatedAt: 1,
      channel: 'payments-wiki',
      quickApprovalSeconds: 3,
      minimumGroupSize: 5,
      waiting: 0,
      periods: [],
    } satisfies AsRead.ChannelAgentReport
    const found = testApp({ 'channels.agent.figures': () => figures })
    expect(await found.run(tasks.loadChannelAgentFigures('payments-wiki'))).toEqual({
      _tag: 'Ok',
      value: figures,
    })
    const hidden = testApp({ 'channels.agent.figures': () => fail(NotFound({ message: 'Only managers.' })) })
    expect(await hidden.run(tasks.loadChannelAgentFigures('payments-wiki'))).toEqual({
      _tag: 'Ok',
      value: null,
    })
    const refused = testApp({ 'channels.agent.figures': () => fail(Forbidden({ message: 'No.' })) })
    expect((await refused.run(tasks.loadChannelAgentFigures('payments-wiki')))._tag).toBe('Err')
  })

  it('make, rename and retire the agent and disconnect a desk, reading the agent again each time', async () => {
    const { run, state, routes } = testApp({
      'channels.agent.get': () => agentView,
      'channels.list': () => ({ channels: [], hasMore: false, cursor: null }),
      'reviews.list': () => ({ reviews: [] }),
    })
    state.serverInfo.set(everything())
    await run(tasks.createChannelAgent('payments-wiki', 'Payments wiki'))
    await run(tasks.renameChannelAgent('payments-wiki', 'Refunds wiki'))
    await run(tasks.retireChannelAgent('payments-wiki'))
    await run(tasks.disconnectAgentDesk('payments-wiki', 'cred_desk00000000' as never))
    expect(routes()).toEqual([
      'channels.agent.create',
      'channels.agent.get',
      'channels.list',
      'channels.agent.rename',
      'channels.agent.get',
      'channels.list',
      'channels.agent.retire',
      'channels.agent.get',
      'channels.list',
      'reviews.list',
      'channels.agent.credentials.revoke',
      'channels.agent.get',
    ])
  })

  it('ask privately and go to the conversation it opens', async () => {
    const { run, page } = testApp({
      'channels.askPrivately': () => ({ id: 'conv_asked0000000' }),
      'conversations.list': () => ({ conversations: [] }),
    })
    await run(tasks.askPrivately('payments-wiki'))
    expect(page.visited).toEqual(['go #/c/conv_asked0000000'])
  })
})
