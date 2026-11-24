import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  API_PREFIX,
  type Api,
  type ApiError,
  ErrorBody,
  type Route,
  type RouteName,
  Unavailable,
  contract,
  fillPath,
  fromErrorBody,
  fromStatus,
} from '@homingbird/protocol'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface HttpApiOptions {
  readonly serverUrl: string
  readonly fetch?: Fetch
  readonly token?: () => string | null
  readonly sendsCookies?: boolean
}

/** Whether a refusal was read from an answer the server did not write, as a proxy's own 404 page. */
export const isForeignAnswer = (error: ApiError): boolean => foreignAnswers.has(error)

export const SAME_SITE_HEADER = 'x-homingbird-request'

export const httpApi = (options: HttpApiOptions): Api =>
  Object.fromEntries(
    (Object.keys(contract) as RouteName[]).map((name) => [
      name,
      (request: RouteRequest = {}) => callRoute(options, contract[name], request),
    ]),
  ) as unknown as Api

export const authorizationHeaders = (
  options: Pick<HttpApiOptions, 'token' | 'sendsCookies'>,
): Record<string, string> => {
  const token = options.token?.() ?? null
  return {
    ...(token !== null && { authorization: `Bearer ${token}` }),
    ...(options.sendsCookies && { [SAME_SITE_HEADER]: '1' }),
  }
}

interface RouteRequest {
  readonly params?: Readonly<Record<string, string>>
  readonly query?: Readonly<Record<string, string | undefined>>
  readonly body?: unknown
}

const callRoute = (options: HttpApiOptions, route: Route, request: RouteRequest): T.Task<unknown, ApiError> =>
  T.gen(function* () {
    const body = route.body === undefined ? undefined : JSON.stringify(request.body ?? {})
    const response = yield* T.tryPromise(
      (signal) =>
        (options.fetch ?? globalThis.fetch)(urlFor(options.serverUrl, route, request), {
          method: route.method,
          headers: {
            ...authorizationHeaders(options),
            ...(body !== undefined && { 'content-type': 'application/json' }),
          },
          ...(body !== undefined && { body }),
          ...(options.sendsCookies && { credentials: 'same-origin' as const }),
          ...(route.method !== 'GET' && (body?.length ?? 0) <= KEEPALIVE_BODY_MAX && { keepalive: true }),
          signal,
        }),
      () => Unavailable({ message: 'The Homingbird server could not be reached.' }),
    )
    const payload = yield* T.tryPromise(
      () => response.json() as Promise<unknown>,
      () => foreign(response.status, `The server answered ${response.status} without a readable body.`),
    )
    if (!response.ok) return yield* T.fail(errorFrom(response.status, payload))
    const decoded = route.response.read(payload)
    return decoded._tag === 'Ok'
      ? decoded.value
      : yield* T.fail(
          Unavailable({
            message: `The server sent an unexpected response: ${S.formatIssues(decoded.error)}`,
          }),
        )
  })

const urlFor = (serverUrl: string, route: Route, request: RouteRequest): string => {
  const query = new URLSearchParams(
    Object.entries(request.query ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
  ).toString()
  const path = fillPath(route.path, request.params ?? {})
  return `${serverUrl.replace(/\/+$/, '')}${API_PREFIX}${path}${query === '' ? '' : `?${query}`}`
}

const errorFrom = (status: number, payload: unknown): ApiError => {
  const body = ErrorBody.decode(payload)
  return body._tag === 'Ok' ? fromErrorBody(body.value) : foreign(status, `The server answered ${status}.`)
}

const foreign = (status: number, message: string): ApiError => {
  const error = fromStatus(status, message)
  foreignAnswers.add(error)
  return error
}

const foreignAnswers = new WeakSet<ApiError>()

/**
 * A change is sent with `keepalive` so that one asked for as the page closes still reaches the server;
 * browsers refuse it for a body over 64 KiB in all, so a large one goes without.
 */
const KEEPALIVE_BODY_MAX = 32 * 1024
