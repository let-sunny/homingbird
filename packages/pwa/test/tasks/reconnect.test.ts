import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { loadPreviews, reloadPreviews } from '../../src/tasks/previews.ts'
import { type Transport, catchUp } from '../../src/tasks/reconnect.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { BEN, CHANNEL_ROOM, ROOM, me, member, serverInfo } from '../support/fixtures.ts'

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

const start = (handlers: Parameters<typeof testApp>[0] = {}) => {
  const test = testApp({
    'me.get': () => me(),
    'previews.list': () => ({ previews: [] }),
    ...handlers,
  })
  test.state.session.set(me())
  test.state.serverInfo.set(serverInfo({ draftPreviews: true }))
  test.state.previews.set(new Map([[ROOM, [preview('note_p1')]]]))
  const missed = catchUp(test.app)
  const connect = (transport: Transport): void => {
    missed.asking(transport)
    missed.answered(transport)
  }
  const shown = () => test.state.previews.get().get(ROOM)
  return { ...test, missed, connect, shown }
}

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
    expect(routes()).toEqual(['me.get', 'previews.list'])
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
    expect(routes()).toEqual(['me.get', 'previews.list'])
    missed.asking('poll')
    expect(shown()).toHaveLength(1)
    missed.answered('poll')
    await settle()
    expect(routes()).toEqual(['me.get', 'previews.list', 'previews.list'])
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
