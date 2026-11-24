import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
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
  it('leaves the previews alone on the first connect', async () => {
    const { connect, shown, routes } = start()
    connect('stream')
    await settle()
    expect(shown()).toHaveLength(1)
    expect(routes()).toEqual([])
  })

  it('hides the previews once the stream has to be asked for again, and shows what the server then says', async () => {
    const answer = hold<unknown>()
    const { missed, connect, shown } = start({ 'previews.list': () => answer.waiting })
    connect('stream')
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
