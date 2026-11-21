import type { HeldShown } from '../held-decisions.ts'
import type { Notice } from '../state.ts'
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

/**
 * The latest held send or discard as its toast shows it: pending until the server has it, with Undo and a
 * way to let it go now while it waits, then done, with a way to close it.
 */
export const heldToastModel = (held: ReadonlyArray<HeldShown>): HeldToastModel | null => {
  const latest = held.at(-1)
  if (latest === undefined) return null
  return {
    className: `toast is-held is-${latest.phase}`,
    text: latest.phase === 'done' ? latest.words.done : latest.words.pending,
    undo: latest.phase === 'waiting' ? strings.undo : null,
    dismiss:
      latest.phase === 'waiting'
        ? { label: strings.heldDismiss, does: 'commit' }
        : latest.phase === 'done'
          ? { label: strings.close, does: 'forget' }
          : null,
  }
}

/** How long a send or discard can be undone before it is asked of the server. */
export const HOLD_MS = 5000

/** How long the toast says a send or discard was carried out. */
export const SETTLED_MS = 3000

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
  readonly undo: string | null
  /** Done carries the decision out now; Close forgets the toast of one already carried out. */
  readonly dismiss: { readonly label: string; readonly does: 'commit' | 'forget' } | null
}
