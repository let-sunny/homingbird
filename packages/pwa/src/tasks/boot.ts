import { Iter, Schedule, Task as T } from '@homingbird/kernel'
import { type ApiError, type AsRead, UNKNOWN, upgradeNeeded } from '@homingbird/protocol'
import { trackSignIn } from '../analytics.ts'
import { type Action, type App, withApp } from '../app.ts'
import { keptComposerTexts } from '../composer-texts.ts'
import { preferredLanguage } from '../languages.ts'
import { refusalText } from '../refusals.ts'
import { strings, useLanguage } from '../strings.ts'
import { followEvents, latestEvent } from './events.ts'
import { reportUnsettled } from './held.ts'
import { reportVisibility } from './presence.ts'
import { loadBranding, loadWorkspace } from './workspace.ts'

/**
 * Starts the page in two phases. First the branding, the server and the person, which the page cannot
 * draw without: a failure that waiting may mend is repeated, and one that persists gives the page a way to
 * try again. Then the workspace, with the page already drawn: a failure shows a notice, and the workspace
 * loads again when the network is back. Whatever the workspace did, live events follow.
 */
export const boot: Action = T.gen(function* () {
  const app = yield* T.ask<App>()
  const { state, page } = app
  state.start.set('loading')
  const known = yield* T.result(identifyWithRetries)
  if (known._tag === 'Err') return yield* giveUp(known.error)
  if (known.value._tag === 'upgrade')
    return state.notice.set({ kind: 'error', text: strings.upgrade[known.value.side] })
  if (known.value._tag === 'signed-out') return state.session.set(null)
  const { me, after } = known.value
  useLanguage(preferredLanguage(me.locale === UNKNOWN ? undefined : me.locale, page.languages()))
  state.composerTexts.set(keptComposerTexts(page.storage, me.member.id))
  state.session.set(me)
  const workspace = yield* T.result(workspaceWithRetries)
  if (workspace._tag === 'Err') {
    if (workspace.error._tag === 'Unauthorized') return state.session.set(null)
    state.notice.set({ kind: 'error', text: refusalText(workspace.error) })
    loadWorkspaceWhenOnline(app)
  }
  yield* trackSignIn
  yield* T.result(reportUnsettled)
  yield* followEvents(after)
  yield* reportVisibility
})

/** Starts again after the page gave up; nothing happens while a start is under way or once it worked. */
export const startAgain: Action = withApp(({ state }) =>
  T.suspend(() => {
    if (state.start.get() !== 'failed' && state.start.get() !== 'refused') return T.unit
    state.start.set('loading')
    return boot
  }),
)

type Known =
  | { readonly _tag: 'upgrade'; readonly side: 'client' | 'server' }
  | { readonly _tag: 'signed-out' }
  | { readonly _tag: 'ready'; readonly me: AsRead.Me; readonly after: number }

const identifyWithRetries: Action<Known> = T.suspend(() =>
  T.retry({ schedule: startWaits, while: isTransient })(T.tapError((_: ApiError) => noteSlowStart)(identify)),
)

const workspaceWithRetries: Action = T.suspend(() =>
  T.retry({ schedule: startWaits, while: isTransient })(loadWorkspace),
)

/** Reads only, and nothing is drawn until it is done, so a whole attempt may be repeated. */
const identify: Action<Known> = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  state.branding.set(yield* loadBranding)
  const info = yield* serverInfo
  const side = upgradeNeeded(info)
  if (side !== null) return { _tag: 'upgrade', side } as const
  const me = yield* signedInPerson
  if (me === null) return { _tag: 'signed-out' } as const
  const after = yield* latestEvent
  return { _tag: 'ready', me, after } as const
})

const serverInfo: Action<AsRead.ServerInfo> = withApp(({ api, state }) =>
  T.map((info: AsRead.ServerInfo) => {
    state.serverInfo.set(info)
    return info
  })(api['server.info']({})),
)

/** Nobody signed in is an answer, not a failure. */
const signedInPerson: Action<AsRead.Me | null> = withApp(({ api }) =>
  T.catchTag('Unauthorized', () => T.succeed(null))(api['me.get']({})),
)

const noteSlowStart: Action = withApp(({ state }) => T.sync(() => state.start.set('slow')))

/** A server that stays away offers to try again; any other refusal says what it was and offers the same. */
const giveUp = (error: ApiError): Action =>
  withApp(({ state }) =>
    T.sync(() => {
      if (error._tag === 'Unauthorized') return state.session.set(null)
      if (isTransient(error)) return state.start.set('failed')
      state.startRefusal.set(refusalText(error))
      state.start.set('refused')
    }),
  )

/** The page is drawn without its workspace; the first time the network comes back it is loaded, once. */
const loadWorkspaceWhenOnline = (app: App): void => {
  let loading = false
  const stop = app.page.on('online', () => {
    if (loading) return
    loading = true
    app.launch(loadWorkspace, {
      done: stop,
      failed: () => {
        loading = false
      },
    })
  })
}

function isTransient(error: ApiError): boolean {
  return error._tag === 'Unavailable' || error._tag === 'RateLimited'
}

/** The waits between attempts: one, two, four and eight seconds, so a phase gives up after about fifteen. */
const startWaits = (): Iterable<number> => Iter.take(4)(Schedule.exponential(1000, 2, 8000))
