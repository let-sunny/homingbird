import { describe, expect, it } from 'vitest'
import { demoApi, memberNamed, refused, succeeded } from './support/demo.ts'

describe('channels', () => {
  it('lists every open channel by name, and finds them by their words', async () => {
    const { api } = demoApi()
    const listed = await succeeded(api['channels.list']({ query: { limit: '200' } }))
    expect(listed.channels.map((channel) => channel.slug)).toEqual([
      'billing',
      'deploys',
      'design-reviews-for-the-customer-portal',
      'onboarding',
      'payroll',
    ])
    expect(listed).toMatchObject({ hasMore: false, cursor: null })
    const found = await succeeded(api['channels.list']({ query: { q: 'release' } }))
    expect(found.channels.map((channel) => channel.slug)).toEqual(['deploys'])
  })

  it('joins a channel and answers there, then stops answering and leaves it', async () => {
    const { api, world, viewerId } = demoApi()
    const joined = await succeeded(
      api['channels.join']({ params: { slug: 'onboarding' }, body: { answering: true } }),
    )
    expect(joined).toMatchObject({ joined: true, answering: true, memberCount: 4 })
    expect(
      (await succeeded(api['channels.answering.off']({ params: { slug: 'onboarding' } }))).answering,
    ).toBe(false)
    expect(
      (await succeeded(api['channels.answering.on']({ params: { slug: 'onboarding' } }))).answering,
    ).toBe(true)
    const left = await succeeded(api['channels.leave']({ params: { slug: 'onboarding' } }))
    expect(left).toMatchObject({ joined: false, answering: false })
    expect(world.eventsAfter(viewerId, 0).map((event) => event.body.type)).toEqual([
      'channel.changed',
      'channel.changed',
      'channel.changed',
      'channel.left',
    ])
  })

  it('keeps a manager in the channel until they leave its managing group', async () => {
    const { api } = demoApi()
    expect(await refused(api['channels.leave']({ params: { slug: 'billing' } }))).toMatchObject({
      _tag: 'Conflict',
    })
  })

  it('opens a new channel with the person who opened it as its manager, and no second one by that name', async () => {
    const { api, viewerId } = demoApi()
    const created = await succeeded(
      api['channels.create']({
        body: { slug: 'design', description: 'Screens and words.', visibility: 'private' },
      }),
    )
    expect(created).toMatchObject({
      slug: 'design',
      joined: true,
      managing: true,
      visibility: 'private',
      agent: null,
    })
    const room = await succeeded(api['conversations.get']({ params: { id: created.conversationId } }))
    expect(room).toMatchObject({ kind: 'channel', title: 'design', participantIds: [viewerId] })
    expect(
      await refused(api['channels.create']({ body: { slug: 'design', description: 'Again.' } })),
    ).toMatchObject({ _tag: 'Conflict' })
  })

  it('hides a private channel from the people outside its room, but not that it exists from an administrator', async () => {
    const { api, world } = demoApi()
    await succeeded(
      api['channels.create']({ body: { slug: 'salaries', description: 'Pay.', visibility: 'private' } }),
    )
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(
      (await succeeded(kai.api['channels.list']({ query: {} }))).channels.map((channel) => channel.slug),
    ).not.toContain('salaries')
    expect(await refused(kai.api['channels.get']({ params: { slug: 'salaries' } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('lists the people in a channel, who answers and who manages, never its agent', async () => {
    const { api, world, viewerId } = demoApi()
    const { members } = await succeeded(api['channels.members.list']({ params: { slug: 'billing' } }))
    expect(members).toHaveLength(4)
    expect(members.find((member) => member.memberId === viewerId)).toEqual({
      memberId: viewerId,
      answering: true,
      manager: true,
    })
    expect(members.find((member) => member.memberId === memberNamed(world, 'Kai Lin'))?.manager).toBe(false)
  })
})

describe('a channel’s agent', () => {
  it('shows the agent, its credentials and how it is doing to its channel’s managers only (rule 6)', async () => {
    const { api, world } = demoApi()
    const agent = await succeeded(api['channels.agent.get']({ params: { slug: 'billing' } }))
    expect(agent.agent).toMatchObject({ name: 'Billing helper', kind: 'channel_agent' })
    expect(agent.credentials).toEqual([
      expect.objectContaining({ issuedBy: memberNamed(world, 'Ana Silva') }),
    ])
    const figures = await succeeded(api['channels.agent.figures']({ params: { slug: 'billing' } }))
    expect(figures).toMatchObject({ channel: 'billing', waiting: 1 })
    const kai = demoApi(memberNamed(world, 'Kai Lin'), world)
    expect(await refused(kai.api['channels.agent.get']({ params: { slug: 'billing' } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(kai.api['channels.agent.figures']({ params: { slug: 'billing' } }))).toMatchObject({
      _tag: 'NotFound',
    })
    expect(await refused(api['channels.agent.get']({ params: { slug: 'onboarding' } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('says a channel it manages has no agent when it has none', async () => {
    const { api } = demoApi()
    await succeeded(api['channels.create']({ body: { slug: 'design', description: 'Screens.' } }))
    expect(await refused(api['channels.agent.get']({ params: { slug: 'design' } }))).toMatchObject({
      message: 'This channel has no agent.',
    })
    expect(await refused(api['channels.agent.figures']({ params: { slug: 'design' } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('reads one answer waiting for the manager, and none for anyone else', async () => {
    const { api, world } = demoApi()
    const [review] = (await succeeded(api['reviews.list']({}))).reviews
    expect(await succeeded(api['reviews.get']({ params: { id: review!.note.id } }))).toEqual(review)
    const ben = demoApi(memberNamed(world, 'Ben Okafor'), world)
    expect((await succeeded(ben.api['reviews.list']({}))).reviews).toEqual([])
    expect(await refused(ben.api['reviews.get']({ params: { id: review!.note.id } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })
})

describe('groups', () => {
  it('lists the teams and managing groups, and reads one', async () => {
    const { api } = demoApi()
    const { groups } = await succeeded(api['groups.list']({}))
    expect(groups.map((group) => group.name ?? group.channels[0])).toEqual([
      'design-reviews-for-the-customer-portal',
      'payroll',
      'billing',
      'deploys',
      'onboarding',
      'Platform',
      'Customer',
      'Security, Privacy, Compliance and Vendor Risk Management',
    ])
    expect(await succeeded(api['groups.get']({ params: { id: groups[5]!.id } }))).toEqual(groups[5])
    expect(await refused(api['groups.get']({ params: { id: 'grp_demonothing0' } }))).toMatchObject({
      _tag: 'NotFound',
    })
  })

  it('lets a manager add a person to the group that manages their channel, and keeps at least one', async () => {
    const { api, world } = demoApi()
    const billing = (await succeeded(api['groups.list']({}))).groups.find((group) =>
      group.channels.includes('billing'),
    )!
    const kai = memberNamed(world, 'Kai Lin')
    const agent = world.records().channels.find((channel) => channel.agentId !== null)!.agentId!
    const changed = await succeeded(
      api['groups.members.set']({
        params: { id: billing.id },
        body: { memberIds: [...billing.memberIds, kai, agent] },
      }),
    )
    expect(changed.memberIds).toEqual([...billing.memberIds, kai])
    expect(world.eventsAfter(kai, 0).map((event) => event.body.type)).toEqual(['group.changed'])
    expect(
      await refused(api['groups.members.set']({ params: { id: billing.id }, body: { memberIds: [agent] } })),
    ).toMatchObject({ _tag: 'Conflict' })
  })

  it('lets the administrator rename a team and change its members, even to nobody', async () => {
    const { api, world } = demoApi()
    const kai = memberNamed(world, 'Kai Lin')
    const groups = (await succeeded(api['groups.list']({}))).groups
    const [team, other] = groups.filter((group) => group.kind === 'team')
    const billing = groups.find((group) => group.channels.includes('billing'))!
    expect(
      await succeeded(api['groups.members.set']({ params: { id: team!.id }, body: { memberIds: [kai] } })),
    ).toMatchObject({ memberIds: [kai] })
    expect(
      await succeeded(api['groups.members.set']({ params: { id: team!.id }, body: { memberIds: [] } })),
    ).toMatchObject({ memberIds: [] })
    expect(
      await succeeded(api['groups.rename']({ params: { id: team!.id }, body: { name: 'Money' } })),
    ).toMatchObject({ name: 'Money' })
    expect(
      await refused(api['groups.rename']({ params: { id: team!.id }, body: { name: other!.name! } })),
    ).toMatchObject({ _tag: 'Conflict' })
    expect(
      await refused(api['groups.rename']({ params: { id: billing.id }, body: { name: 'Billing' } })),
    ).toMatchObject({ _tag: 'NotFound' })
  })
})
