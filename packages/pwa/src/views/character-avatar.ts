import type { Clock } from '@homingbird/kernel'
import type { StateName } from '@homingbird/sprites'
import { h, later } from '@homingbird/ui'
import type { Page } from '../browser-page.ts'
import { framePixels, frameTimings } from '../characters.ts'
import type { AvatarModel } from '../models/avatar.ts'

/**
 * A character on a canvas, drawn by `packages/sprites` at a whole-number scale and shown with
 * nearest-neighbour sampling. Still by default: only what changes plays, and never with reduced motion.
 */
export const renderAvatar = (screen: AvatarScreen, avatar: AvatarModel): HTMLCanvasElement => {
  const { spec, scale, state, motion, settle, label } = avatar
  const density = Math.max(1, Math.round(scale * screen.page.pixelRatio()))
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
  if (motion !== 'still' && !screen.page.prefersReducedMotion()) play(screen.clock, canvas, avatar, draw)
  return canvas
}

export const renderGroupAvatar = (screen: AvatarScreen, faces: ReadonlyArray<AvatarModel>): HTMLElement =>
  h(
    'span',
    { class: 'character-group', 'aria-hidden': 'true' },
    faces.map((face) => renderAvatar(screen, face)),
  )

/** What drawing a character needs from its surroundings. */
export interface AvatarScreen {
  readonly clock: Clock
  readonly page: Pick<Page, 'pixelRatio' | 'prefersReducedMotion'>
}

const play = (
  clock: Clock,
  canvas: HTMLCanvasElement,
  avatar: AvatarModel,
  draw: (state: StateName, index: number) => void,
): void => {
  const timings = frameTimings(avatar.spec, avatar.state)
  let index = 0
  let rounds = 0
  const step = (): void => {
    if (!canvas.isConnected) return
    index = (index + 1) % timings.length
    if (index === 0) rounds++
    if (avatar.motion === 'once' && rounds >= ONCE_ROUNDS) {
      draw(avatar.settle, 0)
      return
    }
    draw(avatar.state, index)
    later(clock, timings[index]!, step)
  }
  later(clock, timings[0]!, step)
}

const ONCE_ROUNDS = 2
