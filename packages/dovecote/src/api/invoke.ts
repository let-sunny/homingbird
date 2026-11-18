import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  type Api,
  type ApiError,
  type Contract,
  Forbidden,
  Invalid,
  type RequestOf,
  type ResponseOf,
  type RouteName,
  Unauthorized,
  allows,
  contract,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { type Handlers, handlers } from './handlers.ts'

export interface RawRequest {
  readonly params: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly body: unknown
}

export const invokeRaw = (
  name: RouteName,
  raw: RawRequest,
  caller: Caller | null,
): T.Task<unknown, ApiError, AppEnv> =>
  T.gen(function* () {
    const route = contract[name]
    yield* requireAccess(name, caller)
    const query = route.query === undefined ? undefined : yield* decoded(S.struct(route.query), raw.query)
    const body = route.body === undefined ? undefined : yield* decoded(route.body, raw.body ?? {})
    const request = {
      params: raw.params,
      ...(query !== undefined && { query }),
      ...(body !== undefined && { body }),
    }
    return yield* invoke(name, request as RequestOf<Contract[typeof name]>, caller)
  })

export const invoke = <N extends RouteName>(
  name: N,
  request: RequestOf<Contract[N]>,
  caller: Caller | null,
): T.Task<ResponseOf<Contract[N]>, ApiError, AppEnv> =>
  T.gen(function* () {
    yield* requireAccess(name, caller)
    const handler = handlers[name] as unknown as (
      request: unknown,
      caller: Caller | null,
    ) => ReturnType<Handlers[N]>
    const audited = T.tap((response: ResponseOf<Contract[N]>) =>
      isRecorded(name) ? recordAudit(auditOf(name, request, response, caller)) : T.unit,
    )(handler(request, caller))
    return yield* isLongRunning(name)
      ? (T.provide({ outbox: [], audited: [] })(audited) as T.Task<ResponseOf<Contract[N]>, ApiError, AppEnv>)
      : transact(audited as T.Task<ResponseOf<Contract[N]>, ApiError, RequestEnv>)
  })

export const localApi = (caller: Caller, env: AppEnv): Api =>
  Object.fromEntries(
    (Object.keys(contract) as RouteName[]).map((name) => [
      name,
      (request: never) => T.provide(env)(invoke(name, request, caller)),
    ]),
  ) as unknown as Api

export const recordDenied = (name: RouteName, caller: Caller | null): T.Task<void, never, AppEnv> =>
  transact(recordAudit({ caller, action: `denied:${name}` }))

const requireAccess = (
  name: RouteName,
  caller: Caller | null,
): T.Task<void, Unauthorized | Forbidden, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    yield* requireAllowed(name, caller)
    const needsPerson = contract[name].access === 'human' || contract[name].access === 'admin'
    if (needsPerson && caller?.credential.approveButton === true && !env.config.approveButton) {
      yield* recordDenied(name, caller)
      return yield* T.fail(Forbidden({ message: APPROVE_BUTTON_OFF }))
    }
  })

const APPROVE_BUTTON_OFF = 'The organization has turned the approve button off.'

const requireAllowed = (
  name: RouteName,
  caller: Caller | null,
): T.Task<void, Unauthorized | Forbidden, AppEnv> => {
  const access = contract[name].access
  const facts = caller === null ? null : { kind: caller.credential.kind, role: caller.member.role }
  if (allows(access, facts)) return T.unit
  if (caller === null) return T.fail(Unauthorized({ message: 'Sign in to continue.' }))
  const message =
    access === 'admin'
      ? 'Only an administrator can do this.'
      : 'Only a person can do this; agent credentials are refused.'
  return T.flatMap(() => T.fail(Forbidden({ message })))(recordDenied(name, caller))
}

const decoded = <A>(schema: S.Schema<A>, input: unknown): T.Task<A, Invalid> => {
  const result = schema.decode(input)
  return result._tag === 'Ok'
    ? T.succeed(result.value)
    : T.fail(Invalid({ message: S.formatIssues(result.error) }))
}

const isLongRunning = (name: RouteName): boolean => name === 'events.poll'

const isRecorded = (name: RouteName): boolean => contract[name].method !== 'GET'

const auditOf = (name: RouteName, request: unknown, response: unknown, caller: Caller | null) => {
  const { params, body } = request as { params?: Readonly<Record<string, string>>; body?: unknown }
  const note = isNoteLike(response)
    ? { id: response.id, status: response.status, body: response.body }
    : undefined
  return {
    caller,
    action: name,
    target: note?.id ?? Object.values(params ?? {})[0] ?? null,
    detail: {
      ...(params && { params }),
      ...(body !== undefined && { request: body }),
      ...(note && { note }),
    },
  }
}

const isNoteLike = (value: unknown): value is { id: string; status: string; body: string } =>
  typeof value === 'object' && value !== null && 'body' in value && 'status' in value && 'authorId' in value
