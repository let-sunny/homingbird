import type { AsRead, NoteId } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import * as tasks from '../../src/tasks/previews.ts'
import { testApp } from '../support/app.ts'
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
