import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { ATTEMPT_LIMIT_SECONDS } from '../../src/load-timing.ts'
import { loadPreviews, reloadPreviews } from '../../src/tasks/previews.ts'
import { type Transport, catchUp } from '../../src/tasks/reconnect.ts'
import { invalidate, open } from '../../src/tasks/resources.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import {
  BEN,
  CHANNEL_ROOM,
  ROOM,
  entry,
  everything,
  me,
  member,
  serverInfo,
  summary,
} from '../support/fixtures.ts'
import { setWorkspace } from '../support/resource-load.ts'

const preview = (id: string): AsRead.DraftPreview => ({
  noteId: id as NoteId,
  conversationId: ROOM,
  authorId: BEN,
  agentName: 'Ben desk',
  inReplyTo: null,
  state: 'unconfirmed',
  body: 'Early words',
  createdAt: 1,
  updatedAt: 1,
})

const start = (handlers: Parameters<typeof testApp>[0] = {}, hasLists = false) => {
  const test = testApp({
    'me.get': () => me(),
    'previews.list': () => ({ previews: [] }),
    'reviews.list': () => ({ reviews: [] }),
    'debateSuggestions.list': () => ({ suggestions: [] }),
    'debates.list': () => ({ debates: [] }),
    'conversations.list': () => ({ conversations: [] }),
    'directory.list': () => ({ entries: [] }),
    'channels.list': () => ({ channels: [] }),
    'credentials.list': () => ({ credentials: [] }),
    ...handlers,
  })
  test.state.session.set(me())
  test.state.serverInfo.set(
    serverInfo({
      draftPreviews: true,
      channelAgents: hasLists,
      debateSuggestions: hasLists,
      debateRooms: hasLists,
    }),
  )
  test.state.previews.set(new Map([[ROOM, [preview('note_p1')]]]))
  const missed = catchUp(test.app)
  const connect = (transport: Transport): void => {
    missed.asking(transport)
    missed.answered(transport)
  }
  const shown = () => test.state.previews.get().get(ROOM)
  return { ...test, missed, connect, shown }
}

const WORKSPACE_LISTS = ['channels.list', 'conversations.list', 'credentials.list', 'directory.list']

const withoutLists = (routes: ReadonlyArray<string>) =>
  routes.filter((route) => !WORKSPACE_LISTS.includes(route))

