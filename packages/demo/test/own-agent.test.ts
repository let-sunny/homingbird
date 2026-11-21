import { makeTestClock } from '@homingbird/kernel'
import { CredentialId, type DraftRequestId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { OWN_AGENT_AFTER_MS, openDraftRequests } from '../src/own-agent.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

const started = () => {
  const clock = makeTestClock(NOW)
  const june = demoApi(VISITOR_ID, createWorld(clock))
  return { ...june, clock }
}

describe('requestDraft', () => {
  it('has the visitor’s agent draft a reply to the note it was asked about, and forgets that it skipped it', async () => {
    const { api, world, clock } = started()
    const skipped = noteStarting(world, 'Heads up: the deploy window')
    const request = await succeeded(
      api['draftRequests.create']({ body: { inReplyTo: skipped.id, instruction: 'Say yes, after 16:00.' } }),
    )
    expect(request).toMatchObject({
      conversationId: skipped.conversationId,
      inReplyTo: skipped.id,
      instruction: 'Say yes, after 16:00.',
      draftIds: [],
    })
    expect(world.records().notices.some((kept) => kept.notice.noteId === skipped.id)).toBe(false)
    expect(world.eventsAfter(VISITOR_ID, 0).map((event) => event.body)).toContainEqual({
      type: 'draft.requested',
      request,
    })
    await clock.advance(OWN_AGENT_AFTER_MS)
    const draft = world.records().notes.find((note) => note.inReplyTo === skipped.id)!
    expect(draft).toMatchObject({
      authorId: VISITOR_ID,
      status: 'draft',
      origin: 'agent',
      agentName: "June's laptop",
      basis: 'What you asked for, and this conversation.',
    })
    const [listed] = (await succeeded(api['draftRequests.list']({}))).requests
    expect(listed?.draftIds).toEqual([draft.id])
    expect(world.eventsAfter(VISITOR_ID, 0).at(-1)?.body).toMatchObject({ type: 'draft.request.changed' })
  })

  it('drafts a new note for a conversation, and hides the request from everyone else', async () => {
    const { api, world, clock } = started()
    const kai = memberNamed(world, 'Kai Lin')
    const request = await succeeded(api['draftRequests.create']({ body: { to: [kai] } }))
    await clock.advance(OWN_AGENT_AFTER_MS)
    const draft = world
      .records()
      .notes.find((note) => note.id === world.records().draftRequests[0]?.request.draftIds[0])
    expect(draft).toMatchObject({
      conversationId: request.conversationId,
      inReplyTo: null,
      basis: 'This conversation.',
    })
    expect(openDraftRequests(world.records(), kai, clock.now())).toEqual([])
  })

  it('writes nothing for a request withdrawn in time, and refuses to withdraw it twice', async () => {
    const { api, world, clock } = started()
    const room = noteStarting(world, 'Morning! Did the invoice').conversationId
    const request = await succeeded(api['draftRequests.create']({ body: { conversationId: room } }))
    const cancelled = await succeeded(api['draftRequests.cancel']({ params: { id: request.id } }))
    expect(cancelled.cancelledAt).toBe(clock.now())
    await clock.advance(OWN_AGENT_AFTER_MS)
    expect(world.records().draftRequests[0]?.request.draftIds).toEqual([])
    expect((await succeeded(api['draftRequests.list']({}))).requests).toEqual([])
    expect(await refused(api['draftRequests.cancel']({ params: { id: request.id } }))).toMatchObject({
      _tag: 'Conflict',
    })
    expect(
      await refused(api['draftRequests.cancel']({ params: { id: 'dreq_nothing0000' as DraftRequestId } })),
    ).toMatchObject({ _tag: 'NotFound' })
  })

  it('refuses another person’s agent, a note the visitor cannot read, and a request past its day', async () => {
    const { api, world, clock } = started()
    const room = noteStarting(world, 'Morning! Did the invoice').conversationId
    expect(
      await refused(
        api['draftRequests.create']({
          body: { conversationId: room, agentId: CredentialId.of('demobillhelp') },
        }),
      ),
    ).toMatchObject({ _tag: 'NotFound' })
    const hidden = noteStarting(world, 'Where do new support people')
    expect(await refused(api['draftRequests.create']({ body: { inReplyTo: hidden.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    const request = await succeeded(
      api['draftRequests.create']({
        body: { conversationId: room, agentId: CredentialId.of('demojunelapt') },
      }),
    )
    await clock.advance(24 * 60 * 60_000)
    expect((await succeeded(api['draftRequests.list']({}))).requests).toEqual([])
    expect(await refused(api['draftRequests.cancel']({ params: { id: request.id } }))).toMatchObject({
      _tag: 'Conflict',
    })
  })

  it('drafts nothing once the visitor’s agent is disconnected', async () => {
    const { api, world, clock } = started()
    const room = noteStarting(world, 'Morning! Did the invoice').conversationId
    await succeeded(api['draftRequests.create']({ body: { conversationId: room } }))
    world.update((records) => ({
      ...records,
      credentials: records.credentials.map((kept) =>
        kept.credential.kind === 'agent'
          ? { ...kept, credential: { ...kept.credential, revokedAt: NOW } }
          : kept,
      ),
    }))
    await clock.advance(OWN_AGENT_AFTER_MS)
    expect(world.records().draftRequests[0]?.request.draftIds).toEqual([])
  })
})
