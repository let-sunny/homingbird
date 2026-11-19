import type { CharacterSpec, Member } from '@homingbird/protocol'
import type { StateName } from '@homingbird/sprites'
import { h } from '@homingbird/ui'
import { builtInIdOf, characterOf, framePixels, frameTimings } from '../characters.ts'
import { strings } from '../strings.ts'

export type CharacterScale = 1 | 2 | 3 | 4

export type Motion = 'still' | 'once' | 'loop'

export interface AvatarOptions {
  readonly scale?: CharacterScale
  readonly state?: StateName
  readonly motion?: Motion
  readonly settle?: StateName
  readonly label?: string | null
}

/**
 * A member's character on a canvas, drawn by `packages/sprites` at a whole-number scale and shown with
 * nearest-neighbour sampling. Still by default: only what changes plays, and never with reduced motion.
 */
export const characterAvatar = (spec: CharacterSpec, options: AvatarOptions = {}): HTMLCanvasElement => {
  const { scale = 2, state = 'idle', motion = 'still', settle = 'idle', label = null } = options
  const density = Math.max(1, Math.round(scale * (globalThis.devicePixelRatio ?? 1)))
  const canvas = h(
    'canvas',
    {
      class: `character character-x${scale}`,
      width: String(16 * density),
      height: String(17 * density),
      role: label === null ? 'presentation' : 'img',
      'aria-label': label ?? undefined,
      'aria-hidden': label === null && 'true',
      data: { character: spec.id, state },
    },
    label ?? '',
  )
  const draw = (drawn: StateName, index: number): void => {
    const pixels = framePixels(spec, drawn, index, density)
    canvas
      .getContext('2d')
      ?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0)
  }
  draw(state, 0)
  if (motion !== 'still' && !prefersReducedMotion()) play(canvas, spec, state, motion, settle, draw)
  return canvas
}

/** A member's character with a text alternative naming the person and the character. */
export const memberAvatar = (
  member: Pick<Member, 'name' | 'character'> | undefined,
  options: Omit<AvatarOptions, 'label'> & { readonly labelled?: boolean } = {},
): HTMLCanvasElement => {
  const spec = characterOf(member)
  const label =
    options.labelled === false
      ? null
      : strings.character.avatarLabel({
          person: member?.name ?? strings.formerMember,
          character: characterName(spec),
        })
  return characterAvatar(spec, { ...options, label })
}

/** A built-in character in the reader's language; a made one by the name its maker gave it. */
export const characterName = (spec: CharacterSpec): string => {
  const builtIn = builtInIdOf(spec)
  return builtIn === null
    ? spec.name
    : ((strings.character.names as Readonly<Record<string, string>>)[builtIn] ?? spec.name)
}

const play = (
  canvas: HTMLCanvasElement,
  spec: CharacterSpec,
  state: StateName,
  motion: Exclude<Motion, 'still'>,
  settle: StateName,
  draw: (state: StateName, index: number) => void,
): void => {
  const timings = frameTimings(spec, state)
  let index = 0
  let rounds = 0
  const step = (): void => {
    if (!canvas.isConnected) return
    index = (index + 1) % timings.length
    if (index === 0) rounds++
    if (motion === 'once' && rounds >= ONCE_ROUNDS) {
      draw(settle, 0)
      return
    }
    draw(state, index)
    setTimeout(step, timings[index])
  }
  setTimeout(step, timings[0])
}

const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true

const ONCE_ROUNDS = 2

/** A group conversation: the first two other people side by side, at the smallest scale. */
export const groupAvatar = (
  people: ReadonlyArray<Pick<Member, 'name' | 'character'> | undefined>,
): HTMLElement =>
  h(
    'span',
    { class: 'character-group', 'aria-hidden': 'true' },
    people.slice(0, 2).map((person) => memberAvatar(person, { scale: 1, labelled: false })),
  )
