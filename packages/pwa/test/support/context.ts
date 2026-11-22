import { makeTestClock } from '@homingbird/kernel'
import type { Unsubscribe } from '@homingbird/ui'
import type { Actions } from '../../src/actions.ts'
import type { InView, InViewWatch, Page, PageEvent } from '../../src/browser-page.ts'
import { browserDocument } from '../../src/page-document.ts'
import { createState } from '../../src/state.ts'
import type { ViewContext } from '../../src/views/context.ts'

/** A call a view made to an action, with its arguments and what it asked to happen afterwards. */
export interface ActionCall {
  readonly name: string
  readonly args: ReadonlyArray<unknown>
  readonly then:
    | {
        readonly done?: (value: unknown) => void
        readonly failed?: (error: unknown) => void
        readonly attempt?: string
      }
    | undefined
}

/** A view's context with fakes: every action is recorded, the page is scripted, the clock is a test clock. */
export const testContext = (hash = '#/') => {
  const calls: ActionCall[] = []
  const actions = new Proxy({} as Actions, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        const last = args.at(-1)
        const isThen =
          typeof last === 'object' &&
          last !== null &&
          ('done' in last || 'failed' in last || 'attempt' in last)
        calls.push({
          name: String(name),
          args: isThen ? args.slice(0, -1) : args,
          // biome-ignore lint/suspicious/noThenProperty: the record mirrors the `Then` argument actions take.
          then: isThen ? (last as ActionCall['then']) : undefined,
        })
      },
  })
  const page = fakePage(hash)
  const tour = { started: 0, homes: [] as string[] }
  const clock = makeTestClock(Date.UTC(2026, 10, 19, 12))
  const context: ViewContext = {
    state: createState(hash),
    actions,
    clock,
    random: { id: () => 'random-id', seed: () => 7 },
    page: page.page,
    document: browserDocument(() => globalThis.document),
    tour: { start: () => void tour.started++, startOnHome: (name) => void tour.homes.push(name) },
    justArrived: () => false,
  }
  const called = (name: string): ActionCall[] => calls.filter((call) => call.name === name)
  return { context, calls, called, page, tour, clock }
}

export type FakePage = ReturnType<typeof fakePage>

/** A page whose address, events, frames, storage and visibility the test controls. */
export const fakePage = (hash = '#/') => {
  const listeners = new Map<PageEvent, Set<() => void>>()
  const frames: Array<() => void> = []
  const local = new Map<string, string>()
  const session = new Map<string, string>()
  const watches: Array<{
    readonly root: HTMLElement
    readonly observed: Set<HTMLElement>
    readonly onChange: (entries: ReadonlyArray<InView>) => void
    disconnected: boolean
  }> = []
  const visited: string[] = []
  const downloads: Array<{ readonly filename: string }> = []
  const copied: string[] = []
  const notifications = new Map<string, number | null>()
  const outside: { title: string; badge: number | 'unread' | null } = { title: '', badge: null }
  const state = {
    apple: false,
    hash,
    visible: true,
    reducedMotion: true,
    coarsePointer: false,
    anchors: false,
    hint: true,
    push: false,
    clipboard: true,
  }
  const page: Page = {
    origin: 'http://localhost',
    hash: () => state.hash,
    go: (href) => {
      state.hash = href
      visited.push(`go ${href}`)
    },
    replace: (href) => {
      state.hash = href
      visited.push(`replace ${href}`)
    },
    assign: (url) => void visited.push(`assign ${url}`),
    replaceAddress: (href) => void visited.push(`address ${href}`),
    linkTo: (href) => `http://localhost/${href}`,
    fetch: () => Promise.reject(new Error('no network in unit tests')),
    languages: () => ['en-GB'],
    isApple: () => state.apple,
    showWaiting: (title, badge) => {
      outside.title = title
      outside.badge = badge
    },
    isVisible: () => state.visible,
    on: (event, listener): Unsubscribe => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    nextFrame: (run) => void frames.push(run),
    prefersReducedMotion: () => state.reducedMotion,
    isCoarsePointer: () => state.coarsePointer,
    pixelRatio: () => 1,
    supportsAnchors: () => state.anchors,
    supportsPush: () => state.push,
    supportsHintPopovers: () => state.hint,
    shownNotifications: () =>
      Promise.resolve(
        [...notifications].map(([tag, shownAt]) => ({
          tag,
          shownAt,
          close: () => void notifications.delete(tag),
        })),
      ),
    storage: {
      local: (key) => local.get(key) ?? null,
      setLocal: (key, value) => void local.set(key, value),
      removeLocal: (key) => void local.delete(key),
      session: (key) => session.get(key) ?? null,
      setSession: (key, value) => void session.set(key, value),
    },
    download: (file) => void downloads.push(file),
    copyText: (text) => {
      copied.push(text)
      return Promise.resolve(state.clipboard)
    },
    readText: (file) => file.text(),
    watchInView: (root, onChange): InViewWatch => {
      const watch = { root, observed: new Set<HTMLElement>(), onChange, disconnected: false }
      watches.push(watch)
      return {
        observe: (element) => void watch.observed.add(element),
        unobserve: (element) => void watch.observed.delete(element),
        disconnect: () => {
          watch.disconnected = true
        },
      }
    },
  }
  return {
    page,
    state,
    outside,
    visited,
    downloads,
    copied,
    notifications,
    local,
    session,
    watches,
    emit: (event: PageEvent) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener()
    },
    listening: (event: PageEvent) => listeners.get(event)?.size ?? 0,
    runFrames: () => {
      for (const run of frames.splice(0)) run()
    },
    /** Tells every watch that these elements came into view, or left it. */
    inView: (elements: ReadonlyArray<HTMLElement>, isInView = true) => {
      for (const watch of watches)
        watch.onChange(
          elements.filter((element) => watch.observed.has(element)).map((target) => ({ target, isInView })),
        )
    },
  }
}
