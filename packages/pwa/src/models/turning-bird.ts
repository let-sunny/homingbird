import type { CharacterSpec } from '@homingbird/protocol'
import type { AvatarModel } from './avatar.ts'

/**
 * A bird turning in fake 3D: Pip where the brand stands, or a member's own character where that person is
 * the subject. Pip has no character here because its sheet is a file the server serves.
 */
export interface TurningBird {
  readonly character: CharacterSpec | null
  readonly scale: TurnScale
  readonly label: string | null
}

/** A whole-number scale of the 39-pixel cell, so that pixels stay square. */
export type TurnScale = 1 | 2 | 3

/** Pip as the brand, decoration only: the page around it says what it is. */
export const turningPip = (scale: TurnScale): TurningBird => ({ character: null, scale, label: null })

/** The character an avatar shows, turning, and named in the same words. */
export const turningBirdOf = (
  avatar: Pick<AvatarModel, 'spec' | 'label'>,
  scale: TurnScale,
): TurningBird => ({
  character: avatar.spec,
  scale,
  label: avatar.label,
})
