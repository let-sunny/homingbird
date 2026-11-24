import type { Fetch } from '@homingbird/client'
import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  API_PREFIX,
  type ApiError,
  FEATURE_OFF_MESSAGE,
  Forbidden,
  HTTP_STATUS,
  Invalid,
  type MemberId,
  NotFound,
  type RouteName,
  STREAM_PATHS,
  type StreamEvent,
  Unavailable,
  contract,
  featureOfRoute,
  matchPath,
  toErrorBody,
} from '@homingbird/protocol'
import { DEMO_FEATURES } from './account-handlers.ts'
import { DEMO_REFUSAL, type Handlers, handlersOf } from './handlers.ts'
import { memberById } from './reads.ts'
import { VISITOR_ID } from './team.ts'
import type { World } from './world.ts'

/**
 * A Dovecote that lives in the page: a `fetch` that answers the API contract from the in-memory world,
 * as the viewer, and holds the viewer's event stream. Requests are decoded as strictly as the real
 * server decodes them, and every answer is checked against the contract before it is sent.
 */
export const fakeDovecote = (world: World, viewerId: MemberId = VISITOR_ID): Fetch => {
  const handlers = handlersOf(world)
  return (url, init) => {
    const target = new URL(url, PAGE_BASE)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (target.pathname === STREAM_PATHS.sse) return Promise.resolve(eventStreamOf(world, viewerId, init))
    if (target.pathname === BRANDING_PATH) return Promise.resolve(json(200, BRANDING))
    if (target.pathname === LOGOUT_PATH) return Promise.resolve(json(200, {}))
    const match = target.pathname.startsWith(API_PREFIX)
      ? routeFor(method, target.pathname.slice(API_PREFIX.length))
      : null
    if (match === null) return Promise.resolve(refusal(NotFound({ message: 'No such route.' })))
    const raw = { params: match.params, query: Object.fromEntries(target.searchParams), body: init?.body }
    return T.run(answer(world, handlers, match.name, raw, viewerId)).then((exit) =>
      exit._tag === 'Ok'
        ? json(200, exit.value)
        : refusal(
            exit.error._tag === 'Fail' ? exit.error.error : Unavailable({ message: String(exit.error) }),
          ),
    )
  }
}

/** What the page shows as the organization: Homingbird's own name and mark, from beside the page. */
export const BRANDING = { name: 'Homingbird', logo: 'icons/mark.svg' } as const

interface RawRequest {
  readonly params: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly body: unknown
}

const answer = (
  world: World,
  handlers: Handlers,
  name: RouteName,
  raw: RawRequest,
  viewerId: MemberId,
): T.Task<unknown, ApiError> =>
  T.gen(function* () {
    const route = contract[name]
    if (route.access === 'admin' && memberById(world.records(), viewerId)?.role !== 'admin')
      return yield* T.fail(Forbidden({ message: 'Only an administrator can do this.' }))
    const feature = featureOfRoute(name)
    if (feature !== null && !DEMO_FEATURES.includes(feature))
      return yield* T.fail(NotFound({ message: FEATURE_OFF_MESSAGE }))
    const query = route.query === undefined ? undefined : yield* decoded(S.struct(route.query), raw.query)
    const body = route.body === undefined ? undefined : yield* decoded(route.body, yield* parsed(raw.body))
    const handler = handlers[name] as
      | ((request: unknown, viewerId: MemberId) => T.Task<unknown, ApiError>)
      | undefined
    if (handler === undefined) return yield* T.fail(DEMO_REFUSAL)
    const answered = yield* handler(
      { params: raw.params, ...(query !== undefined && { query }), ...(body !== undefined && { body }) },
      viewerId,
    )
    const checked = route.response.decode(answered)
    return checked._tag === 'Ok'
      ? answered
      : yield* T.fail(
          Unavailable({
            message: `The demo answered ${name} outside the contract: ${S.formatIssues(checked.error)}`,
          }),
        )
  })

const routeFor = (
  method: string,
  path: string,
): { name: RouteName; params: Record<string, string> } | null => {
  for (const name of Object.keys(contract) as RouteName[]) {
    const route = contract[name]
    if (route.method !== method) continue
    const params = matchPath(route.path, path)
    if (params !== null) return { name, params }
  }
  return null
}

const decoded = <A>(schema: S.Schema<A, unknown>, input: unknown): T.Task<A, Invalid> => {
  const result = schema.decode(input)
  return result._tag === 'Ok'
    ? T.succeed(result.value)
    : T.fail(Invalid({ message: S.formatIssues(result.error) }))
}

const parsed = (body: unknown): T.Task<unknown, Invalid> =>
  T.suspend(() => {
    if (body === undefined || body === null) return T.succeed({})
    try {
      return T.succeed(JSON.parse(String(body)) as unknown)
    } catch {
      return T.fail(Invalid({ message: 'The body is not JSON.' }))
    }
  })

/**
 * The viewer's server-sent events: those kept since the `last-event-id` the client sends, then each one
 * as it happens, until the client lets go of the stream.
 */
const eventStreamOf = (world: World, viewerId: MemberId, init: RequestInit | undefined): Response => {
  const after = Number(new Headers(init?.headers).get('last-event-id') ?? 0)
  const encoder = new TextEncoder()
  let stop = (): void => {}
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const send = (event: StreamEvent): void => controller.enqueue(encoder.encode(frameOf(event)))
      controller.enqueue(encoder.encode(': connected\n\n'))
      for (const event of world.eventsAfter(viewerId, Number.isSafeInteger(after) ? after : 0)) send(event)
      const unlisten = world.listen(viewerId, send)
      stop = () => {
        unlisten()
        stop = () => {}
        controller.close()
      }
      init?.signal?.addEventListener('abort', () => stop(), { once: true })
    },
    cancel: () => stop(),
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const frameOf = (event: StreamEvent): string =>
  `id: ${event.seq}\nevent: ${event.body.type}\ndata: ${JSON.stringify(event)}\n\n`

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const refusal = (error: ApiError): Response => json(HTTP_STATUS[error._tag], toErrorBody(error))

/** Only a path matters to the demo; this base turns a relative address into one it can read. */
const PAGE_BASE = 'http://demo.invalid'
const BRANDING_PATH = '/branding.json'
const LOGOUT_PATH = '/auth/logout'
