import { describe, expect, it } from 'vitest'
import { VISITOR_ID } from '../src/team.ts'
import { demoApi, memberNamed, noteStarting, refused, succeeded } from './support/demo.ts'

describe('draft previews in the demo', () => {
  it('shows the visitor the draft Ben’s agent wrote, because Ben let them, and nowhere else', async () => {
    const { api, world } = demoApi()
    const early = noteStarting(world, 'Will do.')
    const { previews } = await succeeded(api['previews.list']({ params: { id: early.conversationId } }))
    expect(previews).toEqual([
      expect.objectContaining({ noteId: early.id, state: 'unconfirmed', agentName: "Ben's desk" }),
    ])
    const { notes } = await succeeded(
      api['conversations.notes']({ params: { id: early.conversationId }, query: {} }),
    )
    expect(notes.map((note) => note.id)).not.toContain(early.id)
    await refused(api['notes.get']({ params: { id: early.id } }))
  })

  it('shows Ana nothing of Ben’s draft, and nothing in a conversation she is not in', async () => {
    const { world } = demoApi()
    const early = noteStarting(world, 'Will do.')
    const asAna = demoApi(memberNamed(world, 'Ana Silva'), world)
    await refused(asAna.api['previews.list']({ params: { id: early.conversationId } }))
  })

  it('keeps whom the visitor lets see their agent’s drafts, each once, and previews them to Ana', async () => {
    const { api, world } = demoApi()
    const ana = memberNamed(world, 'Ana Silva')
    expect(await succeeded(api['me.draftPreviews.get']({}))).toEqual({ people: [], channels: [] })
    const saved = await succeeded(api['me.draftPreviews.set']({ body: { people: [ana, ana], channels: [] } }))
    expect(saved).toEqual({ people: [ana], channels: [] })
    await succeeded(api['me.draftPreviews.set']({ body: { people: [ana], channels: ['billing'] } }))
    expect(await succeeded(api['me.draftPreviews.get']({}))).toEqual({ people: [ana], channels: ['billing'] })
    const mine = noteStarting(world, 'Yes. I checked')
    const asAna = demoApi(ana, world)
    const { previews } = await succeeded(asAna.api['previews.list']({ params: { id: mine.conversationId } }))
    expect(previews.map((preview) => [preview.noteId, preview.authorId])).toEqual([[mine.id, VISITOR_ID]])
  })
})
