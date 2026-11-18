import { h, replaceChildren } from '@homingbird/ui'
import { hrefFor } from '../routes.ts'
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
} from '../tour.ts'
import { pip } from './pip.ts'

export const startTourOnHome = (routeName: string): void => {
  if (mayStartTour(routeName, hasSeenTour(storage), running !== null)) startTour()
}

export const startTour = (): void => {
  forgetTourSeen(storage)
  running?.finish(false)
  running = tourCallout()
  running.show(0)
}

export const TOUR_ID = 'tour'

interface Running {
  readonly show: (step: number) => void
  readonly finish: (remember: boolean) => void
}

let running: Running | null = null

const storage = (): TourStorage => globalThis.localStorage

const tourCallout = (): Running => {
  const callout = h('div', {
    id: TOUR_ID,
    class: 'tour',
    popover: 'manual',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-labelledby': 'tour-title',
    'aria-describedby': 'tour-body',
  })
  document.body.append(callout)
  let target: HTMLElement | null = null
  let current = 0
  const release = (): void => {
    target?.classList.remove('tour-target')
    target?.style.removeProperty('anchor-name')
  }
  const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    finish(true)
  }
  const onResize = (): void => {
    if (visibleTarget(TOUR_STEPS[current]!) !== target)
      show(current, callout.contains(document.activeElement))
  }
  const finish = (remember: boolean): void => {
    if (remember) rememberTourSeen(storage)
    document.removeEventListener('keydown', onKey)
    removeEventListener('resize', onResize)
    release()
    const returnTo = returnFocusTo?.isConnected === true ? returnFocusTo : target
    callout.hidePopover?.()
    callout.remove()
    running = null
    returnTo?.focus?.()
  }
  const show = (step: number, moveFocus = true): void => {
    current = step
    release()
    const id = TOUR_STEPS[step]!
    target = visibleTarget(id)
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    target?.classList.add('tour-target')
    target?.style.setProperty('anchor-name', '--hb-tour-target')
    const isAnchored = target !== null && anchorsAreSupported()
    callout.classList.toggle('is-anchored', isAnchored)
    callout.classList.toggle('is-in-header', target?.closest('.titlebar') !== null && target !== null)
    callout.dataset.placement = PLACEMENT[id]
    replaceChildren(callout, stepContent(id, step, isAnchored, finish, move))
    if (!callout.matches(':popover-open')) callout.showPopover?.()
    if (moveFocus) callout.querySelector<HTMLElement>('.tour-next')?.focus()
  }
  const move = (direction: 1 | -1): void => {
    const next = stepAfter(current, direction)
    if (next === null) finish(true)
    else show(next)
  }
  document.addEventListener('keydown', onKey)
  addEventListener('resize', onResize)
  return { show, finish }
}

const PLACEMENT: Readonly<Record<TourStepId, 'beside' | 'below'>> = {
  notes: 'beside',
  connect: 'below',
  channels: 'below',
  profile: 'below',
}

/** Without anchor positioning the callout cannot sit beside its control, so it names it in words. */
const anchorsAreSupported = (): boolean => globalThis.CSS?.supports?.('anchor-name: --a') === true

const visibleTarget = (id: TourStepId): HTMLElement | null => {
  const found = document.querySelector<HTMLElement>(`[data-tour="${id}"]`)
  return found?.checkVisibility() === true ? found : null
}

const stepContent = (
  id: TourStepId,
  step: number,
  targetShown: boolean,
  finish: (remember: boolean) => void,
  move: (direction: 1 | -1) => void,
): ReadonlyArray<HTMLElement | false> => {
  const text = STEP_TEXT[id]()
  const last = step === TOUR_STEPS.length - 1
  return [
    h(
      'div',
      { class: 'tour-head' },
      pip('waving', 2),
      h('p', { class: 'tour-progress' }, strings.tour.progress({ step: step + 1, total: TOUR_STEPS.length })),
    ),
    h('h2', { id: 'tour-title' }, text.title),
    h('p', { id: 'tour-body' }, text.body),
    !targetShown && h('p', { class: 'tour-look-for' }, strings.tour.lookFor({ place: text.place })),
    id === 'connect' &&
      h(
        'a',
        { class: 'button', href: hrefFor({ name: 'connect' }), on: { click: () => finish(true) } },
        strings.tour.connectAction,
      ),
    h(
      'div',
      { class: 'tour-actions' },
      h(
        'button',
        { type: 'button', class: 'link tour-skip', on: { click: () => finish(true) } },
        strings.tour.skip,
      ),
      step > 0 &&
        h('button', { type: 'button', class: 'tour-back', on: { click: () => move(-1) } }, strings.tour.back),
      h(
        'button',
        { type: 'button', class: 'primary tour-next', on: { click: () => move(1) } },
        last ? strings.tour.done : strings.tour.next,
      ),
    ),
  ]
}

const STEP_TEXT: Readonly<
  Record<TourStepId, () => { readonly title: string; readonly body: string; readonly place: string }>
> = {
  notes: () => ({
    title: strings.tour.notesTitle,
    body: strings.tour.notesBody,
    place: strings.conversations,
  }),
  connect: () => ({
    title: strings.tour.connectTitle,
    body: strings.tour.connectBody,
    place: strings.connectAgent,
  }),
  channels: () => ({
    title: strings.tour.channelsTitle,
    body: strings.tour.channelsBody,
    place: strings.channels,
  }),
  profile: () => ({
    title: strings.tour.profileTitle,
    body: strings.tour.profileBody,
    place: strings.tour.menuPlace,
  }),
}
