import type { MemberId } from '@homingbird/protocol'

export type SpritePlace =
  | { readonly kind: 'note'; readonly authorId: MemberId }
  | {
      readonly kind: 'conversation'
      readonly viewerId: MemberId
      readonly participantIds: ReadonlyArray<MemberId>
      readonly arrivedFrom: MemberId | null
    }
  | { readonly kind: 'system' }

export const PIP = 'pip'

export const spriteOwner = (place: SpritePlace): MemberId | typeof PIP => {
  if (place.kind === 'note') return place.authorId
  if (place.kind === 'system') return PIP
  if (place.arrivedFrom !== null && place.arrivedFrom !== place.viewerId) return place.arrivedFrom
  return place.participantIds.find((id) => id !== place.viewerId) ?? place.viewerId
}
