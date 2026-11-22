import type { Note } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { closeOffer, offerAfterDecision } from '../src/offers.ts'
import { demoApi, noteStarting, succeeded } from './support/demo.ts'

const asShown = (note: Note) => ({ body: note.body, conversationId: note.conversationId })

describe('chances to teach in the demo', () => {
  it('starts with one, offered after an edit in Ben’s conversation', async () => {
    const { api } = demoApi()
    const { offers } = await succeeded(api['principles.list']({}))
    expect(offers).toEqual([
      expect.objectContaining({ kind: 'edit', suggestion: { added: 'check those by hand', removed: null } }),
    ])
  })

  it('offers one after the visitor rewrites their agent’s draft, and none for a small change', async () => {
    const { api, world } = demoApi()
    const draft = noteStarting(world, 'Yes. I checked the lock ordering')
    await succeeded(
      api['drafts.send']({
        params: { id: draft.id },
        body: {
          body: 'Not today: the export overlaps with the lock window, so run it on Monday.',
          expected: asShown(draft),
        },
      }),
    )
    const { offers } = await succeeded(api['principles.list']({}))
    expect(offers.at(-1)).toMatchObject({
      kind: 'edit',
      noteId: draft.id,
      conversationId: draft.conversationId,
      place: null,
    })
    const before = world.records().offers.length
    offerAfterDecision(world, { ...draft, id: 'note_other0000000' as Note['id'] }, `${draft.body}!`)
    expect(world.records().offers).toHaveLength(before)
  })

  it('offers one after a discard, at most one open in a conversation, and closes it when dismissed', async () => {
    const { api, world } = demoApi()
    const draft = noteStarting(world, 'Yes. I checked the lock ordering')
    await succeeded(api['drafts.discard']({ params: { id: draft.id }, body: {} }))
    const offered = world.records().offers.find((offer) => offer.noteId === draft.id)!
    expect(offered).toMatchObject({ kind: 'discard', suggestion: null })
    offerAfterDecision(world, draft, null)
    expect(
      world.records().offers.filter((offer) => offer.conversationId === draft.conversationId),
    ).toHaveLength(1)
    await succeeded(api['principles.offers.dismiss']({ params: { id: offered.id }, body: {} }))
    expect(world.records().offers.some((offer) => offer.id === offered.id)).toBe(false)
  })

  it('offers nothing for a note the visitor wrote by hand, and closes one a principle was saved from', async () => {
    const { api, world } = demoApi()
    const draft = noteStarting(world, 'Yes. I checked the lock ordering')
    const before = world.records().offers.length
    offerAfterDecision(world, { ...draft, agentName: null }, null)
    offerAfterDecision(world, { ...draft, origin: 'human' }, null)
    expect(world.records().offers).toHaveLength(before)
    const [seeded] = world.records().offers
    await succeeded(
      api['principles.create']({
        body: {
          topic: 'Refund script',
          rule: 'Say which plans it skips.',
          source: null,
          place: null,
          offerId: seeded!.id,
          confirmed: false,
        },
      }),
    )
    expect(world.records().offers).toEqual([])
    closeOffer(world, 'offer_none00000000')
    expect(world.records().offers).toEqual([])
  })
})
