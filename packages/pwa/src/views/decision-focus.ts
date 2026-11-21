import type { NoteId } from '@homingbird/protocol'
import type { ViewContext } from './context.ts'

/**
 * Moves the focus on once a card is decided, so a keyboard or screen-reader user keeps their place in the
 * queue: to the next card waiting in the same list (the one before when it was the last), else to the
 * conversation's composer, else to the Undo of the line that took the card's place.
 */
export const focusAfterDecision = (context: ViewContext, card: Element | null, noteId: NoteId): void => {
  const scopeSelector = card?.closest(PANEL) != null ? PANEL : STAGE
  const scope = card?.closest(scopeSelector) ?? null
  const units = scope === null ? [] : [...scope.querySelectorAll(UNIT)]
  const unit = card?.closest(UNIT) ?? null
  const at = unit === null ? -1 : units.indexOf(unit)
  const next = at === -1 ? undefined : (units[at + 1] ?? units[at - 1])
  const nextId = next === undefined ? null : decidesOf(next)
  context.page.nextFrame(() => {
    const target =
      (nextId === null ? null : context.document.find(`${scopeSelector} [data-decides="${nextId}"]`)) ??
      (scopeSelector === STAGE ? context.document.find(`${STAGE} .composer textarea`) : null) ??
      context.document.find(`${scopeSelector} [data-held-unit="${noteId}"] .held-undo`)
    target?.focus()
  })
}

/**
 * The card a dialog decides, found when the dialog opens: the one the focus is in, as the button that
 * opened it has the focus where the browser gives it, else the first on the page.
 */
export const cardOf = (context: ViewContext, noteId: NoteId): Element | null =>
  context.document.focused()?.closest(`[data-decides="${noteId}"]`) ??
  context.document.find(`[data-decides="${noteId}"]`)

/** The card in a unit the focus goes to: the unit itself, or its first card when it holds alternatives. */
const decidesOf = (unit: Element): string | null =>
  unit.getAttribute('data-decides') ??
  unit.querySelector('[data-decides]')?.getAttribute('data-decides') ??
  null

const UNIT = '[data-decision-unit]'
const PANEL = '.activity-panel'
const STAGE = '.stage'
