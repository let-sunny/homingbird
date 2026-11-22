import { makeTestClock } from '@homingbird/kernel'
import { CredentialId, DEFAULT_DEBATE_LIMITS, DebateId, type MemberId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { DEBATE_JOIN_AFTER_MS, DEBATE_TURN_AFTER_MS } from '../src/debate-script.ts'
import { VISITOR_ID } from '../src/team.ts'
import { createWorld } from '../src/world.ts'
import { NOW, demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

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

  it('exports a room as Markdown or JSON, and says when there is no such room', async () => {
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
        agents: expect.arrayContaining([{ agent: "June's laptop", person: 'June Park' }]),
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

describe('opening a room and taking part', () => {
  it('opens a room for the visitor and the people invited, which a colleague’s agent joins, then debates and closes once the visitor opts in', async () => {
    const { api, world, clock } = started()
    const kai = memberNamed(world, 'Kai Lin')
    const room = await succeeded(
      api['debates.create']({
        body: {
          question: '  Should we move the release train to Wednesdays?  ',
          visibility: 'private',
          memberIds: [kai],
        },
      }),
    )
    expect(room).toMatchObject({
      question: 'Should we move the release train to Wednesdays?',
      visibility: 'private',
      status: 'open',
      createdBy: VISITOR_ID,
      memberIds: [VISITOR_ID, kai],
      participants: [],
      deadlineAt: NOW + DEFAULT_DEBATE_LIMITS.minutes * 60_000,
    })
    expect((await succeeded(api['debates.list']({}))).debates[0]?.id).toBe(room.id)
    await clock.advance(DEBATE_JOIN_AFTER_MS)
    expect(roomNow(world, room.id).participants.map((each) => [each.memberId, each.agentName])).toEqual([
      [kai, "Kai's laptop"],
    ])
    const joined = await succeeded(
      api['debates.optIn']({ params: { id: room.id }, body: { agentId: JUNE_LAPTOP } }),
    )
    expect(joined.participants.at(-1)).toMatchObject({
      memberId: VISITOR_ID,
      agentId: JUNE_LAPTOP,
      agentName: "June's laptop",
    })
    await clock.advance(DEBATE_TURN_AFTER_MS)
    expect(roomNow(world, room.id).turns.map((turn) => turn.memberId)).toEqual([kai])
    await clock.advance(DEBATE_TURN_AFTER_MS * 3)
    expect(roomNow(world, room.id).turns.map((turn) => turn.memberId)).toEqual([
      kai,
      VISITOR_ID,
      kai,
      VISITOR_ID,
    ])
    expect(roomNow(world, room.id).status).toBe('open')
    await clock.advance(DEBATE_TURN_AFTER_MS)
    const closed = await succeeded(api['debates.get']({ params: { id: room.id } }))
    expect(closed).toMatchObject({ status: 'closed', resultRound: 1, result: { draftedBy: VISITOR_ID } })
    expect(closed.result?.result).toMatchObject({
      kind: 'conclusion',
      contributions: [{ memberId: kai }, { memberId: VISITOR_ID }],
    })
    expect(world.eventsAfter(kai, 0).map((event) => event.body.type)).toContain('debate.changed')
    const draft = await succeeded(
      api['debates.result.post']({ params: { id: room.id }, body: { channel: 'deploys' } }),
    )
    expect(draft).toMatchObject({ authorId: VISITOR_ID, status: 'draft' })
  })

  it('lets the visitor opt into the private room Ana’s agent waits in, which then debates', async () => {
    const { api, world, clock } = started()
    const waiting = world
      .records()
      .debates.find((debate) => debate.status === 'open' && debate.turns.length === 0)!
    await succeeded(api['debates.optIn']({ params: { id: waiting.id }, body: { agentId: JUNE_LAPTOP } }))
    await clock.advance(DEBATE_TURN_AFTER_MS * 5)
    expect(roomNow(world, waiting.id).status).toBe('closed')
    expect(roomNow(world, waiting.id).turns[0]?.memberId).toBe(memberNamed(world, 'Ana Silva'))
  })

  it('has Ana’s agent join an open room nobody was invited to, and keeps to the limits the visitor set', async () => {
    const { api, world, clock } = started()
    const room = await succeeded(api['debates.create']({ body: { question: 'Tabs or spaces?' } }))
    const limits = { ...DEFAULT_DEBATE_LIMITS, turnsPerAgent: 1, totalTurns: 2 }
    expect(
      await succeeded(api['debates.limits.set']({ params: { id: room.id }, body: limits })),
    ).toMatchObject({ limits })
    await succeeded(api['debates.optIn']({ params: { id: room.id }, body: { agentId: JUNE_LAPTOP } }))
    await clock.advance(DEBATE_JOIN_AFTER_MS + DEBATE_TURN_AFTER_MS * 2)
    expect(roomNow(world, room.id).turns.map((turn) => turn.memberId)).toEqual([
      VISITOR_ID,
      memberNamed(world, 'Ana Silva'),
    ])
    await clock.advance(DEBATE_TURN_AFTER_MS)
    expect(roomNow(world, room.id).status).toBe('closed')
    expect(await refused(api['debates.limits.set']({ params: { id: room.id }, body: limits }))).toMatchObject(
      { _tag: 'Conflict' },
    )
  })

  it('waits in a private room nobody else was invited to', async () => {
    const { api, world, clock } = started()
    const room = await succeeded(
      api['debates.create']({ body: { question: 'Alone?', visibility: 'private' } }),
    )
    await succeeded(api['debates.optIn']({ params: { id: room.id }, body: { agentId: JUNE_LAPTOP } }))
    await clock.advance(DEBATE_JOIN_AFTER_MS + DEBATE_TURN_AFTER_MS * 10)
    expect(roomNow(world, room.id)).toMatchObject({ status: 'open', turns: [] })
  })

  it('refuses an empty question, limits that do not fit, another person’s agent, a second opt-in, and limits from someone else', async () => {
    const { api, world } = started()
    expect(await refused(api['debates.create']({ body: { question: '   ' } }))).toMatchObject({
      _tag: 'Invalid',
    })
    const unfit = { ...DEFAULT_DEBATE_LIMITS, turnsPerAgent: 5, totalTurns: 2 }
    expect(await refused(api['debates.create']({ body: { question: 'Now?', limits: unfit } }))).toMatchObject(
      { _tag: 'Invalid' },
    )
    const [open, closed] = world.records().debates
    expect(
      await refused(
        api['debates.optIn']({
          params: { id: open!.id },
          body: { agentId: CredentialId.of('demobillhelp') },
        }),
      ),
    ).toMatchObject({ _tag: 'NotFound' })
    expect(
      await refused(api['debates.optIn']({ params: { id: open!.id }, body: { agentId: JUNE_LAPTOP } })),
    ).toMatchObject({ _tag: 'Conflict', message: 'Your agent already takes part in this room.' })
    expect(
      await refused(api['debates.optIn']({ params: { id: closed!.id }, body: { agentId: JUNE_LAPTOP } })),
    ).toMatchObject({ _tag: 'Conflict' })
    expect(
      await refused(api['debates.limits.set']({ params: { id: open!.id }, body: DEFAULT_DEBATE_LIMITS })),
    ).toMatchObject({ _tag: 'Forbidden' })
    const room = await succeeded(api['debates.create']({ body: { question: 'Later?' } }))
    expect(await refused(api['debates.limits.set']({ params: { id: room.id }, body: unfit }))).toMatchObject({
      _tag: 'Invalid',
    })
  })
})

const JUNE_LAPTOP = CredentialId.of('demojunelapt')

const started = () => {
  const clock = makeTestClock(NOW)
  return { ...demoApi(VISITOR_ID, createWorld(clock)), clock }
}

const roomNow = (world: ReturnType<typeof demoApi>['world'], id: string) =>
  world.records().debates.find((debate) => debate.id === id)!

const asAna = (world: ReturnType<typeof demoApi>['world']) => demoApi(memberNamed(world, 'Ana Silva'), world)
