import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  type Api,
  type ApiError,
  type Contract,
  FEATURE_OFF_MESSAGE,
  Forbidden,
  Invalid,
  NotFound,
  ROUTE_AUDIT,
  type RequestOf,
  type ResponseOf,
  type RouteName,
  Unauthorized,
  allows,
  contract,
  featureOfRoute,
} from '@homingbird/protocol'
import { recordAudit } from '../domain/audit.ts'
import { noteDenied } from '../domain/denied-attempts.ts'
import { featureIsOn } from '../domain/settings.ts'
import type { AppEnv, Caller } from '../environment.ts'
import { type RequestEnv, transact } from '../events/events.ts'
import { AUDIT_DETAILS, type AuditFacts } from './audit-details.ts'
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
    yield* requireAllowed(name, caller)
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
    yield* requireAllowed(name, caller)
    yield* requireFeature(name)
    const handler = handlers[name] as unknown as (
      request: unknown,
      caller: Caller | null,
    ) => ReturnType<Handlers[N]>
    const audited = withAudit(name, request, caller, handler(request, caller))
    return yield* OWN_TRANSACTIONS.includes(name)
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
  return T.flatMap(() => T.fail(Forbidden({ message })))(noteDenied(caller, name))
}

const requireFeature = (name: RouteName): T.Task<void, NotFound, AppEnv> => {
  const feature = featureOfRoute(name)
  if (feature === null) return T.unit
  return T.flatMap((on: boolean) => (on ? T.unit : T.fail(NotFound({ message: FEATURE_OFF_MESSAGE }))))(
    featureIsOn(feature),
  )
}

const decoded = <A>(schema: S.Schema<A>, input: unknown): T.Task<A, Invalid> => {
  const result = schema.decode(input)
  return result._tag === 'Ok'
    ? T.succeed(result.value)
    : T.fail(Invalid({ message: S.formatIssues(result.error) }))
}

/**
 * Routes that open their own transactions: a long poll holds none while it waits, and the asks of a
 * debate room move each of the agent's rooms on in a transaction of its own before they are read, and a
 * test wake and a Slack link request hold none while they wait for the service they call.
 */
const OWN_TRANSACTIONS: ReadonlyArray<RouteName> = [
  'events.poll',
  'debates.waiting',
  'me.deskWake.test',
  'me.slack.connect',
]

/** Runs a handler and records its route's audit event, in the same transaction, when it succeeds. */
const withAudit = <A, E>(
  name: RouteName,
  request: unknown,
  caller: Caller | null,
  handled: T.Task<A, E, RequestEnv>,
): T.Task<A, E, RequestEnv> => {
  const decision = ROUTE_AUDIT[name]
  if (!('event' in decision) || caller === null) return handled
  const event = decision.event
  const describe = AUDIT_DETAILS[name as keyof typeof AUDIT_DETAILS] as unknown as (
    request: unknown,
    caller: Caller,
  ) => T.Task<(response: A) => AuditFacts<typeof event>, never, RequestEnv>
  return T.gen(function* () {
    const facts = yield* describe(request, caller)
    const response = yield* handled
    yield* recordAudit(event, { caller, ...facts(response) })
    return response
  })
}
