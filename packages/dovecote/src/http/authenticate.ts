import { Task as T } from '@homingbird/kernel'
import { Forbidden, Unauthorized } from '@homingbird/protocol'
import { authenticate } from '../domain/credentials.ts'
import { noteRefused } from '../domain/denied-attempts.ts'
import type { AppEnv, Caller } from '../environment.ts'
import type { HttpRequest } from './exchange.ts'

export const SESSION_COOKIE = 'hb_session'
export const SAME_SITE_HEADER = 'x-homingbird-request'

export const callerOf = (request: HttpRequest): T.Task<Caller | null, Unauthorized | Forbidden, AppEnv> =>
  T.gen(function* () {
    const bearer = bearerToken(request)
    if (bearer !== null) return yield* authenticatedBy(bearer, request)
    const session = sessionToken(request)
    if (session === null) return null
    if (isStateChanging(request.method) && !(yield* cameFromOurOwnPage(request)))
      return yield* T.fail(
        Forbidden({ message: 'This request did not come from the Homingbird web client.' }),
      )
    return yield* authenticatedBy(session, request)
  })

export const bearerCallerOf = (request: HttpRequest): T.Task<Caller, Unauthorized, AppEnv> => {
  const bearer = bearerToken(request)
  return bearer === null
    ? T.fail(Unauthorized({ message: 'A bearer token is required.' }))
    : authenticatedBy(bearer, request)
}

export const sessionToken = (request: HttpRequest): string | null => cookies(request)[SESSION_COOKIE] ?? null

export const sessionCookie = (token: string, maxAgeSeconds: number, publicUrl: string): string =>
  [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(publicUrl.startsWith('https:') ? ['Secure'] : []),
  ].join('; ')

/** A refused token is counted, by credential or by a hash of it, never kept, before it is refused. */
const authenticatedBy = (token: string, request: HttpRequest): T.Task<Caller, Unauthorized, AppEnv> =>
  T.tapError((_: Unauthorized) => noteRefused(token, request.remoteAddress))(authenticate(token))

const bearerToken = (request: HttpRequest): string | null =>
  /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1] ?? null

const cookies = (request: HttpRequest): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((pair) => pair.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2),
  )

const isStateChanging = (method: string): boolean => method !== 'GET' && method !== 'HEAD'

const cameFromOurOwnPage = (request: HttpRequest): T.Task<boolean, never, AppEnv> =>
  T.map((env: AppEnv) => {
    const origin = request.headers.origin
    const sameOrigin = origin === undefined || origin === new URL(env.config.publicUrl).origin
    return sameOrigin && request.headers[SAME_SITE_HEADER] === '1'
  })(T.ask<AppEnv>())
