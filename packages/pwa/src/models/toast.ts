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

/** How long a notice stays before it closes by itself. */
export const NOTICE_MS = 6000

export interface ToastModel {
  readonly className: string
  readonly role: 'alert' | 'status'
  readonly text: string
  readonly link: { readonly href: string; readonly label: string } | null
  readonly close: string
}
