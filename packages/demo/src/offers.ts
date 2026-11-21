import { type Note, type PrincipleOffer, isSubstantialEdit, suggestedChange } from '@homingbird/protocol'
import type { World } from './world.ts'

/**
 * After the visitor sends their agent's draft with a substantial edit, or discards it, offers a chance
 * to teach, as Dovecote does: at most one open in a conversation, and the suggestion from the draft and
 * the sent text only.
 */
export const offerAfterDecision = (world: World, draft: Note, sentBody: string | null): void => {
  if (draft.agentName === null || draft.origin === 'human') return
  if (sentBody !== null && !isSubstantialEdit(draft.body, sentBody)) return
  const records = world.records()
  if (records.offers.some((offer) => offer.conversationId === draft.conversationId)) return
  const offer: PrincipleOffer = {
    id: world.nextId('offer'),
    kind: sentBody === null ? 'discard' : 'edit',
    noteId: draft.id,
    conversationId: draft.conversationId,
    place: records.channels.find((channel) => channel.conversationId === draft.conversationId)?.slug ?? null,
    suggestion: sentBody === null ? null : suggestedChange(draft.body, sentBody),
    createdAt: world.clock.now(),
  }
  world.update((all) => ({ ...all, offers: [...all.offers, offer] }))
}

/** The chance to teach is closed: the visitor saved a principle from it, or said not now. */
export const closeOffer = (world: World, id: string): void =>
  world.update((records) => ({ ...records, offers: records.offers.filter((offer) => offer.id !== id) }))