describe('catchUp', () => {
  it('reads the previews held before the first connect, since one may be discarded until then', async () => {
    const { connect, shown, routes } = start()
    connect('stream')
    expect(shown()).toHaveLength(1)
    await settle()
    expect(shown()).toEqual([])
    expect(routes()).toEqual(['previews.list'])
  })

  it('never lets an answer asked for before the drop bring a preview or its words back', async () => {
    const before = hold<unknown>()
    let asked = 0
    const { connect, missed, shown, run, state } = start({
      'previews.list': () => [{ previews: [] }, before.waiting, { previews: [] }][asked++],
    })
    connect('stream')
    await settle()
    const opened = run(loadPreviews(ROOM))
    await settle()
    missed.lost()
    connect('stream')
    await settle()
    expect(asked).toBe(3)
    before.release({ previews: [preview('note_p1')] })
    await opened
    expect(shown()).toEqual([])
    expect(state.previewedBodies.get().size).toBe(0)
  })

  it('nor when the read at the reconnect failed, until a later one succeeds', async () => {
    const before = hold<unknown>()
    let asked = 0
    const down = fail({ _tag: 'Unavailable', message: 'down' })
    const { connect, shown, run, state } = start({
      'previews.list': () =>
        [{ previews: [] }, before.waiting, down, { previews: [preview('note_p2')] }][asked++],
    })
    connect('stream')
    await settle()
    const reloaded = run(reloadPreviews)
    await settle()
    connect('stream')
    await settle()
    before.release({ previews: [preview('note_p1')] })
    await reloaded
    expect(asked).toBe(3)
    expect(shown()).toEqual([])
    expect(state.previewedBodies.get().size).toBe(0)
    connect('stream')
    await settle()
    expect(shown()).toEqual([preview('note_p2')])
  })

  it('reads at the reconnect a room opened before it, whose own answer no longer counts', async () => {
    const opening = hold<unknown>()
    let asked = 0
    const { connect, missed, run, state } = start({
      'previews.list': ({ params }) =>
        params.id === CHANNEL_ROOM && asked++ === 0 ? opening.waiting : { previews: [] },
    })
    connect('stream')
    await settle()
    const opened = run(loadPreviews(CHANNEL_ROOM))
    await settle()
    missed.lost()
    opening.release({ previews: [preview('note_p1')] })
    await opened
    expect(state.previews.get().get(CHANNEL_ROOM)).toEqual([])
    connect('stream')
    await settle()
    expect(asked).toBe(2)
  })

  it('hides what a room opened while disconnected showed, when the reconnect cannot tell who is signed in', async () => {
    let asked = 0
    const { connect, missed, shown, run } = start({
      'me.get': () => fail({ _tag: 'Unavailable', message: 'down' }),
      'previews.list': () => ({ previews: asked++ === 0 ? [] : [preview('note_p1')] }),
    })
    connect('stream')
    await settle()
    missed.lost()
    await run(loadPreviews(ROOM))
    expect(shown()).toHaveLength(1)
    connect('stream')
    await settle()
    expect(shown()).toEqual([])
  })

  it('hides the previews once the stream has to be asked for again, and shows what the server then says', async () => {
    const answer = hold<unknown>()
    let asked = 0
    const { missed, connect, shown } = start({
      'previews.list': () => (asked++ === 0 ? { previews: [preview('note_p1')] } : answer.waiting),
    })
    connect('stream')
    await settle()
    missed.asking('stream')
    expect(shown()).toEqual([])
    missed.answered('stream')
    await settle()
    expect(shown()).toEqual([])
    answer.release({ previews: [preview('note_p2')] })
    await settle()
    expect(shown()).toEqual([preview('note_p2')])
  })

  it('hides them when the events are lost, and reads them again after a first connect that failed', async () => {
    const { missed, connect, shown, routes, state } = start()
    missed.asking('stream')
    state.previewedBodies.set(
      new Map([
        ['note_p1' as NoteId, 'Early words'],
        ['note_sent' as NoteId, 'Sent before'],
      ]),
    )
    missed.lost()
    expect(shown()).toEqual([])
    expect([...state.previewedBodies.get().keys()]).toEqual(['note_sent'])
    connect('stream')
    await settle()
    expect(withoutLists(routes())).toEqual(['me.get', 'previews.list'])
  })

  it('keeps them hidden, without a notice, when the server does not answer', async () => {
    const { missed, connect, shown, state } = start({
      'previews.list': () => fail({ _tag: 'Unavailable', message: 'down' }),
    })
    connect('stream')
    missed.lost()
    connect('stream')
    await settle()
    expect(shown()).toEqual([])
    expect(state.notice.get()).toBeNull()
  })

  it('reads them again at each poll that answers, showing them meanwhile, since a poll brings no such event', async () => {
    const { connect, missed, shown, routes } = start({
      'previews.list': () => ({ previews: [preview('note_p1')] }),
    })
    connect('stream')
    connect('poll')
    await settle()
    expect(withoutLists(routes())).toEqual(['me.get', 'previews.list'])
    missed.asking('poll')
    expect(shown()).toHaveLength(1)
    missed.answered('poll')
    await settle()
    expect(withoutLists(routes())).toEqual(['me.get', 'previews.list', 'previews.list'])
  })

  it('hides them when a poll that answered before finds them unreadable', async () => {
    let isDown = false
    const { connect, shown } = start({
      'previews.list': () =>
        isDown ? fail({ _tag: 'Unavailable', message: 'down' }) : { previews: [preview('note_p1')] },
    })
    connect('stream')
    connect('poll')
    await settle()
    expect(shown()).toHaveLength(1)
    isDown = true
    connect('poll')
    await settle()
    expect(shown()).toEqual([])
    isDown = false
    connect('poll')
    await settle()
    expect(shown()).toHaveLength(1)
  })

  it('never lets an answer from before a second drop bring a preview back', async () => {
    const first = hold<unknown>()
    let asked = 0
    const { connect, missed, shown } = start({
      'previews.list': () => (asked++ === 0 ? first.waiting : { previews: [] }),
    })
    connect('stream')
    connect('stream')
    await settle()
    missed.lost()
    first.release({ previews: [preview('note_p1')] })
    await settle()
    expect(shown()).toEqual([])
    connect('stream')
    await settle()
    expect(shown()).toEqual([])
  })

  it('starts the page anew, holding nothing, when another person signed in meanwhile', async () => {
    const { connect, app, state, page, routes } = start({
      'me.get': () => ({ ...me(), member: member(BEN, 'Ben') }),
    })
    state.previews.update((all) => new Map(all).set(CHANNEL_ROOM, []))
    connect('stream')
    connect('stream')
    await settle()
    expect(page.visited).toEqual(['reload'])
    expect(app.ended.aborted).toBe(true)
    expect(state.previews.get().size).toBe(0)
    expect(routes()).toEqual(['me.get'])
  })
})

