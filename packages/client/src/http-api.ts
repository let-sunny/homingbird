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
    const response = yield* T.tryPromise(
      (signal) =>
        (options.fetch ?? globalThis.fetch)(urlFor(options.serverUrl, route, request), {
          method: route.method,
          headers: {
            ...authorizationHeaders(options),
            ...(route.body !== undefined && { 'content-type': 'application/json' }),
          },
          ...(route.body !== undefined && { body: JSON.stringify(request.body ?? {}) }),
          ...(options.sendsCookies && { credentials: 'same-origin' as const }),
          signal,
        }),
      () => Unavailable({ message: 'The Homingbird server could not be reached.' }),
    )
    const payload = yield* T.tryPromise(
      () => response.json() as Promise<unknown>,
      () => fromStatus(response.status, `The server answered ${response.status} without a readable body.`),
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
  return body._tag === 'Ok' ? fromErrorBody(body.value) : fromStatus(status, `The server answered ${status}.`)
}
