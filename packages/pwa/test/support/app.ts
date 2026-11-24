import { Task as T, makeTestClock } from '@homingbird/kernel'
import type { Api, ApiError } from '@homingbird/protocol'
import { type App, createApp } from '../../src/app.ts'
import { createState } from '../../src/state.ts'
import { fakePage } from './context.ts'

type Handlers = { readonly [Name in keyof Api]?: (request: Parameters<Api[Name]>[0]) => unknown }

/** A route called by a task under test, with what it was asked. */
export interface Sent {
  readonly route: string
  readonly request: unknown
}

/**
 * An app whose server answers from the given handlers: a handler's value is the answer, a value with
 * an error `_tag` from `fail` is a refusal, and a route without a handler answers an empty object.
 */
export const testApp = (handlers: Handlers = {}, hash = '#/') => {
  const sent: Sent[] = []
  const aborted: string[] = []
  const api = new Proxy({} as Api, {
    get: (_, route) => (request: unknown) =>
      T.suspend(() => {
        sent.push({ route: String(route), request })
        const handler = (handlers as Record<string, ((request: unknown) => unknown) | undefined>)[
          String(route)
        ]
        const answer = handler === undefined ? {} : handler(request)
        if (isWaiting(answer))
          return T.flatMap((late: unknown) => (isRefusal(late) ? T.fail(late.refusal) : T.succeed(late)))(
            T.promise(
              (signal) =>
                new Promise((resolve) => {
                  signal.addEventListener('abort', () => aborted.push(String(route)), { once: true })
                  void answer.waitFor.then(resolve)
                }),
            ),
          )
        return isRefusal(answer) ? T.fail(answer.refusal) : T.succeed(answer)
      }),
  })
  const page = fakePage(hash)
  const clock = makeTestClock(Date.UTC(2026, 10, 19, 12))
  const launched: string[] = []
  const app = createApp(
    { clock, api, state: createState(hash), page: page.page, random: { id: () => 'page-id', seed: () => 7 } },
    T.sync(() => void launched.push('after conflict')),
  )
  const run = <A>(task: T.Task<A, ApiError, App>) => T.run(task, app)
  const routes = (): string[] => sent.map((one) => one.route)
  return { app, api, sent, aborted, routes, page, clock, run, launched, state: app.state }
}

/** A refusal for a handler to answer with. */
export const fail = (error: ApiError) => ({ refusal: error })

/** An answer that comes only when the test says so: `hold()` gives it with the call that releases it. */
export const hold = <A>(): { readonly waiting: unknown; readonly release: (answer: A) => void } => {
  let release: (answer: A) => void = () => {}
  const waitFor = new Promise<A>((resolve) => {
    release = resolve
  })
  return { waiting: { waitFor }, release }
}

const isWaiting = (answer: unknown): answer is { readonly waitFor: Promise<unknown> } =>
  typeof answer === 'object' && answer !== null && 'waitFor' in answer

const isRefusal = (answer: unknown): answer is { readonly refusal: ApiError } =>
  typeof answer === 'object' && answer !== null && 'refusal' in answer

/** Lets launched tasks finish. */
export const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
