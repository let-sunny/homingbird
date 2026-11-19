import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { strings } from '../src/strings.ts'

const listeners = new Map<string, (event: unknown) => void>()
const cache = { addAll: vi.fn(() => Promise.resolve()), put: vi.fn(() => Promise.resolve()) }
const cached = new Map<string, Response>()
const shown: Array<{ title: string; options: { body: string; data: { url: string } } }> = []
const windows: Array<{
  url: string
  navigate: (url: string) => Promise<unknown>
  focus: () => Promise<unknown>
}> = []
const opened: string[] = []

beforeAll(async () => {
  vi.stubGlobal('BUILD_ID', 'b1')
  vi.stubGlobal('addEventListener', (type: string, listener: (event: unknown) => void) =>
    listeners.set(type, listener),
  )
  vi.stubGlobal('caches', {
    open: () => Promise.resolve(cache),
    keys: () => Promise.resolve(['homingbird-shell-b1', 'homingbird-shell-old']),
    delete: vi.fn(() => Promise.resolve(true)),
    match: (request: Request | string) =>
      Promise.resolve(cached.get(typeof request === 'string' ? request : new URL(request.url).pathname)),
  })
  vi.stubGlobal(
    'skipWaiting',
    vi.fn(() => Promise.resolve()),
  )
  vi.stubGlobal('clients', {
    claim: vi.fn(() => Promise.resolve()),
    matchAll: () => Promise.resolve(windows),
    openWindow: (url: string) => {
      opened.push(url)
      return Promise.resolve(null)
    },
  })
  vi.stubGlobal('registration', {
    showNotification: (title: string, options: never) => {
      shown.push({ title, options })
      return Promise.resolve()
    },
  })
  vi.stubGlobal('location', { origin: 'https://homingbird.example' })
  await import('../src/service-worker.ts')
})

afterAll(() => vi.unstubAllGlobals())

const waiting = () => {
  const promises: Array<Promise<unknown>> = []
  return {
    waitUntil: (promise: Promise<unknown>) => promises.push(promise),
    settled: () => Promise.all(promises),
  }
}

describe('the service worker', () => {
  it('caches the shell when installed, and drops older caches when activated', async () => {
    const install = waiting()
    listeners.get('install')!(install)
    await install.settled()
    expect(cache.addAll).toHaveBeenCalled()
    const activate = waiting()
    listeners.get('activate')!(activate)
    await activate.settled()
  })

  it('answers the shell from the network first, and from the cache while offline', async () => {
    const respond = (url: string, method = 'GET') => {
      let answered: Promise<Response> | null = null
      listeners.get('fetch')!({
        request: new Request(url, { method }),
        respondWith: (answer: Promise<Response>) => (answered = answer),
      })
      return answered as Promise<Response> | null
    }
    expect(respond('https://other.example/app.js')).toBeNull()
    expect(respond('https://homingbird.example/api/v1/me')).toBeNull()
    expect(respond('https://homingbird.example/app.js', 'POST')).toBeNull()
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('fresh')))
    expect(await (await respond('https://homingbird.example/app.js')!).text()).toBe('fresh')
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('missing', { status: 404 })))
    expect((await respond('https://homingbird.example/app.js')!).status).toBe(404)
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    cached.set('/', new Response('shell'))
    expect(await (await respond('https://homingbird.example/people')!).text()).toBe('shell')
    cached.set('/app.js', new Response('cached app'))
    expect(await (await respond('https://homingbird.example/app.js')!).text()).toBe('cached app')
    cached.clear()
    expect((await respond('https://homingbird.example/people')!).type).toBe('error')
  })

  it('shows a push as a notification, in words of its own when the push brings none', async () => {
    const push = (data: unknown) => {
      const event = waiting()
      listeners.get('push')!({ ...event, data })
      return event.settled()
    }
    await push({ json: () => ({ title: 'Ben', body: 'Hello', url: '/#/c/1' }) })
    await push(null)
    await push({ json: () => ({ title: 3 }) })
    await push({
      json: () => {
        throw new Error('not json')
      },
    })
    expect(shown.map((one) => [one.title, one.options.body, one.options.data.url])).toEqual([
      ['Ben', 'Hello', '/#/c/1'],
      [strings.appName, strings.pushFallback, '/'],
      [strings.appName, strings.pushFallback, '/'],
      [strings.appName, strings.pushFallback, '/'],
    ])
  })

  it('opens the note a notification is about, in an open window or a new one', async () => {
    const click = (url: unknown) => {
      const event = waiting()
      listeners.get('notificationclick')!({
        ...event,
        notification: { close: vi.fn(), data: url === undefined ? undefined : { url } },
      })
      return event.settled()
    }
    await click('/#/c/1')
    expect(opened).toEqual(['https://homingbird.example/#/c/1'])
    const focus = vi.fn(() => Promise.resolve(null))
    windows.push({ url: 'https://homingbird.example/', navigate: () => Promise.resolve({ focus }), focus })
    await click(undefined)
    expect(focus).toHaveBeenCalled()
    windows[0] = { url: 'https://homingbird.example/', navigate: () => Promise.resolve(null), focus }
    await click('/#/c/2')
    windows[0] = {
      url: 'https://homingbird.example/',
      navigate: () => Promise.reject(new Error('gone')),
      focus,
    }
    await click('/#/c/3')
    expect(opened.at(-1)).toBe('https://homingbird.example/#/c/3')
  })
})
