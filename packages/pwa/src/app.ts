import { type Clock, type HasClock, Task as T } from '@homingbird/kernel'
import type { Api, ApiError } from '@homingbird/protocol'
import type { Page } from './browser-page.ts'
import { type Attempt, refusalText } from './refusals.ts'
import { type AppState, forgetSession, signedIn } from './state.ts'

/**
 * The services a page runs its tasks with; after a conflict, `afterConflict` brings the list up to date. A
 * session that ended never starts again here: signing in loads the page anew.
 */
export const createApp = (
  parts: Omit<App, 'launch' | 'ended' | 'endSession'>,
  afterConflict: Action,
): App => {
  const ending = new AbortController()
  const endSession = (): void => {
    if (ending.signal.aborted) return
    ending.abort()
    forgetSession(parts.state)
  }
  const app: App = {
    ...parts,
    api: endingRefusedSession(parts.api, parts.state, endSession),
    ended: ending.signal,
    endSession,
    launch: (action, then) => {
      if (ending.signal.aborted) return
      void T.run(action, app, ending.signal).then((exit) => {
        if (ending.signal.aborted) return
        if (exit._tag === 'Ok') return then?.done?.(exit.value)
        if (exit.error._tag === 'Fail') {
          then?.failed?.(exit.error.error)
          return reportFailure(app, exit.error.error, then?.attempt, afterConflict)
        }
        if (exit.error._tag === 'Die')
          app.state.notice.set({ kind: 'error', text: String(exit.error.defect) })
      })
    },
  }
  return app
}

export interface App extends HasClock {
  readonly clock: Clock
  readonly api: Api
  readonly state: AppState
  readonly page: Page
  readonly random: Random
  /** Starts a task that ends with the session; nothing starts once the session ended. */
  readonly launch: Launch
  /** Aborted when the session ends; whatever runs outside `launch` follows it. */
  readonly ended: AbortSignal
  /** Ends what the session runs and empties what it put in the state, so the page shows sign-in. */
  readonly endSession: () => void
}

export type Action<A = void> = T.Task<A, ApiError, App>

export type Launch = <A>(action: Action<A>, then?: Then<A>) => void

/** What to do once a launched task ends, and which attempt a refusal speaks of. */
export interface Then<A> {
  readonly done?: (value: A) => void
  readonly failed?: (error: ApiError) => void
  readonly attempt?: Attempt
}

export interface Random {
  readonly id: () => string
  readonly seed: () => number
}

/** Runs a step with the app it needs; the way a task reads its services. */
export const withApp = <A>(step: (app: App) => Action<A>): Action<A> => T.flatMap(step)(T.ask<App>())

/** The server's API, where a request refused because the person is no longer signed in ends the session. */
const endingRefusedSession = (api: Api, state: AppState, endSession: () => void): Api =>
  new Proxy(api, {
    get: (routes, name) => (request: never) =>
      T.catchAll((refused: ApiError) => {
        if (refused._tag !== 'Unauthorized' || signedIn(state) === null) return T.fail(refused)
        endSession()
        return T.interrupt
      })(routes[name as keyof Api](request) as T.Task<unknown, ApiError>),
  })

const reportFailure = (
  app: App,
  error: ApiError,
  attempt: Attempt | undefined,
  afterConflict: Action,
): void => {
  if (error._tag === 'Unauthorized') {
    app.endSession()
    return
  }
  app.state.notice.set({ kind: 'error', text: refusalText(error, attempt) })
  if (error._tag === 'Conflict') app.launch(afterConflict)
}
