import type { NoteId } from '@homingbird/protocol'
import { type Lifetime, h, later, region } from '@homingbird/ui'
import { HOLD_MS, HOLD_SECONDS, type HeldLine, countdownText, undoableHeld } from '../held-decisions.ts'
import { type HeldToastModel, SETTLED_MS, heldToastModel } from '../models/toast.ts'
import type { HeldDecision } from '../state.ts'
import type { ViewContext } from './context.ts'
import { button } from './parts.ts'

/**
 * The send or discard the person just made, with Undo, while it waits, then that it was carried out. It is
 * asked of the server when its moment is over, when the person presses Done, and when the page is hidden
 * or closed, so leaving never loses it. The toast sits in the top layer, above the activity panel and
 * dialogs; while the panel is open the panel shows it instead, so that pressing Undo keeps it open.
 */
export const heldToast = (context: ViewContext, life: Lifetime): HTMLElement => {
  const { state, actions, page, clock } = context
  const commit = (): void => actions.commitHeld(HELD)
  let waitingNow: HeldDecision | null = null
  let cancelHold = (): void => {}
  let cancelTick = (): void => {}
  let cancelSettled = (): void => {}
  const tick = (): void => {
    const left = state.heldSecondsLeft.get() - 1
    state.heldSecondsLeft.set(Math.max(left, 1))
    if (left > 1) cancelTick = later(clock, SECOND_MS, tick)
  }
  const host = heldToastRegion(context, life, 'toast-host held-host')
  host.id = HELD_TOAST_ID
  host.setAttribute('popover', 'manual')
  life.add(
    state.held.subscribe((all) => {
      const waiting = undoableHeld(all)
      if (waiting !== waitingNow) {
        cancelHold()
        cancelTick()
        waitingNow = waiting
        state.heldSecondsLeft.set(HOLD_SECONDS)
        cancelHold = waiting === null ? () => {} : later(clock, HOLD_MS, commit)
        cancelTick = waiting === null ? () => {} : later(clock, SECOND_MS, tick)
      }
      cancelSettled()
      cancelSettled =
        all.at(-1)?.phase === 'done' ? later(clock, SETTLED_MS, actions.forgetSettled) : () => {}
      showWhenHeld(context, host, all)
      page.nextFrame(() => showWhenHeld(context, host, state.held.get()))
    }),
  )
  page.nextFrame(() => showWhenHeld(context, host, state.held.get()))
  life.add(() => {
    cancelHold()
    cancelTick()
    cancelSettled()
  })
  life.add(page.on('pagehide', commit))
  life.add(page.on('visibilitychange', () => !page.isVisible() && commit()))
  return host
}

/**
 * The same toast as a line at the foot of the activity panel, for as long as the panel is open, unless
 * the panel already shows the decision's own line.
 */
export const heldToastInPanel = (context: ViewContext, life: Lifetime): HTMLElement => {
  const host = heldToastRegion(context, life, 'held-host in-panel')
  const reflect = (): void => {
    const latest = context.state.held.get().at(-1)
    host.hidden = latest !== undefined && isLineShown(context, latest)
  }
  life.add(context.state.held.subscribe(() => context.page.nextFrame(reflect)))
  context.page.nextFrame(reflect)
  return host
}

/** Moves the toast into the activity panel while it is open, and back to the top layer once it closes. */
export const placeHeldToast = (context: ViewContext, inPanel: boolean): void => {
  const host = context.document.byId(HELD_TOAST_ID)
  if (host === null) return
  if (inPanel) host.setAttribute('data-in-panel', '')
  else host.removeAttribute('data-in-panel')
  showWhenHeld(context, host, context.state.held.get())
}

/**
 * A draft or answer decided a moment ago, drawn in its card's place until it is carried out: no card
 * vanishes, and Undo is where the person was looking.
 */
export const renderHeldLine = (context: ViewContext, line: HeldLine): HTMLElement =>
  h(
    'li',
    { class: line.className, role: 'status', data: { heldUnit: line.noteId } },
    line.countdown === null ? h('span', {}, line.text) : countingDown(context, line.countdown),
    line.undo !== null &&
      button(line.undo, () => undoAndRefocus(context, line.noteId), { class: 'held-undo' }),
  )

/** The line's sentence for each second left; it stops following the seconds once it left the page. */
const countingDown = (context: ViewContext, words: ReadonlyArray<string>): HTMLElement => {
  const { heldSecondsLeft } = context.state
  const text = h('span', {}, countdownText(words, heldSecondsLeft.get()))
  const stop = heldSecondsLeft.subscribe((seconds) => {
    if (text.isConnected) text.textContent = countdownText(words, seconds)
    else stop()
  })
  return text
}

const heldToastRegion = (context: ViewContext, life: Lifetime, className: string): HTMLElement =>
  region(
    life,
    [context.state.held, context.state.heldSecondsLeft],
    () => {
      const model = heldToastModel(context.state.held.get(), context.state.heldSecondsLeft.get())
      return model !== null && renderHeldToast(context, model)
    },
    { class: className },
  )

const renderHeldToast = (context: ViewContext, model: HeldToastModel): HTMLElement => {
  const { actions, state } = context
  const waiting = undoableHeld(state.held.get())
  return h(
    'div',
    { class: model.className, role: 'status' },
    h('span', {}, model.text),
    model.undo !== null &&
      waiting !== null &&
      button(model.undo, () => undoAndRefocus(context, waiting.noteId), { class: 'held-undo' }),
    model.dismiss !== null &&
      button(
        model.dismiss.label,
        model.dismiss.does === 'commit' ? () => actions.commitHeld(HELD) : () => actions.forgetSettled(),
        { class: 'held-dismiss' },
      ),
  )
}

/** Undoes the held decision and gives the focus back to the card it brings back. */
const undoAndRefocus = (context: ViewContext, noteId: NoteId): void => {
  context.actions.undoHeld()
  context.page.nextFrame(() => context.document.find(`[data-decides="${noteId}"]`)?.focus())
}

/**
 * The toast shows while a decision is held, except where the decision's own line already says it on
 * screen: the thread or the activity panel shows that line in the card's place, with its own Undo.
 */
const showWhenHeld = (context: ViewContext, host: HTMLElement, held: ReadonlyArray<HeldDecision>): void => {
  if (typeof (host as { showPopover?: unknown }).showPopover !== 'function') return
  const latest = held.at(-1)
  const shown =
    latest !== undefined &&
    !host.hasAttribute('data-in-panel') &&
    host.isConnected &&
    !isLineShown(context, latest)
  if (shown === host.matches(':popover-open')) return
  if (shown) host.showPopover()
  else host.hidePopover()
}

const isLineShown = (context: ViewContext, decision: HeldDecision): boolean =>
  context.document.find(`[data-held-unit="${decision.noteId}"]`)?.checkVisibility() === true

const SECOND_MS = 1000

/** A held decision reports a refusal as a draft's, once it reaches the server. */
const HELD = { attempt: 'draft' } as const

const HELD_TOAST_ID = 'held-toast'
