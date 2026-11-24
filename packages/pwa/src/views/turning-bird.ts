import { h } from '@homingbird/ui'
import type { Page } from '../browser-page.ts'
import type { AvatarModel } from '../models/avatar.ts'
import { turnSheetUrl } from '../turn-sheets.ts'
import { type AvatarScreen, renderAvatar } from './character-avatar.ts'

/**
 * A character turning in fake 3D, for the character editor's preview. The stylesheet steps through a sheet
 * drawn here and handed to it as a custom property; where reduced motion is asked for, it hides the 3D
 * bird and shows the character's flat sprite, which sits beside it.
 */
export const renderTurningBird = (screen: TurningScreen, avatar: AvatarModel): HTMLElement => {
  const turning = h('span', {
    class: 'turning-bird',
    role: avatar.label === null ? 'presentation' : 'img',
    'aria-label': avatar.label ?? undefined,
    'aria-hidden': avatar.label === null && 'true',
    data: { character: avatar.spec.id },
  })
  turning.style.setProperty('--turn-sheet', `url("${turnSheetUrl(avatar.spec, screen.page)}")`)
  const still = renderAvatar(screen, { ...avatar, scale: STILL_SCALE, motion: 'still' })
  still.classList.add('turn-still')
  return h('span', { class: 'character-turn' }, turning, still)
}

/** What drawing a turning bird needs from the browser. */
export interface TurningScreen extends AvatarScreen {
  readonly page: Pick<Page, 'pngUrlOf' | 'pixelRatio' | 'prefersReducedMotion'>
}

const STILL_SCALE = 4
