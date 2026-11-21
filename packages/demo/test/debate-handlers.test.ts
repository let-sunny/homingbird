import { DebateId, type MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEMO_REFUSAL } from '../src/handlers.ts'
import { demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('debate rooms', () => {
  it('lists the rooms a member may enter, and whether their agent takes part', async () => {
    const { api, world } = demoApi()
    const { debates } = await succeeded(api['debates.list']({}))
    expect(debates.map((room) => [room.status, room.joined, room.turnCount, room.resultDrafted])).toEqual([
      ['open', true, 2, false],
      ['closed', true, 2, true],
    ])
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    expect((await succeeded(ben.api['debates.list']({}))).debates.map((room) => room.joined)).toEqual([
      false,
      false,
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
