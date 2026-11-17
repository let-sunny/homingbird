import { Task as T } from '@homingbird/kernel'
import {
  API_PREFIX,
  type ApiError,
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
import { LIMITS } from './rate-limiter.ts'

export const handleApiRequest = (request: HttpRequest): T.Task<HttpResponse, never, AppEnv> =>
  T.fold(
    (error: ApiError) => apiFailure(error),
    (value: unknown) => json(200, value),
  )(
    T.gen(function* () {
      const matched = routeFor(request)
      if (matched === null) return yield* T.fail(NotFound({ message: 'No such API route.' }))
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

const requireWithinLimits = (name: RouteName, caller: Caller | null): T.Task<void, RateLimited, AppEnv> =>
  T.flatMap((env: AppEnv) =>
    name === 'drafts.create' &&
    caller !== null &&
    !env.rateLimiter.allow(`draft:${caller.credential.id}`, LIMITS.drafting)
      ? T.fail(RateLimited({ message: 'Too many drafts in a short time. Try again in a minute.' }))
      : T.unit,
  )(T.ask<AppEnv>())
