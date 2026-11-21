import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/channels.ts'
import { fail, testApp } from '../support/app.ts'
import { BEN, ROOM, TEAM, channel, conversation, group, note } from '../support/fixtures.ts'

const answers = {
  'channels.list': () => ({ channels: [channel('billing')], hasMore: false, cursor: null }),
  'conversations.list': () => ({ conversations: [] }),
  'directory.list': () => ({ entries: [] }),
  'contacts.list': () => ({ contacts: [] }),
  'channels.create': () => channel('ops'),
  'channels.members.list': () => ({ members: [{ memberId: BEN, manager: true, answering: false }] }),
  'drafts.create': () => note('d1', { conversationId: ROOM }),
  'drafts.send': () => note('d1'),
  'groups.list': () => ({ groups: [group(TEAM)] }),
  'channels.managers.addTeam': () => channel('billing'),
}

describe('channel tasks', () => {
  it('loads a page of channels for a query and a cursor', async () => {
    const { run, sent } = testApp(answers)
    await run(tasks.loadChannelPage('', null))
    await run(tasks.loadChannelPage('bill', 'next'))
    expect(sent.map((one) => one.request)).toEqual([
      { query: { limit: '20' } },
      { query: { limit: '20', q: 'bill', cursor: 'next' } },
    ])
  })

  it('opens a channel and keeps it in the known list after the reload', async () => {
    const { run, state, sent } = testApp(answers)
    expect(await run(tasks.createChannel('ops', 'Operations', 'open'))).toEqual({
      _tag: 'Ok',
      value: channel('ops'),
    })
    expect(state.channels.get().map((one) => one.slug)).toEqual(['billing', 'ops'])
    expect(state.groups.get()).toEqual([group(TEAM)])
    await run(tasks.createChannel('ops', 'Operations', 'private'))
    expect(sent.filter((one) => one.route === 'channels.create').map((one) => one.request)).toEqual([
      { body: { slug: 'ops', description: 'Operations', visibility: 'open' } },
      { body: { slug: 'ops', description: 'Operations', visibility: 'private' } },
    ])
  })

  it('joins, leaves, answers and manages members, each reloading the lists', async () => {
    const { run, routes } = testApp(answers)
    await run(tasks.joinChannel('billing', true))
    await run(tasks.leaveChannel('billing'))
    await run(tasks.setAnswering('billing', true))
    await run(tasks.setAnswering('billing', false))
    await run(tasks.setChannelMember('billing', BEN, true))
    await run(tasks.setChannelMember('billing', BEN, false))
    await run(tasks.reviseChannel('billing', { description: 'Money' }))
    await run(tasks.archiveChannel('billing', null))
    await run(tasks.archiveChannel('billing', 'ops'))
    const changes = routes().filter(
      (route) => !['channels.list', 'conversations.list', 'directory.list', 'contacts.list'].includes(route),
    )
    expect(changes).toEqual([
      'channels.join',
      'channels.leave',
      'channels.answering.on',
      'channels.answering.off',
      'channels.members.add',
      'channels.members.remove',
      'admin.channels.update',
      'admin.channels.archive',
      'admin.channels.archive',
    ])
  })

  it('adds a team’s people to a channel’s managers, then reloads the channels and the groups', async () => {
    const { run, sent, routes } = testApp(answers)
    await run(tasks.addTeam('billing', TEAM))
    expect(sent[0]).toEqual({
      route: 'channels.managers.addTeam',
      request: { params: { slug: 'billing' }, body: { groupId: TEAM } },
    })
    expect(routes()).toContain('groups.list')
    expect(routes()).toContain('channels.list')
  })

  it('remembers a managed channel’s roster', async () => {
    const { run, state } = testApp(answers)
    await run(tasks.loadChannelMembers('billing'))
    expect(state.rosters.get().get('billing')).toEqual({
      memberCount: 1,
      members: [{ memberId: BEN, manager: true, answering: false }],
    })
  })

  it('asks a channel and enters its room', async () => {
    const { run, page, sent } = testApp(answers)
    expect(await run(tasks.askChannel('billing', 'When?'))).toEqual({ _tag: 'Ok', value: ROOM })
    expect(sent.find((one) => one.route === 'drafts.send')!.request).toEqual({
      params: { id: 'd1' },
      body: { expected: { body: 'When?', conversationId: ROOM } },
    })
    await run(tasks.enterRoom(ROOM))
    expect(page.visited).toEqual([`go #/c/${ROOM}`])
  })

  it('opens a channel and takes the next step, keeping the channel when the step fails', async () => {
    const { run } = testApp(answers)
    const moved = await run(
      tasks.createChannelThen({ slug: 'ops', description: 'Ops' }, () =>
        run.length > 0 ? tasks.leaveChannel('ops') : tasks.leaveChannel('ops'),
      ),
    )
    expect(moved).toEqual({ _tag: 'Ok', value: { created: channel('ops'), failure: null } })
    const failing = testApp({
      ...answers,
      'channels.leave': () => fail({ _tag: 'Forbidden', message: 'no' }),
    })
    const outcome = await failing.run(
      tasks.createChannelThen({ slug: 'ops', description: 'Ops' }, (slug) => tasks.leaveChannel(slug)),
    )
    expect(outcome).toEqual({
      _tag: 'Ok',
      value: { created: channel('ops'), failure: { _tag: 'Forbidden', message: 'no' } },
    })
    expect(conversation().id).toBe(ROOM)
  })
})
