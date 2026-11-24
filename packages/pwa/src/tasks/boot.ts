import { Iter, Schedule, Task as T } from '@homingbird/kernel'
import { type ApiError, type AsRead, UNKNOWN, upgradeNeeded } from '@homingbird/protocol'
import { trackSignIn } from '../analytics.ts'
import { type Action, type App, withApp } from '../app.ts'
import { keptComposerTexts } from '../composer-texts.ts'
import { preferredLanguage } from '../languages.ts'
import { QUIET_RETRY_SECONDS, TOO_LONG_LOAD_SECONDS } from '../load-timing.ts'
import { firstScreenRefusal, refusalText } from '../refusals.ts'
import { strings, useLanguage } from '../strings.ts'
import { followEvents, latestEvent } from './events.ts'
import { reportUnsettled } from './held.ts'
import { reportVisibility } from './presence.ts'
import { growingSlow, untilChanged, untilPageEvent } from './waiting-for.ts'
import { loadBranding, loadWorkspace } from './workspace.ts'

/**
 * Starts the page in two phases. First the branding, the server and the person, which the page cannot
 * draw without: a failure that waiting may mend is repeated, the page says when this takes longer than
 * usual and then offers to try again, and the attempt goes on behind that offer. Then the workspace, with
 * the page already drawn, which is kept loading until it has loaded.
 */
export const boot: Action = T.gen(function* () {
  const { state, page } = yield* T.ask<App>()
  state.start.set('loading')
  state.startRetrying.set(false)
  const known = yield* T.result(identifyWatched)
  if (known._tag === 'Err') return yield* giveUp(known.error)
  if (known.value._tag === 'restart') return yield* boot
  if (known.value._tag === 'upgrade')
    return state.notice.set({ kind: 'error', text: strings.upgrade[known.value.side] })
  if (known.value._tag === 'signed-out') return state.session.set(null)
  const { me, after } = known.value
  useLanguage(preferredLanguage(me.locale === UNKNOWN ? undefined : me.locale, page.languages()))
  state.composerTexts.set(keptComposerTexts(page.storage, me.member.id))
  state.workspace.set('loading')
  state.session.set(me)
  yield* keepLoadingWorkspace(after)
})

/**
 * What the person's Try again asks for: a start that gave up begins again; a start that is only slow ends
 * and begins again; a workspace that is slow or failed loads again. Never two at once.
 */
export const startAgain: Action = withApp(({ state }) =>
  T.suspend(() => {
    if (state.session.get() === 'loading') {
      const start = state.start.get()
      if (start === 'failed' || start === 'refused') {
        state.start.set('loading')
        return boot
      }
      if (start === 'long') state.startRestarts.update((count) => count + 1)
      return T.unit
    }
    const workspace = state.workspace.get()
    if (workspace === 'long' || workspace === 'failed') state.workspaceRestarts.update((count) => count + 1)
    return T.unit
  }),
)

type Known =
  | { readonly _tag: 'upgrade'; readonly side: 'client' | 'server' }
  | { readonly _tag: 'signed-out' }
  | { readonly _tag: 'ready'; readonly me: AsRead.Me; readonly after: number }

const RESTART = { _tag: 'restart' } as const
const AGAIN = (): typeof RESTART => RESTART

/** One start of phase one, with the clock telling the page how long it takes and Try again able to end it. */
const identifyWatched: Action<Known | typeof RESTART> = T.scoped((scope) =>
  T.gen(function* () {
    const { state } = yield* T.ask<App>()
    yield* scope.fork(growingSlow((step) => state.start.set(step)))
    return yield* T.race([identifyWithRetries, T.map(AGAIN)(untilChanged(state.startRestarts))])
  }),
)

const identifyWithRetries: Action<Known> = T.suspend(() =>
  T.retry({ schedule: startWaits, while: isTransient })(T.tapError((_: ApiError) => noteRetrying)(identify)),
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

/**
 * Keeps loading the workspace until it has loaded, the page already drawn. A load that takes longer says so
 * and then offers to try again while it goes on; Try again ends it and loads afresh. One that failed after
 * its repeats stays told until a load works: it loads again when the network is back and, for a server that was
 * away, every so often. Live events start once the load is done or has taken too long, never before: events that
 * arrive during a load would be overwritten by its older answers. A load that finishes with events already live
 * is loaded once more, quietly, which starts after those events and so ends the state current.
 */
const keepLoadingWorkspace = (after: number): Action =>
  T.gen(function* () {
    const { state } = yield* T.ask<App>()
    const events = { live: false }
    const startLive: Action = T.suspend(() => {
      if (events.live) return T.unit
      events.live = true
      return T.gen(function* () {
        yield* trackSignIn
        yield* followEvents(after)
        yield* reportVisibility
      })
    })
    let toldOnce = false
    let quiet = false
    for (;;) {
      if (!quiet) state.workspace.set('loading')
      const attempt = yield* T.scoped((scope) =>
        T.gen(function* () {
          if (!quiet) yield* scope.fork(growingSlow((step) => state.workspace.set(step), startLive))
          return yield* T.race([
            T.result(workspaceWithRetries),
            T.map(AGAIN)(untilChanged(state.workspaceRestarts)),
          ])
        }),
      )
      if (attempt._tag === 'restart') {
        quiet = false
        continue
      }
      if (attempt._tag === 'Ok') {
        const mayBeOlderThanEvents = events.live
        state.workspace.set('loaded')
        yield* startLive
        if (mayBeOlderThanEvents) yield* loadAgainQuietly
        yield* T.result(reportUnsettled)
        return
      }
      if (attempt.error._tag === 'Unauthorized') return state.session.set(null)
      state.workspaceRefusal.set(isTransient(attempt.error) ? '' : refusalText(attempt.error))
      state.workspace.set('failed')
      if (!toldOnce) state.notice.set({ kind: 'error', text: refusalText(attempt.error) })
      toldOnce = true
      yield* startLive
      const woken = yield* T.race([
        T.map(AGAIN)(untilChanged(state.workspaceRestarts)),
        untilPageEvent('online'),
        isTransient(attempt.error) ? quietRetryTimer : T.never,
      ])
      quiet = woken === 'quiet'
    }
  })

/** One more load that says nothing and gives up quietly: what the first one showed stays if this one fails. */
const loadAgainQuietly: Action = T.asUnit(T.result(T.timeout(TOO_LONG_LOAD_SECONDS * 1000)(loadWorkspace)))

const quietRetryTimer: Action<'quiet'> = T.map(() => 'quiet' as const)(T.sleep(QUIET_RETRY_SECONDS * 1000))

const workspaceWithRetries: Action = T.suspend(() =>
  T.retry({ schedule: startWaits, while: isTransient })(loadWorkspace),
)

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

const noteRetrying: Action = withApp(({ state }) => T.sync(() => state.startRetrying.set(true)))

/** A server that stays away offers to try again; any other refusal says what it was and offers the same. */
const giveUp = (error: ApiError): Action =>
  withApp(({ state }) =>
    T.sync(() => {
      if (error._tag === 'Unauthorized') return state.session.set(null)
      if (isTransient(error)) return state.start.set('failed')
      state.startRefusal.set(firstScreenRefusal(error))
      state.start.set('refused')
    }),
  )

function isTransient(error: ApiError): boolean {
  return error._tag === 'Unavailable' || error._tag === 'RateLimited'
}

/** The waits between attempts: one, two, four and eight seconds, so a phase gives up after about fifteen. */
const startWaits = (): Iterable<number> => Iter.take(4)(Schedule.exponential(1000, 2, 8000))
