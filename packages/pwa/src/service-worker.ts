import { preferredLanguage } from './languages.ts'
import { strings, useLanguage } from './strings.ts'

const worker = globalThis as unknown as ServiceWorkerGlobalScope
declare const BUILD_ID: string

const CACHE = `homingbird-shell-${BUILD_ID}`
const SHELL = [
  '/',
  '/app.js',
  '/app.css',
  '/pip.css',
  '/pip/pip-sheet.png',
  '/icons/mark.svg',
  '/manifest.webmanifest',
]
const NEVER_CACHED = [
  '/api/',
  '/auth/',
  '/oauth/',
  '/mcp',
  '/a2a',
  '/.well-known/',
  '/theme.css',
  '/branding.json',
]

worker.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => worker.skipWaiting()),
  )
})

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => worker.clients.claim()),
  )
})

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const isOurs = url.origin === worker.location.origin && event.request.method === 'GET'
  if (!isOurs || NEVER_CACHED.some((prefix) => url.pathname.startsWith(prefix))) return
  event.respondWith(networkFirst(event.request))
})

worker.addEventListener('push', (event) => {
  const payload = pushPayload(event.data)
  const options: NotificationOptions & { readonly renotify?: boolean } = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/mark-64.png',
    data: { url: payload.url },
    ...(payload.tag !== null && { tag: payload.tag, renotify: false }),
  }
  event.waitUntil(worker.registration.showNotification(payload.title, options))
})

worker.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(String(event.notification.data?.url ?? '/'), worker.location.origin).href
  event.waitUntil(
    worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(worker.location.origin))
      return open === undefined
        ? worker.clients.openWindow(url)
        : open
            .navigate(url)
            .then((client) => client?.focus() ?? open.focus())
            .catch(() => worker.clients.openWindow(url))
    }),
  )
})

/**
 * A push about one draft carries its tag, so a repeat replaces the notification instead of adding one, and
 * an open page closes it once someone decided the draft. A push must always show a notification
 * (`userVisibleOnly`), so no push ever arrives only to close one.
 */
const pushPayload = (data: PushMessageData | null): PushPayload => {
  useLanguage(preferredLanguage(undefined, worker.navigator.languages))
  const fallback: PushPayload = { title: strings.appName, body: strings.pushFallback, url: '/', tag: null }
  try {
    const parsed = data?.json() as Partial<Record<keyof PushPayload, unknown>> | undefined
    return {
      title: typeof parsed?.title === 'string' ? parsed.title : fallback.title,
      body: typeof parsed?.body === 'string' ? parsed.body : fallback.body,
      url: typeof parsed?.url === 'string' ? parsed.url : fallback.url,
      tag: typeof parsed?.tag === 'string' && parsed.tag !== '' ? parsed.tag : null,
    }
  } catch {
    return fallback
  }
}

interface PushPayload {
  readonly title: string
  readonly body: string
  readonly url: string
  readonly tag: string | null
}

const networkFirst = (request: Request): Promise<Response> =>
  fetch(request)
    .then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
      return response.clone()
    })
    .catch(() =>
      caches
        .match(request)
        .then((cached) => cached ?? caches.match('/'))
        .then((cached) => cached ?? Response.error()),
    )
