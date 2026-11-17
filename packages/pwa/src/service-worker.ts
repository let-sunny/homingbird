import { strings } from './strings.ts'

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
  event.waitUntil(
    worker.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/mark-64.png',
      data: { url: payload.url },
    }),
  )
})

worker.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(String(event.notification.data?.url ?? '/'), worker.location.origin).href
  event.waitUntil(
    worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(worker.location.origin))
      return open === undefined
        ? worker.clients.openWindow(url)
        : open.navigate(url).then((client) => client?.focus())
    }),
  )
})

const pushPayload = (data: PushMessageData | null): { title: string; body: string; url: string } => {
  const fallback = { title: strings.appName, body: strings.pushFallback, url: '/' }
  try {
    const parsed = data?.json() as Partial<typeof fallback> | undefined
    return {
      title: typeof parsed?.title === 'string' ? parsed.title : fallback.title,
      body: typeof parsed?.body === 'string' ? parsed.body : fallback.body,
      url: typeof parsed?.url === 'string' ? parsed.url : fallback.url,
    }
  } catch {
    return fallback
  }
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
