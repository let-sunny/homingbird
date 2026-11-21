import { type ConversationId, DRAFT_CHANGED } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

const asShown = (note: { readonly body: string; readonly conversationId: ConversationId }) => ({
  body: note.body,
  conversationId: note.conversationId,
})

describe('drafts.send', () => {
  it('sends the visitor’s draft as read, delivers it to the colleague, and tells both streams', async () => {
    const { api, world } = demoApi()
    const ana = memberNamed(world, 'Ana Silva')
    const draft = noteStarting(world, 'Yes. I checked')
    const sent = await succeeded(
      api['drafts.send']({ params: { id: draft.id }, body: { expected: asShown(draft) } }),
    )
    expect(sent).toMatchObject({ status: 'sent', origin: 'agent', approvedBy: null })
    expect(sent.receipts).toEqual([expect.objectContaining({ memberId: ana, state: 'delivered' })])
    const question = noteStarting(world, 'Is the billing migration safe')
    expect(question.receipts.find((receipt) => receipt.memberId === sent.authorId)?.state).toBe('replied')
    expect(world.eventsAfter(ana, 0).map((event) => event.body.type)).toEqual(['note.sent', 'note.status'])
    const asAna = demoApi(ana, world)
    expect((await succeeded(asAna.api['notes.get']({ params: { id: draft.id } }))).status).toBe('sent')
  })

  it('records an edit made at sending, and refuses a draft that changed since the person read it', async () => {
    const { api, world } = demoApi()
    const draft = noteStarting(world, 'Yes. I checked')
    const stale = await refused(
      api['drafts.send']({
        params: { id: draft.id },
        body: { expected: { ...asShown(draft), body: 'older text' } },
      }),
    )
    expect(stale).toEqual({ _tag: 'Conflict', message: DRAFT_CHANGED })
    const sent = await succeeded(
      api['drafts.send']({
        params: { id: draft.id },
        body: { body: 'Yes, after the export.', expected: asShown(draft) },
      }),
    )
    expect(sent).toMatchObject({ body: 'Yes, after the export.', origin: 'human_edited' })
    expect(
      await refused(api['drafts.send']({ params: { id: draft.id }, body: { expected: asShown(sent) } })),
    ).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('sends a channel’s agent’s answer for a manager, records who approved it, and delivers it to the asker only', async () => {
    const { api, world, viewerId } = demoApi()
    const ben = memberNamed(world, 'Ben Okafor')
    const ana = memberNamed(world, 'Ana Silva')
    const answer = noteStarting(world, 'Annual plans are refunded')
    const sent = await succeeded(
      api['drafts.send']({ params: { id: answer.id }, body: { expected: asShown(answer) } }),
    )
    expect(sent).toMatchObject({ status: 'sent', approvedBy: viewerId, authorId: answer.authorId })
    expect(sent.receipts.map((receipt) => receipt.memberId)).toEqual([ben])
    expect(world.eventsAfter(ana, 0).map((event) => event.body.type)).toContain('review.changed')
    expect((await succeeded(api['reviews.list']({}))).reviews).toEqual([])
  })

  it('finds no draft for anyone but its author or a reviewer, so no one else can send or discard it (rule 1)', async () => {
    const { world } = demoApi()
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    const ana = demoApi(memberNamed(world, 'Ana Silva'), world)
    const reply = noteStarting(world, 'Yes. I checked')
    const answer = noteStarting(world, 'Annual plans are refunded')
    expect(
      await refused(ana.api['drafts.send']({ params: { id: reply.id }, body: { expected: asShown(reply) } })),
    ).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(ana.api['notes.get']({ params: { id: reply.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(kai.api['drafts.discard']({ params: { id: answer.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(kai.api['drafts.seen']({ params: { id: answer.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })
})

describe('drafts.discard', () => {
  it('discards the visitor’s draft and tells their stream, and a reviewed answer tells the reviewers', async () => {
    const { api, world, viewerId } = demoApi()
    const reply = noteStarting(world, 'Yes. I checked')
    const answer = noteStarting(world, 'Annual plans are refunded')
    expect((await succeeded(api['drafts.discard']({ params: { id: reply.id } }))).status).toBe('discarded')
    expect((await succeeded(api['drafts.list']({}))).drafts).toEqual([])
    await succeeded(api['drafts.discard']({ params: { id: answer.id } }))
    expect(world.eventsAfter(viewerId, 0).map((event) => event.body.type)).toEqual([
      'draft.discarded',
      'review.changed',
    ])
    expect(await succeeded(api['drafts.seen']({ params: { id: reply.id } })).catch(() => 'gone')).toBe('gone')
  })
})

describe('drafts.create and drafts.update', () => {
  it('writes a note to a colleague in a new conversation, and sends it when the person approves', async () => {
    const { api, world, viewerId } = demoApi()
    const ben = memberNamed(world, 'Ben Okafor')
    const kai = memberNamed(world, 'Kai Lin')
    const room = await succeeded(
      api['conversations.create']({ body: { participantIds: [ben, kai], title: 'Refunds' } }),
    )
    expect(room).toMatchObject({ kind: 'group', title: 'Refunds', participantIds: [viewerId, ben, kai] })
    const again = await succeeded(api['conversations.create']({ body: { participantIds: [ben, kai] } }))
    expect(again.id).toBe(room.id)
    const listed = await succeeded(api['conversations.list']({}))
    expect(listed.conversations.some((one) => one.id === room.id)).toBe(true)
    const asBen = await succeeded(demoApi(ben, world).api['conversations.list']({}))
    expect(asBen.conversations.some((one) => one.id === room.id)).toBe(false)
    const draft = await succeeded(api['drafts.create']({ body: { body: 'Lunch?', conversationId: room.id } }))
    expect(draft).toMatchObject({ status: 'draft', origin: 'human' })
    const sent = await succeeded(
      api['drafts.send']({ params: { id: draft.id }, body: { expected: asShown(draft) } }),
    )
    expect(sent.receipts.map((receipt) => receipt.memberId)).toEqual([ben, kai])
  })

  it('asks a channel’s answerers a question written in its room, and refuses a draft with no destination', async () => {
    const { api, world } = demoApi()
    const asked = await succeeded(
      api['drafts.create']({ body: { body: 'Who owns the ledger?', channel: 'billing' } }),
    )
    const sent = await succeeded(
      api['drafts.send']({ params: { id: asked.id }, body: { expected: asShown(asked) } }),
    )
    expect(sent.receipts.map((receipt) => receipt.memberId)).toEqual([memberNamed(world, 'Ana Silva')])
    expect(await refused(api['drafts.create']({ body: { body: 'Hello' } }))).toMatchObject({
      _tag: 'Invalid',
    })
    expect(
      await refused(api['drafts.create']({ body: { body: 'Hello', channel: 'nowhere' } })),
    ).toMatchObject({
      _tag: 'Invalid',
    })
  })

  it('marks an agent’s draft the person rewrote as edited, and keeps a draft in its conversation', async () => {
    const { api, world } = demoApi()
    const draft = noteStarting(world, 'Yes. I checked')
    const saved = await succeeded(
      api['drafts.update']({ params: { id: draft.id }, body: { body: 'Yes, at 02:30.' } }),
    )
    expect(saved).toMatchObject({ body: 'Yes, at 02:30.', origin: 'human_edited' })
    expect(
      await refused(api['drafts.update']({ params: { id: draft.id }, body: { channel: 'billing' } })),
    ).toMatchObject({
      _tag: 'Forbidden',
    })
  })
})

describe('reading', () => {
  it('marks a note read once, and tells the room the new receipts', async () => {
    const { api, world, viewerId } = demoApi()
    const heads = noteStarting(world, 'Heads up')
    const unread = async () =>
      (await succeeded(api['conversations.list']({}))).conversations.find(
        (room) => room.id === heads.conversationId,
      )?.unreadCount
    const before = await unread()
    const read = await succeeded(api['notes.read']({ params: { id: heads.id } }))
    expect(read.receipts.find((receipt) => receipt.memberId === viewerId)).toMatchObject({ state: 'read' })
    await succeeded(api['notes.read']({ params: { id: heads.id } }))
    expect(world.eventsAfter(viewerId, 0).map((event) => event.body.type)).toEqual(['note.status'])
    expect(await unread()).toBe(before! - 1)
  })

  it('reads a conversation it takes part in, page by page, and no other', async () => {
    const { api, world } = demoApi()
    const question = noteStarting(world, 'Is the billing migration safe')
    const all = await succeeded(
      api['conversations.notes']({ params: { id: question.conversationId }, query: {} }),
    )
    expect(all.notes.map((note) => note.status)).toEqual(['sent', 'sent', 'sent', 'draft'])
    const older = await succeeded(
      api['conversations.notes']({
        params: { id: question.conversationId },
        query: { before: String(question.sentAt) },
      }),
    )
    expect(older.notes).toHaveLength(2)
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    expect(
      await refused(ben.api['conversations.notes']({ params: { id: question.conversationId }, query: {} })),
    ).toMatchObject({
      _tag: 'NotFound',
    })
    expect(
      (await succeeded(api['conversations.get']({ params: { id: question.conversationId } }))).draftCount,
    ).toBe(1)
  })

  it('mutes and unmutes a conversation for the viewer alone', async () => {
    const { api, world } = demoApi()
    const room = noteStarting(world, 'Heads up').conversationId
    expect((await succeeded(api['conversations.mute']({ params: { id: room } }))).muted).toBe(true)
    expect((await succeeded(api['conversations.mute']({ params: { id: room } }))).muted).toBe(true)
    expect((await succeeded(api['conversations.unmute']({ params: { id: room } }))).muted).toBe(false)
  })

  it('searches the notes the viewer may read, their own drafts included, and nobody else’s', async () => {
    const { api, world } = demoApi()
    const found = await succeeded(api['search.notes']({ query: { q: 'lock ordering' } }))
    expect(found.notes.map((note) => note.status)).toEqual(['draft'])
    const ana = demoApi(memberNamed(world, 'Ana Silva'), world)
    expect((await succeeded(ana.api['search.notes']({ query: { q: 'lock ordering' } }))).notes).toEqual([])
    expect((await succeeded(api['search.notes']({ query: { q: 'REFUND', limit: '1' } }))).notes).toHaveLength(
      1,
    )
  })
})
