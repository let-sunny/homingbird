import { Task as T } from '@homingbird/kernel'
import {
  API_PREFIX,
  type ApiError,
  CHARACTER_BYTES_MAX,
  Invalid,
  NotFound,
  RateLimited,
  type RouteName,
  contract,
  matchPath,
} from '@homingbird/protocol'
import { invokeRaw } from '../api/invoke.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { callerOf } from './authenticate.ts'
import { type HttpRequest, type HttpResponse, INVALID_JSON, apiFailure, json, parseJson } from './exchange.ts'
import { LIMITS, type Limit } from './rate-limiter.ts'

export const handleApiRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.fold(
    (error: ApiError) => apiFailure(error),
    (value: unknown) => json(200, value),
  )(
    T.gen(function* () {
      const matched = routeFor(request)
      if (matched === null) return yield* T.fail(NotFound({ message: 'No such API route.' }))
      const limit = BODY_LIMITS[matched.name]
      if (limit !== undefined && new TextEncoder().encode(request.body).length > limit)
        return yield* T.fail(Invalid({ message: `The request body is larger than ${limit} bytes.` }))
      const body = parseJson(request.body)
      if (body === INVALID_JSON)
        return yield* T.fail(Invalid({ message: 'The request body is not valid JSON.' }))
      const caller = yield* callerOf(request)
      yield* requireWithinLimits(matched.name, caller)
      return yield* invokeRaw(
        matched.name,
        { params: matched.params, query: Object.fromEntries(request.query), body },
        caller,
      )
    }),
  )

export const routeFor = (
  request: Pick<HttpRequest, 'method' | 'path'>,
): { readonly name: RouteName; readonly params: Record<string, string> } | null => {
  for (const name of Object.keys(contract) as RouteName[]) {
    const route = contract[name]
    if (route.method !== request.method) continue
    const params = matchPath(`${API_PREFIX}${route.path}`, request.path)
    if (params !== null) return { name, params }
  }
  return null
}

const BODY_LIMITS: Partial<Record<RouteName, number>> = { 'me.character.set': CHARACTER_BYTES_MAX }

const requireWithinLimits = (name: RouteName, caller: Caller | null): T.Task<void, RateLimited, AppEnv> =>
  T.flatMap((env: AppEnv) => {
    const limited = ROUTE_LIMITS[name]
    return limited !== undefined &&
      caller !== null &&
      !env.rateLimiter.allow(limited.key(caller), limited.limit)
      ? T.fail(RateLimited({ message: limited.message }))
      : T.unit
  })(T.ask<AppEnv>())

/** Each test wake starts a session the person pays for, so a few an hour are enough to check a setup. */
const ROUTE_LIMITS: Partial<
  Record<
    RouteName,
    { readonly limit: Limit; readonly key: (caller: Caller) => string; readonly message: string }
  >
> = {
  'drafts.create': {
    limit: LIMITS.drafting,
    key: (caller) => `draft:${caller.credential.id}`,
    message: 'Too many drafts in a short time. Try again in a minute.',
  },
  'me.deskWake.test': {
    limit: LIMITS.wakeTest,
    key: (caller) => `wake-test:${caller.credential.id}`,
    message: 'Too many test wakes in an hour. Try again later.',
  },
}
