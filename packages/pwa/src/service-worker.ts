declare const self: ServiceWorkerGlobalScope
declare const BUILD_ID: string

const CACHE = `homingbird-shell-${BUILD_ID}`
const SHELL = ['/', '/app.js', '/app.css', '/icons/logo.svg', '/manifest.webmanifest']
const NEVER_CACHED = ['/api/', '/auth/', '/oauth/', '/mcp', '/a2a', '/.well-known/', '/theme.css', '/branding.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const isOurs = url.origin === self.location.origin && event.request.method === 'GET'
  if (!isOurs || NEVER_CACHED.some((prefix) => url.pathname.startsWith(prefix))) return
  event.respondWith(networkFirst(event.request))
})

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
