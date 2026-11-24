import { h, replaceChildren } from '@homingbird/ui'
import type { Page } from '../browser-page.ts'
import { type TourStepModel, tourStepModel } from '../models/tour.ts'
import type { PageDocument } from '../page-document.ts'
import { strings } from '../strings.ts'
import {
  TOUR_STEPS,
  type TourStepId,
  type TourStorage,
  forgetTourSeen,
  hasSeenTour,
  mayStartTour,
  rememberTourSeen,
  stepAfter,
  tourTargets,
} from '../tour.ts'
import type { Tour } from './context.ts'
import { pip } from './pip.ts'

/** The first-visit tour on a page: a callout beside each control in turn, remembered once finished. */
export const createTour = (page: Page, document: PageDocument): Tour => {
  const storage = (): TourStorage => ({
    getItem: page.storage.local,
    setItem: page.storage.setLocal,
    removeItem: page.storage.removeLocal,
  })
  let running: Running | null = null
  const start = (): void => {
    forgetTourSeen(storage)
    running?.finish(false)
    running = tourCallout(page, document, storage, () => {
      running = null
    })
    running.show(0)
  }
  return {
    start,
    end: () => running?.finish(false),
    startOnFirstVisit: (routeName, firstStepsShown) => {
      if (mayStartTour(routeName, hasSeenTour(storage), running !== null, firstStepsShown)) start()
    },
  }
}

const TOUR_ID = 'tour'

/** The tour scrolls the tab row to the tabs it points at; at its end the person's own tab comes back. */
const CURRENT_TAB = '.tabs .tab[aria-current="page"]'

interface Running {
  readonly show: (step: number) => void
  readonly finish: (remember: boolean) => void
}

const tourCallout = (
  page: Page,
  document: PageDocument,
  storage: () => TourStorage,
  ended: () => void,
): Running => {
  const callout = h('div', {
    id: TOUR_ID,
    class: 'tour',
    popover: 'manual',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-labelledby': 'tour-title',
    'aria-describedby': 'tour-body',
  })
  document.addToBody(callout)
  let target: HTMLElement | null = null
  let current = 0
  const release = (): void => {
    target?.classList.remove('tour-target')
    target?.style.removeProperty('anchor-name')
  }
  const returnFocusTo = document.focused() as HTMLElement | null
  const onKey = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape') return
    event.preventDefault()
    finish(true)
  }
  const stopResizing = page.on('resize', () => {
    if (visibleTarget(document, TOUR_STEPS[current]!) !== target)
      show(current, callout.contains(document.focused()))
  })
  const finish = (remember: boolean): void => {
    if (remember) rememberTourSeen(storage)
    stopKeys()
    stopResizing()
    release()
    const returnTo = returnFocusTo?.isConnected === true ? returnFocusTo : target
    callout.hidePopover?.()
    callout.remove()
    ended()
    document.find(CURRENT_TAB)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    returnTo?.focus?.()
  }
  const show = (step: number, moveFocus = true): void => {
    current = step
    release()
    const id = TOUR_STEPS[step]!
    target = visibleTarget(document, id)
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    target?.classList.add('tour-target')
    target?.style.setProperty('anchor-name', '--hb-tour-target')
    const isAnchored = target !== null && page.supportsAnchors()
    const model = tourStepModel(step, isAnchored)
    callout.classList.toggle('is-anchored', isAnchored)
    callout.classList.toggle('is-in-header', target !== null && isInHeader(target))
    callout.dataset.placement = model.placement
    replaceChildren(callout, stepContent(model, finish, move))
    if (!callout.matches(':popover-open')) callout.showPopover?.()
    if (moveFocus) callout.querySelector<HTMLElement>('.tour-next')?.focus()
  }
  const move = (direction: 1 | -1): void => {
    const next = stepAfter(current, direction)
    if (next === null) finish(true)
    else show(next)
  }
  const stopKeys = document.listen('keydown', onKey)
  return { show, finish }
}

/**
 * Whether a control is shown in the header. A tab belongs to the header, but on a phone the tabs are
 * placed at the bottom of the screen, where the callout belongs above them, not under the header.
 */
const isInHeader = (target: HTMLElement): boolean => {
  const header = target.closest('.titlebar')
  if (header === null) return false
  const box = target.getBoundingClientRect()
  return box.height === 0 || box.top < header.getBoundingClientRect().bottom
}

const visibleTarget = (document: PageDocument, id: TourStepId): HTMLElement | null => {
  for (const target of tourTargets(id)) {
    const found = document.find(`[data-tour="${target}"]`)
    if (found?.checkVisibility() === true) return found
  }
  return null
}

const stepContent = (
  model: TourStepModel,
  finish: (remember: boolean) => void,
  move: (direction: 1 | -1) => void,
): ReadonlyArray<HTMLElement | false> => [
  h('div', { class: 'tour-head' }, pip('waving', 2), h('p', { class: 'tour-progress' }, model.progress)),
  h('h2', { id: 'tour-title' }, model.title),
  h('p', { id: 'tour-body' }, model.body),
  model.lookFor !== null && h('p', { class: 'tour-look-for' }, model.lookFor),
  model.connect !== null &&
    h(
      'a',
      { class: 'button', href: model.connect.href, on: { click: () => finish(true) } },
      model.connect.label,
    ),
  h(
    'div',
    { class: 'tour-actions' },
    h(
      'button',
      { type: 'button', class: 'link tour-skip', on: { click: () => finish(true) } },
      strings.tour.skip,
    ),
    model.back !== null &&
      h('button', { type: 'button', class: 'tour-back', on: { click: () => move(-1) } }, model.back),
    h('button', { type: 'button', class: 'primary tour-next', on: { click: () => move(1) } }, model.next),
  ),
]
