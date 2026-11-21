import { makeTestClock } from '@homingbird/kernel'
import type { ConversationId, MemberId, Note } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { ANSWER_AFTER_MS, APPROVAL_AFTER_MS, DRAFTING_AFTER_MS, PERSON_FOLLOW_UP } from '../src/colleagues.ts'
import { FOLLOW_UP_REPLY, OWN_AGENT_AFTER_MS } from '../src/own-agent.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('answerLater', () => {
  it('has the colleague’s agent draft, then delivers its answer as the colleague approved it', async () => {
    const { june, clock, world } = started()
    const kai = memberNamed(world, 'Kai Lin')
    const asked = await send(june, { to: [kai] }, 'Can the deploy wait until Friday?')
    await clock.advance(DRAFTING_AFTER_MS)
    expect(receiptOf(world, asked.id, kai)?.state).toBe('drafting')
    expect(world.eventsAfter(VISITOR_ID, 0).map((event) => event.body.type)).toContain('note.status')
    await clock.advance(ANSWER_AFTER_MS - DRAFTING_AFTER_MS)
    const answer = world.records().notes.find((note) => note.inReplyTo === asked.id)
    expect(answer).toMatchObject({
      authorId: kai,
      status: 'sent',
      origin: 'agent',
      agentName: "Kai's laptop",
      approvedBy: null,
    })
    expect(answer?.receipts.map((receipt) => receipt.memberId)).toEqual([VISITOR_ID])
    expect(receiptOf(world, asked.id, kai)?.state).toBe('replied')
    const thread = await succeeded(
      june.api['conversations.notes']({ params: { id: asked.conversationId }, query: {} }),
    )
    expect(thread.notes.map((note) => note.id)).toContain(answer?.id)
  })

  it('asks the visitor back once after a reply, which their own agent drafts an answer to, then thanks them', async () => {
    const { june, clock, world } = started()
    const draft = world
      .records()
      .notes.find((note) => note.status === 'draft' && note.authorId === VISITOR_ID)!
    const approve = (note: Note) =>
      succeeded(
        june.api['drafts.send']({
          params: { id: note.id },
          body: { expected: { body: note.body, conversationId: note.conversationId } },
        }),
      )
    await approve(draft)
    await clock.advance(ANSWER_AFTER_MS)
    const askedBack = world.records().notes.find((note) => note.inReplyTo === draft.id)!
    expect(askedBack).toMatchObject({ body: PERSON_FOLLOW_UP, status: 'sent' })
    await clock.advance(OWN_AGENT_AFTER_MS)
    const reply = world.records().notes.find((note) => note.inReplyTo === askedBack.id)!
    expect(reply).toMatchObject({
      authorId: VISITOR_ID,
      status: 'draft',
      origin: 'agent',
      agentName: "June's laptop",
      body: FOLLOW_UP_REPLY,
    })
    expect(world.eventsAfter(VISITOR_ID, 0).map((event) => event.body)).toContainEqual({
      type: 'draft.saved',
      note: reply,
    })
    await approve(reply)
    await clock.advance(ANSWER_AFTER_MS + OWN_AGENT_AFTER_MS)
    const thanks = world.records().notes.find((note) => note.inReplyTo === reply.id)
    expect(thanks?.body).toBe('Thanks, that is what I needed.')
    expect(world.records().notes.some((note) => note.inReplyTo === thanks?.id)).toBe(false)
  })

  it('has a channel’s agent answer the visitor’s question, hidden from them, until another manager sends it (rules 1 and 2)', async () => {
    const { june, clock, world } = started()
    const ana = memberNamed(world, 'Ana Silva')
    const asked = await send(june, { channel: 'billing' }, 'How long does a refund take to arrive?')
    await clock.advance(ANSWER_AFTER_MS)
    const draft = world.records().notes.find((note) => note.inReplyTo === asked.id)!
    expect(draft).toMatchObject({
      status: 'draft',
      agentName: 'Billing helper',
      basis: 'Past answers in #billing.',
    })
    expect(await refused(june.api['notes.get']({ params: { id: draft.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    const reviews = await succeeded(june.api['reviews.list']({}))
    expect(reviews.reviews.map((review) => review.note.id)).not.toContain(draft.id)
    const asAna = demoApi(ana, world)
    expect(
      (await succeeded(asAna.api['reviews.list']({}))).reviews.map((review) => review.note.id),
    ).toContain(draft.id)
    await clock.advance(APPROVAL_AFTER_MS)
    const sent = world.records().notes.find((note) => note.id === draft.id)
    expect(sent).toMatchObject({ status: 'sent', approvedBy: ana })
    expect(sent?.receipts.map((receipt) => receipt.memberId)).toEqual([VISITOR_ID])
    expect(receiptOf(world, asked.id, draft.authorId)?.state).toBe('replied')
    expect(receiptOf(world, asked.id, ana)?.state).not.toBe('replied')
  })

  it('leaves a channel’s agent’s answer to the visitor when they may review it, and never sends it for them', async () => {
    const { clock, world } = started()
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    const asked = await send(ben, { channel: 'billing' }, 'Do we refund the setup fee?')
    await clock.advance(ANSWER_AFTER_MS + APPROVAL_AFTER_MS * 10)
    const draft = world.records().notes.find((note) => note.inReplyTo === asked.id)!
    expect(draft.status).toBe('draft')
    expect(world.eventsAfter(VISITOR_ID, 0).map((event) => event.body)).toContainEqual({
      type: 'review.changed',
      noteId: draft.id,
    })
    const june = demoApi(VISITOR_ID, world)
    expect((await succeeded(june.api['reviews.list']({}))).reviews.map((review) => review.note.id)).toContain(
      draft.id,
    )
  })

  it('has a colleague whose agent answers in a channel without an agent answer there', async () => {
    const { june, clock, world } = started()
    const asked = await send(june, { channel: 'deploys' }, 'Is the train leaving on time today?')
    await clock.advance(ANSWER_AFTER_MS)
    expect(world.records().notes.find((note) => note.inReplyTo === asked.id)).toMatchObject({
      authorId: memberNamed(world, 'Kai Lin'),
      status: 'sent',
    })
  })

  it('never answers as the visitor, and stays silent where nobody else answers', async () => {
    const { june, clock, world } = started()
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    const toJune = await send(ben, { to: [VISITOR_ID] }, 'Lunch at noon?')
    const empty = await send(june, { channel: 'design-reviews-for-the-customer-portal' }, 'Anyone?')
    await clock.advance(ANSWER_AFTER_MS * 10)
    for (const asked of [toJune, empty])
      expect(world.records().notes.some((note) => note.inReplyTo === asked.id)).toBe(false)
  })
})

describe('a private question to a channel’s agent', () => {
  it('opens one conversation for the asker with the agent and the managers, and is answered as a review (rule 6)', async () => {
    const { june, clock, world } = started()
    const ana = memberNamed(world, 'Ana Silva')
    const room = await succeeded(june.api['channels.askPrivately']({ params: { slug: 'billing' } }))
    expect(room).toMatchObject({ kind: 'group', privateQuestionOf: 'billing' })
    expect(new Set(room.participantIds)).toEqual(
      new Set([VISITOR_ID, ana, world.records().channels.find((each) => each.slug === 'billing')!.agentId]),
    )
    expect((await succeeded(june.api['channels.askPrivately']({ params: { slug: 'billing' } }))).id).toBe(
      room.id,
    )
    expect(
      (await succeeded(june.api['conversations.list']({}))).conversations.map((each) => each.id),
    ).toContain(room.id)
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(await refused(kai.api['conversations.get']({ params: { id: room.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    const asked = await send(june, { conversationId: room.id }, 'Can I see last month’s refunds?')
    await clock.advance(ANSWER_AFTER_MS)
    const draft = world.records().notes.find((note) => note.inReplyTo === asked.id)!
    const asAna = demoApi(ana, world)
    const review = (await succeeded(asAna.api['reviews.list']({}))).reviews.find(
      (each) => each.note.id === draft.id,
    )
    expect(review?.privately).toBe(true)
    await clock.advance(APPROVAL_AFTER_MS)
    expect(world.records().notes.find((note) => note.id === draft.id)).toMatchObject({
      status: 'sent',
      approvedBy: ana,
    })
  })

  it('shows the visitor Ben’s private question to review, marked as asked privately', async () => {
    const { june } = started()
    const reviews = (await succeeded(june.api['reviews.list']({}))).reviews
    expect(reviews.find((review) => review.privately)?.question?.body).toMatch(
      /^A customer was charged twice/,
    )
  })

  it('refuses a channel without an agent, and a private channel the asker is not in', async () => {
    const { june } = started()
    expect(await refused(june.api['channels.askPrivately']({ params: { slug: 'deploys' } }))).toMatchObject({
      _tag: 'Conflict',
    })
    expect(await refused(june.api['channels.askPrivately']({ params: { slug: 'payroll' } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })
})

const started = () => {
  const clock = makeTestClock(NOW)
  const june = demoApi(VISITOR_ID, createWorld(clock))
  return { june, clock, world: june.world }
}

/** Drafts a note as this member and sends it, as their click would. */
const send = async (
  as: ReturnType<typeof demoApi>,
  where: { conversationId?: ConversationId; to?: MemberId[]; channel?: string },
  body: string,
) => {
  const conversationId =
    where.to === undefined
      ? where.conversationId
      : (await succeeded(as.api['conversations.create']({ body: { participantIds: where.to } }))).id
  const draft = await succeeded(
    as.api['drafts.create']({
      body: {
        body,
        ...(conversationId !== undefined && { conversationId }),
        ...(where.channel !== undefined && { channel: where.channel }),
      },
    }),
  )
  return succeeded(
    as.api['drafts.send']({
      params: { id: draft.id },
      body: { expected: { body: draft.body, conversationId: draft.conversationId } },
    }),
  )
}

const receiptOf = (world: ReturnType<typeof demoApi>['world'], noteId: string, memberId: MemberId) =>
  world
    .records()
    .notes.find((note) => note.id === noteId)
    ?.receipts.find((receipt) => receipt.memberId === memberId)
