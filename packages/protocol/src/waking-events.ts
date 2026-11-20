import type * as AsRead from './as-read.ts'
import type { EventBody } from './events.ts'
import type { MemberId } from './ids.ts'

/** A listener that does not know whose stream it holds passes null: every note wakes it, no room does. */
export const isWakingEvent = (body: EventBody | AsRead.EventBody, viewerId: MemberId | null): boolean => {
  if (body.type === 'note.sent') return body.note.authorId !== viewerId
  if (body.type === 'debate.changed') return viewerId !== null && body.participantIds.includes(viewerId)
  return body.type === 'draft.requested' || body.type === 'resync'
}
