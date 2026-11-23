import type { MemberId } from '@homingbird/protocol'

export type SpritePlace =
  | { readonly kind: 'note'; readonly authorId: MemberId }
  | {
      readonly kind: 'conversation'
      readonly viewerId: MemberId
      readonly participantIds: ReadonlyArray<MemberId>
      readonly arrivedFrom: MemberId | null
    }

/** Whose character a place shows: always a person's, never Pip, who is only the logo. */
export const spriteOwner = (place: SpritePlace): MemberId => {
  if (place.kind === 'note') return place.authorId
  if (place.arrivedFrom !== null && place.arrivedFrom !== place.viewerId) return place.arrivedFrom
  return place.participantIds.find((id) => id !== place.viewerId) ?? place.viewerId
}
