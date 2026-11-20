import type { Fetch } from '@homingbird/client'
import type { Unsubscribe } from '@homingbird/ui'

/** The browser around the document; views and tasks reach it only through this, so tests fake it. */
export const browserPage = (window: BrowserWindow): Page => {
  const { document, location } = window
  return {
    origin: location.origin,
    hash: () => location.hash,
    go: (href) => {
      location.hash = href
    },
    replace: (href) => location.replace(href),
    assign: (url) => location.assign(url),
    replaceAddress: (href) => window.history.replaceState(null, '', href),
    fetch: (url, init) => window.fetch(url, init),
    languages: () => window.navigator?.languages ?? [],
    isVisible: () => document.visibilityState === 'visible',
    on: (event, listener) => {
      const target = event === 'visibilitychange' ? document : window
      target.addEventListener(event, listener)
      return () => target.removeEventListener(event, listener)
    },
    nextFrame: (run) => void window.requestAnimationFrame(() => run()),
    prefersReducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true,
    pixelRatio: () => window.devicePixelRatio ?? 1,
    supportsAnchors: () => window.CSS?.supports?.('anchor-name: --a') === true,
    supportsPush: () =>
      window.navigator !== undefined &&
      'serviceWorker' in window.navigator &&
      'PushManager' in window &&
      'Notification' in window,
    shownNotifications: () =>
      Promise.resolve()
        .then(() => window.navigator?.serviceWorker?.getRegistration?.())
        .then((registration) => registration?.getNotifications() ?? [])
        .then((shown) =>
          shown.map((one) => ({
            tag: one.tag,
            shownAt: typeof one.timestamp === 'number' ? one.timestamp : null,
            close: () => one.close(),
          })),
        )
        .catch(() => []),
    supportsHintPopovers: () => {
      const probe = document.createElement('div')
      probe.setAttribute('popover', 'hint')
      return (probe as { popover?: unknown }).popover === 'hint'
    },
    storage: {
      local: (key) => attempt(() => window.localStorage.getItem(key)),
      setLocal: (key, value) => void attempt(() => window.localStorage.setItem(key, value)),
      removeLocal: (key) => void attempt(() => window.localStorage.removeItem(key)),
      session: (key) => attempt(() => window.sessionStorage.getItem(key)),
      setSession: (key, value) => void attempt(() => window.sessionStorage.setItem(key, value)),
    },
    download: (file) => {
      const url = window.URL.createObjectURL(new window.Blob([file.text], { type: file.mediaType }))
      const link = document.createElement('a')
      link.href = url
      link.download = file.filename
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      window.requestAnimationFrame(() => window.URL.revokeObjectURL(url))
    },
    readText: (file) => file.text(),
    watchInView: (root, onChange) => {
      const observer = new window.IntersectionObserver(
        (entries) =>
          onChange(
            entries.map((entry) => ({ target: entry.target as HTMLElement, isInView: entry.isIntersecting })),
          ),
        { root, threshold: IN_VIEW_SHARE },
      )
      return {
        observe: (element) => observer.observe(element),
        unobserve: (element) => observer.unobserve(element),
        disconnect: () => observer.disconnect(),
      }
    },
  }
}

export interface Page {
  readonly origin: string
  readonly hash: () => string
  /** Goes to an address within the app, adding a history entry. */
  readonly go: (href: string) => void
  /** Goes to an address, replacing the current history entry. */
  readonly replace: (href: string) => void
  /** Loads another page, such as a sign-out or an agent's return address. */
  readonly assign: (url: string) => void
  readonly replaceAddress: (href: string) => void
  readonly fetch: Fetch
  readonly languages: () => ReadonlyArray<string>
  readonly isVisible: () => boolean
  readonly on: (event: PageEvent, listener: () => void) => Unsubscribe
  readonly nextFrame: (run: () => void) => void
  readonly prefersReducedMotion: () => boolean
  readonly pixelRatio: () => number
  readonly supportsAnchors: () => boolean
  /** Whether this browser can subscribe to push notifications. */
  readonly supportsPush: () => boolean
  /** The notifications this app shows on this device; none where it has no service worker. */
  readonly shownNotifications: () => Promise<ReadonlyArray<ShownNotification>>
  /** Whether popovers of the `hint` kind exist, which leave other open popovers alone. */
  readonly supportsHintPopovers: () => boolean
  readonly storage: PageStorage
  readonly download: (file: DownloadedFile) => void
  /** The text of a file the person chose, read in this browser only. */
  readonly readText: (file: Blob) => Promise<string>
  readonly watchInView: (root: HTMLElement, onChange: (entries: ReadonlyArray<InView>) => void) => InViewWatch
}

export interface ShownNotification {
  readonly tag: string
  /** When the notification appeared, where the browser says. */
  readonly shownAt: number | null
  readonly close: () => void
}

export type PageEvent = 'online' | 'offline' | 'visibilitychange' | 'hashchange' | 'resize'

/** Kept in this browser only; every call is safe when storage is blocked. */
export interface PageStorage {
  readonly local: (key: string) => string | null
  readonly setLocal: (key: string, value: string) => void
  readonly removeLocal: (key: string) => void
  readonly session: (key: string) => string | null
  readonly setSession: (key: string, value: string) => void
}

export interface DownloadedFile {
  readonly text: string
  readonly mediaType: string
  readonly filename: string
}

export interface InView {
  readonly target: HTMLElement
  readonly isInView: boolean
}

export interface InViewWatch {
  readonly observe: (element: HTMLElement) => void
  readonly unobserve: (element: HTMLElement) => void
  readonly disconnect: () => void
}

/** The parts of a browser window the page uses. */
export interface BrowserWindow {
  readonly document: Pick<
    Document,
    'visibilityState' | 'createElement' | 'body' | 'addEventListener' | 'removeEventListener'
  >
  readonly location: Pick<Location, 'origin' | 'hash' | 'replace' | 'assign'>
  readonly history: Pick<History, 'replaceState'>
  readonly navigator?: Pick<Navigator, 'languages'> & {
    readonly serviceWorker?: { readonly getRegistration?: () => Promise<NotificationSource | undefined> }
  }
  readonly fetch: Fetch
  readonly addEventListener: (type: string, listener: () => void) => void
  readonly removeEventListener: (type: string, listener: () => void) => void
  readonly requestAnimationFrame: (run: () => void) => unknown
  readonly matchMedia?: (query: string) => { readonly matches: boolean }
  readonly devicePixelRatio?: number
  readonly CSS?: { readonly supports?: (condition: string) => boolean }
  readonly localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  readonly sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
  readonly URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
  readonly Blob: typeof Blob
  readonly IntersectionObserver: typeof IntersectionObserver
}

/** A service worker registration, as far as the page reads the notifications it shows. */
export interface NotificationSource {
  readonly getNotifications: () => Promise<
    ReadonlyArray<{ readonly tag: string; readonly timestamp?: number; readonly close: () => void }>
  >
}

/** Share of an item that must show for it to count as in view. */
export const IN_VIEW_SHARE = 0.6

const attempt = <A>(read: () => A): A | null => {
  try {
    return read()
  } catch {
    return null
  }
}
