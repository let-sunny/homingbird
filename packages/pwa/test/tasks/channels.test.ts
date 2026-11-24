import { describe, expect, it } from 'vitest'
import { TOO_LONG_LOAD_SECONDS } from '../../src/load-timing.ts'
import * as tasks from '../../src/tasks/channels.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { BEN, ROOM, TEAM, channel, conversation, group, note } from '../support/fixtures.ts'

const answers = {
  'channels.list': () => ({ channels: [channel('billing')], hasMore: false, cursor: null }),
  'conversations.list': () => ({ conversations: [] }),
  'directory.list': () => ({ entries: [] }),
  'channels.create': () => channel('ops'),
  'channels.members.list': () => ({ members: [{ memberId: BEN, manager: true, answering: false }] }),
  'drafts.create': () => note('d1', { conversationId: ROOM }),
  'drafts.send': () => note('d1'),
  'groups.list': () => ({ groups: [group(TEAM)] }),
  'channels.managers.addTeam': () => channel('billing'),
}

describe('channel tasks', () => {
  it('opens the first page of the channel list afresh, then asks for what is typed and the page after', async () => {
    const { run, sent, state } = testApp(answers)
    state.channelPage.set({ query: 'old', channels: [channel('old')], hasMore: false, cursor: null })
    await run(tasks.openChannelPage)
    expect(state.channelPage.get()).toMatchObject({ query: '', channels: [{ slug: 'billing' }] })
    await run(tasks.loadChannelPage('bill', null))
    await run(tasks.reloadChannelPage)
    await settle()
    await run(tasks.loadChannelPage('bill', { ...state.channelPage.get(), cursor: 'next' }))
    await settle()
    await run(tasks.reloadChannelPage)
    await settle()
    expect(sent.map((one) => one.request)).toEqual([
      { query: { limit: '20' } },
      { query: { limit: '20', q: 'bill' } },
      { query: { limit: '20', q: 'bill' } },
      { query: { limit: '20', q: 'bill', cursor: 'next' } },
    ])
    expect(state.channelPage.get().channels).toHaveLength(2)
  })

  it.each([
    ['a search', 'bill', false],
    ['the next page', '', true],
  ] as const)(
    'tells through its load that %s is on its way, hangs or fails, though the list had come',
    async (_, query, isNext) => {
      const slow = hold<unknown>()
      let answer: unknown = { channels: [channel('a')], hasMore: true, cursor: 'next' }
      const { app, run, state, clock } = testApp({ 'channels.list': () => answer })
      await run(tasks.openChannelPage)
      const shown = state.channelPage.get()
      const load = () => state.channelPage.load.get()
      answer = slow.waiting
      app.launch(tasks.loadChannelPage(query, isNext ? shown : null))
      await settle()
      expect(load()).toMatchObject({ loaded: false, step: 'loading' })
      expect(state.channelPage.get().channels).toEqual(shown.channels)
      await clock.advance(tasks.QUICK_SEARCH_MS)
      await settle()
      expect(state.channelPage.get().channels).toEqual(isNext ? shown.channels : [])
      await clock.advance(TOO_LONG_LOAD_SECONDS * 1000 - tasks.QUICK_SEARCH_MS)
      expect(load()).toMatchObject({ loaded: false, step: 'long' })
      answer = fail({ _tag: 'Forbidden', message: 'no' })
      await run(tasks.loadChannelPage(query, isNext ? shown : null))
      await settle()
      expect(load()).toMatchObject({ loaded: false, step: 'failed' })
      expect(state.channelPage.get().channels).toEqual([])
      answer = fail({ _tag: 'Unavailable', message: 'down' })
      app.launch(tasks.loadChannelPage(query, isNext ? shown : null))
      await clock.advance(20_000)
      await settle()
      expect(load()).toMatchObject({ loaded: false, step: 'failed' })
      expect(state.channelPage.get().channels).toEqual(isNext ? shown.channels : [])
      answer = { channels: [channel('b')], hasMore: false, cursor: null }
      await run(tasks.loadChannelPage(query, isNext ? shown : null))
      await settle()
      expect(load()).toMatchObject({ loaded: true, step: 'idle' })
      expect(state.channelPage.get().channels.map((one) => one.slug)).toEqual(isNext ? ['a', 'b'] : ['b'])
      expect(state.notice.get()).toBeNull()
    },
  )

  it('never empties the list for a quick search, and never draws an older answer under a newer word', async () => {
    const holds = [hold<unknown>(), hold<unknown>()]
    let asked = 0
    const found = (slug: string) => ({ channels: [channel(slug)], hasMore: false, cursor: null })
    const { app, run, state, clock } = testApp({
      'channels.list': () => (asked++ === 0 ? found('old') : holds[asked - 2]!.waiting),
    })
    await run(tasks.openChannelPage)
    const rows: string[] = []
    state.channelPage.subscribe(({ query, channels }) =>
      rows.push(`${query}: ${channels.map((one) => one.slug).join()}`),
    )
    app.launch(tasks.loadChannelPage('a', null))
    await clock.advance(600)
    app.launch(tasks.loadChannelPage('ab', null))
    await clock.advance(600)
    await settle()
    holds[0]!.release(found('a'))
    await settle()
    expect(state.channelPage.get()).toMatchObject({ query: '', channels: [{ slug: 'old' }] })
    holds[1]!.release(found('ab'))
    await settle()
    await clock.advance(tasks.QUICK_SEARCH_MS)
    await settle()
    expect(state.channelPage.get()).toMatchObject({ query: 'ab', channels: [{ slug: 'ab' }] })
    expect(new Set(rows)).toEqual(new Set([': old', 'ab: ab']))
  })

  it('drops the rows of the word before at once when the search fails', async () => {
    let answer: unknown = { channels: [channel('old')], hasMore: false, cursor: null }
    const { app, run, state } = testApp({ 'channels.list': () => answer })
    await run(tasks.openChannelPage)
    answer = fail({ _tag: 'Forbidden', message: 'no' })
    await run(tasks.loadChannelPage('a', null))
    expect(state.channelPage.get()).toMatchObject({ query: 'a', channels: [] })
    expect(state.channelPage.load.get()).toMatchObject({ loaded: false, step: 'failed' })
    answer = hold<unknown>().waiting
    app.launch(tasks.loadChannelPage('ab', null))
    await settle()
    expect(state.channelPage.get()).toMatchObject({ query: 'ab', channels: [] })
    app.endSession()
  })

  it('tells nobody when only reading the same list again fails', async () => {
    let isDown = false
    const { run, state, clock } = testApp({
      ...answers,
      'channels.list': () =>
        isDown ? fail({ _tag: 'Unavailable', message: 'down' }) : answers['channels.list'](),
    })
    await run(tasks.openChannelPage)
    isDown = true
    await run(tasks.reloadChannelPage)
    await clock.advance(20_000)
    await settle()
    expect(state.channelPage.get().channels).toHaveLength(1)
    expect(state.channelPage.load.get().loaded).toBe(true)
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
      (route) => !['channels.list', 'conversations.list', 'directory.list'].includes(route),
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
