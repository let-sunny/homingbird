import { fakeDocument, fakeEvent } from '@homingbird/ui/testing'
import { describe, expect, it, vi } from 'vitest'
import { type BrowserWindow, IN_VIEW_SHARE, browserPage } from '../src/browser-page.ts'

const fakeWindow = (fields: Partial<Record<keyof BrowserWindow, unknown>> = {}) => {
  const document = fakeDocument()
  const listeners = new Map<string, () => void>()
  const location = { origin: 'https://homingbird.example', hash: '#/', replace: vi.fn(), assign: vi.fn() }
  const observed: unknown[] = []
  const window = {
    document,
    location,
    history: { replaceState: vi.fn() },
    navigator: { languages: ['ko-KR'] },
    fetch: vi.fn(() => Promise.resolve(new Response('ok'))),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    requestAnimationFrame: (run: () => void) => run(),
    matchMedia: () => ({ matches: false }),
    devicePixelRatio: 2,
    CSS: { supports: () => true },
    localStorage: { getItem: () => 'kept', setItem: vi.fn(), removeItem: vi.fn() },
    sessionStorage: {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    },
    URL: { createObjectURL: () => 'blob:1', revokeObjectURL: vi.fn() },
    Blob,
    IntersectionObserver: vi.fn((callback: (entries: unknown[]) => void, options: unknown) => {
      observed.push(options)
      return {
        observe: (element: unknown) => callback([{ target: element, isIntersecting: true }]),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      }
    }),
    ...fields,
  }
  return { window: window as unknown as BrowserWindow, document, location, listeners, observed }
}

describe('browserPage', () => {
  it('reads and changes the address', () => {
    const { window, location } = fakeWindow()
    const page = browserPage(window)
    expect([page.origin, page.hash()]).toEqual(['https://homingbird.example', '#/'])
    page.go('#/people')
    expect(location.hash).toBe('#/people')
    page.replace('#/a')
    page.assign('/')
    page.replaceAddress('#/search?q=x')
    expect(location.replace).toHaveBeenCalledWith('#/a')
    expect(location.assign).toHaveBeenCalledWith('/')
    expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '#/search?q=x')
  })

  it('fetches, reads the languages, the visibility and the person’s preferences', async () => {
    const { window } = fakeWindow()
    const page = browserPage(window)
    expect(await (await page.fetch('/x')).text()).toBe('ok')
    expect(page.languages()).toEqual(['ko-KR'])
    expect(page.isVisible()).toBe(true)
    expect([
      page.prefersReducedMotion(),
      page.pixelRatio(),
      page.supportsAnchors(),
      page.supportsHintPopovers(),
    ]).toEqual([false, 2, true, false])
    expect(page.supportsPush()).toBe(false)
    const pushing = fakeWindow({
      navigator: { languages: [], serviceWorker: {} },
      PushManager: {},
      Notification: {},
    } as never)
    expect(browserPage(pushing.window).supportsPush()).toBe(true)
    const bare = browserPage(
      fakeWindow({ navigator: undefined, matchMedia: undefined, devicePixelRatio: undefined, CSS: undefined })
        .window,
    )
    expect([
      bare.languages(),
      bare.prefersReducedMotion(),
      bare.pixelRatio(),
      bare.supportsAnchors(),
      bare.supportsPush(),
    ]).toEqual([[], true, 1, false, false])
  })

  it('listens to the window and to the document’s visibility, and stops listening', () => {
    const { window, listeners, document } = fakeWindow()
    const page = browserPage(window)
    const online = vi.fn()
    const stop = page.on('online', online)
    listeners.get('online')!()
    stop()
    expect(listeners.has('online')).toBe(false)
    const visible = vi.fn()
    const stopVisible = page.on('visibilitychange', visible)
    document.dispatchEvent(fakeEvent('visibilitychange'))
    expect(visible).toHaveBeenCalled()
    stopVisible()
    expect(online).toHaveBeenCalled()
  })

  it('keeps values in storage and is safe when storage is blocked', () => {
    const { window } = fakeWindow()
    const { storage } = browserPage(window)
    expect(storage.local('a')).toBe('kept')
    storage.setLocal('a', 'b')
    storage.removeLocal('a')
    expect(storage.session('a')).toBeNull()
    storage.setSession('a', 'b')
  })

  it('runs on the next frame, downloads a file, and watches what comes into view', () => {
    const { window, observed } = fakeWindow()
    const page = browserPage(window)
    const ran = vi.fn()
    page.nextFrame(ran)
    expect(ran).toHaveBeenCalled()
    page.download({ text: '#', mediaType: 'text/markdown', filename: 'debate.md' })
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    const seen = vi.fn()
    const root = window.document.createElement('div')
    const watch = page.watchInView(root, seen)
    const element = window.document.createElement('li')
    watch.observe(element)
    watch.unobserve(element)
    watch.disconnect()
    expect(seen).toHaveBeenCalledWith([{ target: element, isInView: true }])
    expect(observed).toEqual([{ root, threshold: IN_VIEW_SHARE }])
  })
})
