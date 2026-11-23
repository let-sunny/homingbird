import { h } from '@homingbird/ui'
import type { Page } from '../browser-page.ts'
import { type TurnScale, type TurningBird, turningPip } from '../models/turning-bird.ts'
import { strings } from '../strings.ts'
import { turnSheetUrl } from '../turn-sheets.ts'

/**
 * A bird turning on the spot. The stylesheet steps through the sheet and holds the front still under
 * reduced motion; a member's sheet is drawn here and handed to it as a custom property.
 */
export const renderTurningBird = (screen: TurningScreen, bird: TurningBird): HTMLElement => {
  const element = birdElement(bird)
  if (bird.character !== null)
    element.style.setProperty('--turn-sheet', `url("${turnSheetUrl(bird.character, screen.page)}")`)
  return element
}

/** Pip turning, which needs nothing from the browser: its sheet is a file the stylesheet names. */
export const renderTurningPip = (scale: TurnScale): HTMLElement => birdElement(turningPip(scale))

/** A whole page waiting for its data, with a bird turning above the word. */
export const loadingWithBird = (screen: TurningScreen, bird: TurningBird): HTMLElement =>
  h(
    'div',
    { class: 'empty loading-bird', role: 'status' },
    renderTurningBird(screen, bird),
    h('p', {}, strings.loading),
  )

/** What drawing a member's bird needs from the browser. */
export interface TurningScreen {
  readonly page: Pick<Page, 'pngUrlOf'>
}

const birdElement = (bird: TurningBird): HTMLElement =>
  h('span', {
    class: `turning-bird turn-x${bird.scale}${bird.character === null ? ' is-pip' : ''}`,
    role: bird.label === null ? 'presentation' : 'img',
    'aria-label': bird.label ?? undefined,
    'aria-hidden': bird.label === null && 'true',
    data: { character: bird.character?.id ?? 'pip' },
  })
