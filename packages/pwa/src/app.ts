import { type Clock, type HasClock, Task as T } from '@homingbird/kernel'
import type { Api, ApiError } from '@homingbird/protocol'
import type { Page } from './browser-page.ts'
import { type Attempt, refusalText } from './refusals.ts'
import type { AppState } from './state.ts'

/** The services a page runs its tasks with; after a conflict, `afterConflict` brings the list up to date. */
export const createApp = (parts: Omit<App, 'launch'>, afterConflict: Action): App => {
  const app: App = {
    ...parts,
    launch: (action, then) =>
      void T.run(action, app).then((exit) => {
        if (exit._tag === 'Ok') return then?.done?.(exit.value)
        if (exit.error._tag === 'Fail') {
          then?.failed?.(exit.error.error)
          return reportFailure(app, exit.error.error, then?.attempt, afterConflict)
        }
        if (exit.error._tag === 'Die')
          app.state.notice.set({ kind: 'error', text: String(exit.error.defect) })
      }),
  }
  return app
}

export interface App extends HasClock {
  readonly clock: Clock
  readonly api: Api
  readonly state: AppState
  readonly page: Page
  readonly random: Random
  readonly launch: Launch
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

const reportFailure = (
  app: App,
  error: ApiError,
  attempt: Attempt | undefined,
  afterConflict: Action,
): void => {
  if (error._tag === 'Unauthorized') {
    app.state.session.set(null)
    return
  }
  app.state.notice.set({ kind: 'error', text: refusalText(error, attempt) })
  if (error._tag === 'Conflict') app.launch(afterConflict)
}
