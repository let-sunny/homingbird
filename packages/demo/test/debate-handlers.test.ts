import { DebateId, type MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEMO_REFUSAL } from '../src/handlers.ts'
import { demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('debate rooms', () => {
  it('lists the rooms a member may enter, a private one only to its members, and whether they were asked', async () => {
    const { api, world } = demoApi()
    const { debates } = await succeeded(api['debates.list']({}))
    expect(debates.map((room) => [room.status, room.joined, room.turnCount, room.resultDrafted])).toEqual([
      ['open', true, 2, false],
      ['closed', true, 12, true],
      ['open', true, 0, false],
    ])
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    expect((await succeeded(ben.api['debates.list']({}))).debates.map((room) => room.joined)).toEqual([
      false,
      true,
    ])
  })

  it('names a member’s own agent in a room to them only', async () => {
    const { api, world, viewerId } = demoApi()
    const [open] = world.records().debates
    const own = (participants: ReadonlyArray<{ memberId: MemberId; agentId: unknown }>) =>
      participants.find((participant) => participant.memberId === viewerId)?.agentId
    expect(
      own((await succeeded(api['debates.get']({ params: { id: open!.id } }))).participants),
    ).not.toBeNull()
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(
      own((await succeeded(kai.api['debates.get']({ params: { id: open!.id } }))).participants),
    ).toBeNull()
  })

  it('keeps a private room from the people it does not name', async () => {
    const { api, world } = demoApi()
    world.update((records) => ({
      ...records,
      debates: records.debates.map((room, index) =>
        index === 0 ? { ...room, visibility: 'private' } : room,
      ),
    }))
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    const [open] = world.records().debates
    expect(await refused(ben.api['debates.get']({ params: { id: open!.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect((await succeeded(api['debates.get']({ params: { id: open!.id } }))).visibility).toBe('private')
  })

  it('exports a room as Markdown or JSON, and leaves taking part in a room to a real server', async () => {
    const { api, world } = demoApi()
    const closed = world.records().debates[1]!
    const markdown = await succeeded(
      api['debates.export']({ params: { id: closed.id }, body: { format: 'markdown', language: 'ko' } }),
    )
    expect(markdown).toMatchObject({ mediaType: 'text/markdown', filename: 'debate-demodebate02.md' })
    expect(markdown.text).toContain('Ana Silva')
    const json = await succeeded(
      api['debates.export']({ params: { id: closed.id }, body: { format: 'json' } }),
    )
    expect(JSON.parse(json.text)).toMatchObject({ question: closed.question })
    expect(await succeeded(api['debates.waiting']({}))).toEqual({ asks: [] })
    expect(await refused(api['debates.get']({ params: { id: DebateId.of('demonothing0') } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(api['debates.create']({ body: { question: 'Lunch?' } }))).toEqual(DEMO_REFUSAL)
  })
})

describe('debates.result.post', () => {
  it('puts a closed room’s result into the visitor’s own draft in the chosen conversation, and tells their stream', async () => {
    const { api, world, viewerId } = demoApi()
    const closed = world.records().debates.find((debate) => debate.status === 'closed')!
    const ana = memberNamed(world, 'Ana Silva')
    const draft = await succeeded(
      api['debates.result.post']({ params: { id: closed.id }, body: { to: ana } }),
    )
    expect(draft).toMatchObject({
      authorId: viewerId,
      status: 'draft',
      origin: 'agent',
      agentName: null,
      basis: null,
      fromDebate: {
        debateId: closed.id,
        question: closed.question,
        agents: expect.arrayContaining([{ agent: "June's desk", person: 'June Park' }]),
      },
    })
    expect(draft.body).toContain('A refund for an annual plan covers the unused full months')
    const room = world.records().conversations.find((each) => each.id === draft.conversationId)
    expect(room?.kind).toBe('direct')
    expect(room?.participantIds).toContain(ana)
    expect((await succeeded(api['drafts.list']({}))).drafts.map((each) => each.id)).toContain(draft.id)
    expect(world.eventsAfter(viewerId, 0).map((event) => event.body)).toContainEqual({
      type: 'draft.saved',
      note: draft,
    })
    const inChannel = await succeeded(
      api['debates.result.post']({ params: { id: closed.id }, body: { channel: 'billing' } }),
    )
    expect(inChannel.conversationId).toBe(
      world.records().channels.find((channel) => channel.slug === 'billing')!.conversationId,
    )
    expect(await refused(asAna(world).api['notes.get']({ params: { id: draft.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('refuses an open room, two places at once, and a person whose agent took no turn', async () => {
    const { api, world } = demoApi()
    const [open, closed] = world.records().debates
    const kai = memberNamed(world, 'Kai Lin')
    expect(
      await refused(api['debates.result.post']({ params: { id: open!.id }, body: { to: kai } })),
    ).toMatchObject({ _tag: 'Conflict' })
    expect(
      await refused(
        api['debates.result.post']({ params: { id: closed!.id }, body: { to: kai, channel: 'billing' } }),
      ),
    ).toMatchObject({ _tag: 'Invalid' })
    const outsider = demoApi(memberNamed(world, 'Maximiliana Konstantinopoulou-Vanderbilt-Oyelaran'), world)
    expect(
      await refused(
        outsider.api['debates.result.post']({ params: { id: closed!.id }, body: { channel: 'billing' } }),
      ),
    ).toMatchObject({ _tag: 'Forbidden' })
  })
})

const asAna = (world: ReturnType<typeof demoApi>['world']) => demoApi(memberNamed(world, 'Ana Silva'), world)