describe('catchUp with the lists that events sent once bring up to date', () => {
  const LISTS = ['debateSuggestions.list', 'debates.list', 'reviews.list', ...WORKSPACE_LISTS].sort()
  const listsAsked = (routes: ReadonlyArray<string>) => routes.filter((route) => LISTS.includes(route)).sort()

  it('asks for none at the first connect, and for each once at a reconnect, after who is signed in', async () => {
    const { connect, routes } = start({}, true)
    connect('stream')
    await settle()
    expect(listsAsked(routes())).toEqual([])
    connect('stream')
    await settle()
    expect(listsAsked(routes())).toEqual(LISTS)
    expect(routes().indexOf('me.get')).toBeLessThan(routes().findIndex((route) => LISTS.includes(route)))
  })

  it('shows what was missed, also over an answer that was asked for before the drop', async () => {
    const before = hold<unknown>()
    let asked = 0
    const { connect, app, state, aborted } = start(
      { 'debates.list': () => (asked++ === 0 ? before.waiting : { debates: [summary()] }) },
      true,
    )
    connect('stream')
    app.launch(open('debates'))
    await settle()
    connect('stream')
    await settle()
    expect(aborted).toEqual([])
    before.release({ debates: [] })
    await settle()
    expect(state.debates.get()).toEqual([summary()])
  })

  it('asks for none until the server says who is signed in, and asks that again while it is away', async () => {
    let isAway = true
    const { connect, routes, clock, shown } = start(
      { 'me.get': () => (isAway ? fail({ _tag: 'Unavailable', message: 'away' }) : me()) },
      true,
    )
    connect('stream')
    connect('stream')
    await settle()
    expect(listsAsked(routes())).toEqual([])
    expect(shown()).toEqual([])
    isAway = false
    await clock.advance(1000)
    await settle()
    expect(listsAsked(routes())).toEqual(LISTS)
    expect(clock.pending()).toBe(0)
  })

  it.each(['never read', 'read before'])(
    'lets a list %s arrive although streams come and go faster than it answers',
    async (when) => {
      const answers: Array<(answer: unknown) => void> = []
      const { connect, app, state, aborted, run } = start({
        'directory.list': () => {
          const one = hold<unknown>()
          answers.push(one.release)
          return one.waiting
        },
      })
      connect('stream')
      const name = (text: string) => ({ entries: [entry(BEN, text)] })
      app.launch(open('directory'))
      await settle()
      if (when === 'read before') {
        answers.shift()!(name('Ben Then'))
        await settle()
        app.launch(invalidate('directory'))
        await settle()
      }
      const ended = aborted.length
      for (let drop = 0; drop < 5; drop++) {
        connect('stream')
        await settle()
      }
      expect(aborted).toHaveLength(ended)
      answers.shift()!(name('Ben Between'))
      await settle()
      expect(state.directory.get()).toEqual([entry(BEN, 'Ben Between')])
      answers.shift()!(name('Ben Now'))
      await settle()
      expect(state.directory.get()).toEqual([entry(BEN, 'Ben Now')])
      expect(answers).toEqual([])
      await run(open('directory'))
    },
  )

  it('shows the previews and keeps the other parts coming while one part never answers, through later polls', async () => {
    const answers = { groups: hold<unknown>(), debate: hold<unknown>() }
    const { connect, state, routes, shown, clock, aborted } = start(
      {
        'previews.list': () => ({ previews: [preview('note_p2')] }),
        'groups.list': () => answers.groups.waiting,
        'principleProposals.list': () => ({ document: null, proposals: [], limit: 20 }),
        'debates.get': () => answers.debate.waiting,
      },
      true,
    )
    const info = everything()
    state.serverInfo.set({ ...info, features: { ...info.features, draftPreviews: true } })
    state.groupsLoaded.set(true)
    state.interview.set('failed')
    state.route.set({ name: 'debate', id: 'deb_1' } as never)
    connect('stream')
    connect('poll')
    await settle()
    expect(shown()).toEqual([preview('note_p2')])
    expect(state.interview.get()).toEqual({ document: null, proposals: [], limit: 20 })
    for (let poll = 0; poll < 3; poll++) {
      connect('poll')
      await settle()
    }
    expect(aborted).toEqual([])
    answers.debate.release({ id: 'deb_1' })
    await settle()
    expect(state.shownDebate.get()).toEqual({ id: 'deb_1' })
    for (const route of ['groups.list', 'debates.get', 'debates.list', 'directory.list'])
      expect(
        routes().filter((one) => one === route),
        route,
      ).toHaveLength(1)
    await clock.advance(ATTEMPT_LIMIT_SECONDS * 1000)
    expect(aborted).toContain('groups.list')
    expect(state.notice.get()).toBeNull()
  })

  it('still owes the lists when the stream is lost again before the server said who is signed in', async () => {
    const who = [hold<unknown>(), hold<unknown>()]
    let asked = 0
    const { connect, missed, routes } = start({ 'me.get': () => who[asked++]!.waiting }, true)
    connect('stream')
    connect('stream')
    await settle()
    missed.lost()
    who[0]!.release(me())
    await settle()
    expect(listsAsked(routes())).toEqual([])
    connect('stream')
    await settle()
    who[1]!.release(me())
    await settle()
    expect(listsAsked(routes())).toEqual(LISTS)
  })

  it('keeps the request of a list never read on its way, so that streams that come and go never hold it back', async () => {
    const slow = hold<unknown>()
    let asked = 0
    const { connect, app, state, aborted } = start({
      'directory.list': () => (asked++ === 0 ? slow.waiting : { entries: [entry(BEN, 'Ben')] }),
    })
    connect('stream')
    app.launch(open('directory'))
    await settle()
    for (let drop = 0; drop < 3; drop++) {
      connect('stream')
      await settle()
    }
    expect(aborted).toEqual([])
    slow.release({ entries: [] })
    await settle()
    expect(state.directory.get()).toEqual([entry(BEN, 'Ben')])
    expect(asked).toBe(2)
  })

  it('asks once more, without asking who is signed in, when the first stream opened only after the lists', async () => {
    const { connect, routes, state, shown } = start(
      { 'previews.list': () => ({ previews: [preview('note_p1')] }) },
      true,
    )
    state.stream.set('late')
    connect('stream')
    expect(shown()).toHaveLength(1)
    await settle()
    expect(listsAsked(routes())).toEqual([])
    setWorkspace(state, 'loaded')
    await settle()
    expect(listsAsked(routes())).toEqual(LISTS)
    expect(routes()).not.toContain('me.get')
    connect('poll')
    await settle()
    expect(routes().filter((route) => route === 'me.get')).toHaveLength(1)
  })

  it('reads again the groups, the teaching chat and the flock on screen, where the page holds them', async () => {
    const handlers = {
      'groups.list': () => ({ groups: [] }),
      'principleProposals.list': () => ({ document: null, proposals: [] }),
      'debates.get': () => fail({ _tag: 'NotFound', message: 'no' }),
    }
    const others = (routes: ReadonlyArray<string>) => routes.filter((route) => route in handlers)
    const none = start(handlers)
    none.connect('stream')
    none.connect('stream')
    await settle()
    expect(others(none.routes())).toEqual([])
    const held = start(handlers)
    held.state.serverInfo.set(everything())
    held.state.groupsLoaded.set(true)
    held.state.interview.set('failed')
    held.state.route.set({ name: 'debate', id: 'deb_1' } as never)
    held.connect('stream')
    held.connect('stream')
    await settle()
    expect(others(held.routes())).toEqual(['groups.list', 'principleProposals.list', 'debates.get'])
  })

  it('asks for none of another person’s', async () => {
    const { connect, routes, page } = start(
      { 'me.get': () => ({ ...me(), member: member(BEN, 'Ben') }) },
      true,
    )
    connect('stream')
    connect('stream')
    await settle()
    expect(page.visited).toEqual(['reload'])
    expect(listsAsked(routes())).toEqual([])
  })

  it('asks once when it falls back to polling, not at each poll, though a poll may answer before the check', async () => {
    const answer = hold<unknown>()
    let asked = 0
    const { connect, routes } = start({ 'me.get': () => (asked++ === 0 ? answer.waiting : me()) }, true)
    connect('stream')
    connect('poll')
    await settle()
    connect('poll')
    await settle()
    expect(listsAsked(routes())).toEqual(LISTS)
    connect('poll')
    await settle()
    expect(listsAsked(routes())).toEqual(LISTS)
  })

  it('tells nobody when they cannot be read', async () => {
    const { connect, state } = start(
      { 'debates.list': () => fail({ _tag: 'Unavailable', message: 'down' }) },
      true,
    )
    connect('stream')
    connect('stream')
    await settle()
    expect(state.notice.get()).toBeNull()
  })
})
