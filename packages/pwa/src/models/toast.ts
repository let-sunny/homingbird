import type { HeldDecision, Notice } from '../state.ts'
import { strings } from '../strings.ts'

/** A notice as the toast shows it: an alert for an error, a status otherwise, with a link when it has one. */
export const toastModel = (notice: Notice | null): ToastModel | null =>
  notice === null
    ? null
    : {
        className: `toast is-${notice.kind}`,
        role: notice.kind === 'error' ? 'alert' : 'status',
        text: notice.text,
        link: notice.link ?? null,
        close: strings.close,
      }

/** A held send or discard as its toast shows it: what was done, a way to undo it, and a way to let it go now. */
export const heldToastModel = (held: Pick<HeldDecision, 'text'> | null): HeldToastModel | null =>
  held === null
    ? null
    : { className: 'toast is-held', text: held.text, undo: strings.undo, dismiss: strings.heldDismiss }

/** How long a send or discard can be undone before it is asked of the server. */
export const HOLD_MS = 5000

/** How long a notice stays before it closes by itself. */
export const NOTICE_MS = 6000

export interface ToastModel {
  readonly className: string
  readonly role: 'alert' | 'status'
  readonly text: string
  readonly link: { readonly href: string; readonly label: string } | null
  readonly close: string
}

export interface HeldToastModel {
  readonly className: string
  readonly text: string
  readonly undo: string
  readonly dismiss: string
}
