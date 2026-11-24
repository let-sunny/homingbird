import { h, later } from '@homingbird/ui'
import {
  HINT_DELAY_MS,
  type HintConcept,
  hintsAfterDismiss,
  hintsAfterUse,
  isInlineHintDue,
  readHints,
  writeHints,
} from '../hints.ts'
import { menuPlacement } from '../models/menu-placement.ts'
import { signedIn } from '../state.ts'
import { strings } from '../strings.ts'
import type { ViewContext } from './context.ts'

/**
 * A control or label of a concept other messengers lack, with a quiet one-line hint of what the person
 * can do there, followed by the element that holds the hint: place both where the control goes.
 *
 * The hint shows whenever the pointer or the keyboard focus rests on the control, however long the
 * person has used Homingbird, through an interest invoker where the browser has them and a small script
 * elsewhere. A touch screen has no hover, so it shows the hint once beside the control instead, while
 * the person is new, until they use the control or close it. Screen readers always hear it as the
 * control's description.
 */
export const hinted = <Target extends HTMLElement>(
  context: HintContext,
  concept: HintConcept,
  text: string,
  target: Target,
): [Target, HTMLElement] => {
  const id = `hint-${context.random.id()}`
  describedBy(target, id)
  const memberId = signedIn(context.state)?.member.id ?? ANYONE
  const { storage } = context.page
  const record = readHints(storage, memberId, context.clock.now())
  const remember = (change: typeof hintsAfterUse): void =>
    writeHints(storage, memberId, change(readHints(storage, memberId, context.clock.now()), concept))
  if (context.page.isCoarsePointer()) {
    if (!isInlineHintDue(record, concept, context.clock.now()) || !isFirstOnPage(context, concept))
      return [target, INTERACTIVE.has(target.localName) ? quietText(id, text) : shownOnTap(id, text, target)]
    const inline = inlineHint(id, text, () => {
      remember(hintsAfterDismiss)
      inline.remove()
    })
    target.addEventListener('click', () => {
      remember(hintsAfterUse)
      inline.remove()
    })
    return [target, inline]
  }
  const hint = h('span', { id, class: 'hint-tip', role: 'tooltip' }, text)
  if (!hasPopover(hint)) {
    hint.hidden = true
    return [target, hint]
  }
  target.addEventListener('click', () => {
    if (hint.matches(':popover-open')) hint.hidePopover()
  })
  if (context.page.supportsInterestInvokers() && INVOKERS.has(target.localName)) {
    hint.setAttribute('popover', 'hint')
    hint.classList.add('is-anchored')
    target.setAttribute('interestfor', id)
  } else showsOnRest(context, target, hint)
  return [target, hint]
}

const describedBy = (target: HTMLElement, id: string): void => {
  const before = target.getAttribute('aria-describedby')
  target.setAttribute('aria-describedby', before === null ? id : `${before} ${id}`)
}

const quietText = (id: string, text: string): HTMLElement =>
  h('span', { id, class: 'hint-tip', hidden: true }, text)

const inlineHint = (id: string, text: string, onClose: () => void): HTMLElement =>
  h(
    'p',
    { class: 'hint-inline', role: 'note' },
    h('span', { id }, text),
    h(
      'button',
      { type: 'button', class: 'hint-close', 'aria-label': strings.hintClose, on: { click: onClose } },
      '×',
    ),
  )

/**
 * A label that does nothing when pressed, such as a presence mark, shows its hint on its own line for a
 * tap on a touch screen, and hides it on the next.
 */
const shownOnTap = (id: string, text: string, target: HTMLElement): HTMLElement => {
  const hint = h('span', { id, class: 'hint-inline is-on-tap', role: 'note', hidden: true }, text)
  target.classList.add('has-tap-hint')
  target.addEventListener('click', () => {
    hint.hidden = !hint.hidden
  })
  return hint
}

const hasPopover = (element: HTMLElement): boolean =>
  typeof (element as { showPopover?: unknown }).showPopover === 'function'

/**
 * Shows the hint after the mouse or the keyboard focus rests on the control for a moment, beside the
 * control, and hides it when they leave, on Escape, or on a click. Focus that a press brought is not
 * the keyboard's, so it shows nothing.
 */
const showsOnRest = (context: HintContext, target: HTMLElement, hint: HTMLElement): void => {
  hint.setAttribute('popover', context.page.supportsHintPopovers() ? 'hint' : 'manual')
  let cancel = (): void => {}
  let stopListening = (): void => {}
  const isOpen = (): boolean => hint.matches(':popover-open')
  const hide = (): void => {
    cancel()
    if (isOpen()) hint.hidePopover()
  }
  const soon = (): void => {
    cancel()
    cancel = later(context.clock, HINT_DELAY_MS, () => {
      if (isOpen() || !target.isConnected) return
      hint.showPopover()
      place(context, target, hint)
    })
  }
  let pressed = false
  target.addEventListener('pointerenter', (event) => {
    if ((event as PointerEvent).pointerType === 'mouse') soon()
  })
  target.addEventListener('pointerleave', hide)
  target.addEventListener('pointerdown', () => {
    pressed = true
  })
  target.addEventListener('focusin', () => {
    if (!pressed) soon()
  })
  target.addEventListener('focusout', () => {
    pressed = false
    hide()
  })
  hint.addEventListener('toggle', (event) => {
    stopListening()
    stopListening = (): void => {}
    if ((event as ToggleEvent).newState !== 'open') return
    stopListening = context.document.listen('keydown', (press) => {
      if ((press as KeyboardEvent).key === 'Escape') hide()
    })
  })
}

/** Puts the hint under its control, or above it where there is no room below. */
const place = (context: HintContext, target: HTMLElement, hint: HTMLElement): void => {
  if (typeof hint.getBoundingClientRect !== 'function') return
  const box = hint.getBoundingClientRect()
  const root = context.document.root()
  const spot = menuPlacement({
    anchor: target.getBoundingClientRect(),
    menu: { width: box.width, height: box.height },
    viewport: { width: root.clientWidth, height: root.clientHeight },
    align: 'start',
  })
  hint.style.setProperty('--hb-hint-x', `${spot.x}px`)
  hint.style.setProperty('--hb-hint-y', `${spot.y}px`)
}

/**
 * A list shows a touch screen's inline hint beside its first row only: each concept is claimed once
 * while the page draws, and the claims clear on the next frame.
 */
const isFirstOnPage = (context: HintContext, concept: HintConcept): boolean => {
  const claimed = claims.get(context.page) ?? new Set<HintConcept>()
  if (claimed.has(concept)) return false
  if (claimed.size === 0) context.page.nextFrame(() => claims.delete(context.page))
  claimed.add(concept)
  claims.set(context.page, claimed)
  return true
}

const claims = new WeakMap<object, Set<HintConcept>>()

/** What a hint needs of a view's context: who is signed in, the clock, ids, the page and the document. */
export type HintContext = Pick<ViewContext, 'state' | 'clock' | 'random' | 'page' | 'document'>

/** Who the hints are kept for before anyone has signed in. */
const ANYONE = 'anyone'

/** Controls a press already acts on, so a touch screen shows their hint inline, never on a tap. */
const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label'])

/** The elements an interest invoker can be. */
const INVOKERS = new Set(['button', 'a'])
