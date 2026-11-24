import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { forgetSession } from '../../src/state.ts'
import * as tasks from '../../src/tasks/previews.ts'
import { fail, hold, settle, testApp } from '../support/app.ts'
import { BEN, CHANNEL_ROOM, ROOM, serverInfo } from '../support/fixtures.ts'

const preview = (fields: Partial<AsRead.DraftPreview> = {}): AsRead.DraftPreview => ({
  noteId: 'note_preview00000' as NoteId,
  conversationId: ROOM,
  authorId: BEN,
  agentName: 'Ben desk',
  inReplyTo: null,
  state: 'unconfirmed',
  body: 'Early words',
  createdAt: 1,
  updatedAt: 1,
  ...fields,
})

describe('preview tasks', () => {
  it('asks for nothing while previews are off', async () => {
    const { run, routes } = testApp()
    await run(tasks.loadPreviews(ROOM))
    expect(routes()).toEqual([])
  })

  it('keeps a conversation’s previews and the words each unconfirmed one showed', async () => {
    const shown = [
      preview(),
      preview({ noteId: 'note_gone000000000' as NoteId, state: 'withdrawn', body: null }),
    ]
    const { run, state } = testApp({ 'previews.list': () => ({ previews: shown }) })
    state.serverInfo.set(serverInfo({ draftPreviews: true }))
    await run(tasks.loadPreviews(ROOM))
    expect(state.previews.get().get(ROOM)).toEqual(shown)
    expect([...state.previewedBodies.get()]).toEqual([['note_preview00000', 'Early words']])
  })

  it('keeps the answer of the load that started last, and nothing of an older one', async () => {
    const older = hold<unknown>()
    let asked = 0
    const { run, state } = testApp({
      'previews.list': () => (asked++ === 0 ? older.waiting : { previews: [] }),
    })
    state.serverInfo.set(serverInfo({ draftPreviews: true }))
    const first = run(tasks.loadPreviews(ROOM))
    await settle()
    await run(tasks.loadPreviews(ROOM))
    older.release({ previews: [preview()] })
    expect((await first)._tag).toBe('Ok')
    expect(state.previews.get().get(ROOM)).toEqual([])
    expect(state.previewedBodies.get().size).toBe(0)
  })

  it('keeps nothing of an answer that comes after the session was forgotten', async () => {
    const late = hold<unknown>()
    const { run, state } = testApp({ 'previews.list': () => late.waiting })
    state.serverInfo.set(serverInfo({ draftPreviews: true }))
    const loading = run(tasks.loadPreviews(ROOM))
    await settle()
    forgetSession(state)
    late.release({ previews: [preview()] })
    await loading
    expect(state.previews.get().size).toBe(0)
    expect(state.previewedBodies.get().size).toBe(0)
  })

  it('reads again every conversation whose previews the page holds', async () => {
    const { run, state, sent } = testApp({ 'previews.list': () => ({ previews: [] }) })
    state.serverInfo.set(serverInfo({ draftPreviews: true }))
    state.previews.set(
      new Map([
        [ROOM, []],
        [CHANNEL_ROOM, []],
      ]),
    )
    await run(tasks.reloadPreviews)
    expect(sent.map((one) => one.request)).toEqual([
      { params: { id: ROOM } },
      { params: { id: CHANNEL_ROOM } },
    ])
  })

  it('goes on reading the other conversations when one cannot be read', async () => {
    const { run, state, routes } = testApp({
      'previews.list': (request) =>
        (request as { params: { id: string } }).params.id === ROOM
          ? fail({ _tag: 'Unavailable', message: 'down' })
          : { previews: [preview({ noteId: 'note_fresh0000000' as NoteId, conversationId: CHANNEL_ROOM })] },
    })
    state.serverInfo.set(serverInfo({ draftPreviews: true }))
    state.previews.set(
      new Map([
        [ROOM, [preview()]],
        [CHANNEL_ROOM, []],
      ]),
    )
    expect((await run(tasks.reloadPreviews))._tag).toBe('Ok')
    expect(routes()).toEqual(['previews.list', 'previews.list'])
    expect(state.previews.get().get(ROOM)).toEqual([preview()])
    expect(state.previews.get().get(CHANNEL_ROOM)).toHaveLength(1)
  })

  it.each([
    ['not found', fail({ _tag: 'NotFound', message: 'No.' })],
    ['forbidden', fail({ _tag: 'Forbidden', message: 'No.' })],
  ])(
    'drops the previews of a conversation that answers %s, and the words they showed',
    async (_, refusal) => {
      const { run, state } = testApp({
        'previews.list': (request) =>
          (request as { params: { id: string } }).params.id === ROOM ? refusal : { previews: [] },
      })
      state.serverInfo.set(serverInfo({ draftPreviews: true }))
      const kept = preview({ noteId: 'note_kept000000000' as NoteId, conversationId: CHANNEL_ROOM })
      state.previews.set(
        new Map([
          [ROOM, [preview()]],
          [CHANNEL_ROOM, [kept]],
        ]),
      )
      state.previewedBodies.set(
        new Map([
          ['note_preview00000' as NoteId, 'Early words'],
          ['note_kept000000000' as NoteId, 'Kept words'],
        ]),
      )
      expect((await run(tasks.reloadPreviews))._tag).toBe('Ok')
      expect(state.previews.get().has(ROOM)).toBe(false)
      expect([...state.previewedBodies.get().keys()]).toEqual(['note_kept000000000'])
    },
  )

  it('ends the session when a conversation’s previews answer unauthorized', async () => {
    const { run, state } = testApp({
      'previews.list': () => fail({ _tag: 'Unauthorized', message: 'Sign in.' }),
    })
    state.serverInfo.set(serverInfo({ draftPreviews: true }))
    state.previews.set(new Map([[ROOM, [preview()]]]))
    expect(await run(tasks.reloadPreviews)).toMatchObject({
      _tag: 'Err',
      error: { error: { _tag: 'Unauthorized' } },
    })
  })

  it('loads and saves whom the person lets see their agent’s drafts, keeping what the server stored', async () => {
    const stored = { people: [BEN], channels: ['ops'] }
    const { run, state, sent } = testApp({
      'me.draftPreviews.get': () => ({ people: [], channels: [] }),
      'me.draftPreviews.set': () => stored,
    })
    expect(await run(tasks.loadPreviewAllowance)).toMatchObject({
      _tag: 'Ok',
      value: { people: [], channels: [] },
    })
    expect(state.previewAllowance.get()).toEqual({ people: [], channels: [] })
    await run(tasks.savePreviewAllowance({ people: [BEN, BEN], channels: ['ops'] }))
    expect(state.previewAllowance.get()).toEqual(stored)
    expect(sent.at(-1)).toEqual({
      route: 'me.draftPreviews.set',
      request: { body: { people: [BEN, BEN], channels: ['ops'] } },
    })
  })
})
