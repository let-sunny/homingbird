import type { Unsubscribe } from '@homingbird/ui'

/**
 * The document a view may look at: the views build their own elements, and reach what is already on the
 * page, the focus and document-wide events only through this, so tests hand them a document of their own.
 */
export const browserDocument = (document: () => DocumentPart): PageDocument => ({
  byId: (id) => document().getElementById(id),
  find: (selector) => document().querySelector<HTMLElement>(selector),
  focused: () => document().activeElement,
  listen: (kind, listener, options) => {
    const target = document()
    target.addEventListener(kind, listener, options)
    return () => target.removeEventListener(kind, listener, options)
  },
  addToBody: (element) => void document().body.append(element),
  root: () => document().documentElement,
  inTransition: (change) => {
    const { startViewTransition } = document() as DocumentPart & {
      startViewTransition?: Document['startViewTransition']
    }
    if (startViewTransition === undefined) return false
    startViewTransition.call(document(), change).ready.catch(() => {})
    return true
  },
})

export interface PageDocument {
  readonly byId: (id: string) => HTMLElement | null
  readonly find: (selector: string) => HTMLElement | null
  /** The element that has the focus, if any. */
  readonly focused: () => Element | null
  readonly listen: (kind: string, listener: EventListener, options?: AddEventListenerOptions) => Unsubscribe
  readonly addToBody: (element: Element) => void
  /** The `<html>` element, where the appearance is set. */
  readonly root: () => HTMLElement
  /** Runs a change inside a view transition; false, without running it, when there are none. */
  readonly inTransition: (change: () => void) => boolean
}

export type DocumentPart = Pick<
  Document,
  | 'getElementById'
  | 'querySelector'
  | 'activeElement'
  | 'addEventListener'
  | 'removeEventListener'
  | 'body'
  | 'documentElement'
>
