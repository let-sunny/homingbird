import { Task as T } from '@homingbird/kernel'
import { type Action, type App, withApp } from '../app.ts'
import type { Resource } from '../resource.ts'
import type { Branding } from '../state.ts'
import { loadAwaitedThreads } from './activity.ts'
import { reportUnsettled } from './held.ts'
import { closeSettledDraftNotices } from './notifications.ts'
import { untilHolds } from './waiting-for.ts'

/** What follows once the workspace was first read, among it telling of decisions never carried out. */
export const afterWorkspace: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  yield* untilHolds(state.workspace, (step) => step === 'loaded')
  yield* T.all([
    T.flatMap(() => followingWorkspace)(untilTold(state.awaitingReply)),
    T.result(T.flatMap(() => reportUnsettled)(untilTold(state.reviews))),
  ])
})

/** What follows each time the whole workspace was read: what the bell counts, and the notices of drafts settled elsewhere. */
export const followingWorkspace: Action = T.suspend(() =>
  T.asUnit(T.all([loadAwaitedThreads, T.result(closeNoticesOfSettledDrafts)])),
)

export const loadBranding: Action<Branding> = withApp(({ page, state }) =>
  T.catchAll(() => T.succeed(state.branding.get()))(
    T.gen(function* () {
      const response = yield* T.tryPromise(
        (signal) => page.fetch('/branding.json', { signal }),
        () => 'unavailable' as const,
      )
      const loaded = yield* T.tryPromise(
        () => response.json() as Promise<Partial<Branding>>,
        () => 'unavailable' as const,
      )
      return { name: typeof loaded.name === 'string' ? loaded.name : 'Homingbird', logo: loaded.logo ?? null }
    }),
  ),
)

/** Until the list was read, or failed and is not repeated at once. */
const untilTold = ({ load }: Pick<Resource<unknown>, 'load'>): Action =>
  untilHolds(load, ({ loaded, step }) => loaded || step === 'failed')

/** Clears notifications about drafts sent or discarded elsewhere; a browser without push shows none. */
const closeNoticesOfSettledDrafts: Action = T.gen(function* () {
  const { api, page, clock } = yield* T.ask<App>()
  if (!page.supportsPush()) return
  const requestedAt = clock.now()
  const { drafts } = yield* api['drafts.list']({})
  yield* closeSettledDraftNotices(
    drafts.map((draft) => draft.id),
    requestedAt,
  )
})
