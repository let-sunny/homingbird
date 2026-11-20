import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Task as T } from '@homingbird/kernel'
import type { AppEnv } from '../environment.ts'
import { type HttpRequest, type HttpResponse, json, text } from './exchange.ts'

export const handleStaticRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed.')
    if (request.path === '/theme.css') return yield* themeStylesheet(env.config.themeDirectory)
    if (request.path === '/branding.json') return yield* branding(env.config.themeDirectory)
    if (request.path.startsWith(THEME_PREFIX))
      return (
        (yield* themeAsset(env.config.themeDirectory, request.path.slice(THEME_PREFIX.length - 1))) ??
        text(404, 'Not found.')
      )
    if (env.config.webDirectory === null) return text(404, 'The web client is not installed on this server.')
    const asset = yield* fileWithin(env.config.webDirectory, request.path)
    if (asset !== null) return unchangedSince(request, asset)
    const shell = yield* fileWithin(env.config.webDirectory, '/index.html')
    return shell === null ? text(404, 'Not found.') : unchangedSince(request, shell)
  })

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

const DEFAULT_BRANDING = { name: 'Homingbird', logo: null } as const

const THEME_PREFIX = '/theme/'

const THEME_ASSET_TYPES: ReadonlyArray<string> = ['.woff2', '.png', '.svg', '.jpg', '.jpeg', '.webp', '.ico']

const themeStylesheet = (themeDirectory: string | null): T.Task<HttpResponse, never, unknown> =>
  T.map((css: Buffer | null) =>
    served(css ?? Buffer.from('/* no organization theme */\n'), '.css', 'no-cache'),
  )(themeDirectory === null ? T.succeed(null) : read(join(themeDirectory, 'theme.css')))

const branding = (themeDirectory: string | null): T.Task<HttpResponse, never, unknown> =>
  T.map((file: Buffer | null) => {
    if (file === null) return json(200, DEFAULT_BRANDING)
    try {
      return json(200, { ...DEFAULT_BRANDING, ...JSON.parse(file.toString('utf8')) })
    } catch {
      return json(200, DEFAULT_BRANDING)
    }
  })(themeDirectory === null ? T.succeed(null) : read(join(themeDirectory, 'branding.json')))

const themeAsset = (
  themeDirectory: string | null,
  requestPath: string,
): T.Task<HttpResponse | null, never, unknown> =>
  themeDirectory === null || !THEME_ASSET_TYPES.includes(extname(requestPath).toLowerCase())
    ? T.succeed(null)
    : fileWithin(themeDirectory, requestPath)

const fileWithin = (directory: string, requestPath: string): T.Task<HttpResponse | null, never, unknown> => {
  const relative = normalize(decodeURIComponentSafely(requestPath)).replace(/^([/\\])+/, '')
  const path = join(directory, relative === '' ? 'index.html' : relative)
  if (!path.startsWith(join(directory, sep)) || extname(path) === '') return T.succeed(null)
  const extension = extname(path).toLowerCase()
  return T.map((file: Buffer | null) =>
    file === null
      ? null
      : served(
          file,
          extension,
          CHANGES_EACH_RELEASE.includes(extension) ? 'no-cache' : 'public, max-age=3600',
        ),
  )(read(path))
}

/** A 304 when the browser already holds this exact file, so revalidating the web client costs no download. */
const unchangedSince = (request: HttpRequest, response: HttpResponse): HttpResponse => {
  const tag = response.headers.etag
  return tag !== undefined && request.headers['if-none-match'] === tag
    ? {
        status: 304,
        headers: { etag: tag, 'cache-control': response.headers['cache-control'] ?? 'no-cache' },
        body: '',
      }
    : response
}

// The web client's files keep their names from one release to the next, so the browser must ask
// again each time; otherwise it would run the previous release's script against the new server.
const CHANGES_EACH_RELEASE: ReadonlyArray<string> = ['.html', '.js', '.css', '.webmanifest', '.json']

const served = (file: Buffer, extension: string, cacheControl: string): HttpResponse => ({
  status: 200,
  headers: {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': cacheControl,
    etag: `"${createHash('sha256').update(file).digest('base64url').slice(0, 27)}"`,
    ...SECURITY_HEADERS,
  },
  body: file,
})

const read = (path: string): T.Task<Buffer | null> =>
  T.catchAll(() => T.succeed(null))(
    T.tryPromise(
      () => readFile(path),
      () => 'missing' as const,
    ),
  )

const decodeURIComponentSafely = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return '/'
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}
