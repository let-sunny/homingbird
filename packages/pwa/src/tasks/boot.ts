import { Task as T } from '@homingbird/kernel'
import { type ApiError, type AsRead, UNKNOWN, upgradeNeeded } from '@homingbird/protocol'
import { trackSignIn } from '../analytics.ts'
import { type Action, type App, withApp } from '../app.ts'
import { keptComposerTexts } from '../composer-texts.ts'
import { preferredLanguage } from '../languages.ts'
import { STREAM_WAIT_SECONDS, growingSlow, retryWaits } from '../load-timing.ts'
import { firstScreenRefusal, isTransient } from '../refusals.ts'
import { strings, useLanguage } from '../strings.ts'
import { followEvents, latestEvent } from './events.ts'
import { reportVisibility } from './presence.ts'
import { ACTIVITY, WORKSPACE, open } from './resources.ts'
import { againWhatIsStuck } from './try-again.ts'
import { untilChanged, untilHolds } from './waiting-for.ts'
import { afterWorkspace, loadBranding } from './workspace.ts'

/**
 * Starts the page in two phases. First the branding, the server and the person, which the page cannot
 * draw without: a failure that waiting may mend is repeated, the page says when this takes longer than
 * usual and then offers to try again, and the attempt goes on behind that offer. Then, with the page already
 * drawn, the stream of events, and the lists once it is open: an event that comes while a list is on its way
 * is made again on the answer, and one sent once, before the list was asked for, is in it.
 */
export const boot: Action = T.gen(function* () {
  const { state, page, launch } = yield* T.ask<App>()
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
  state.stream.set('awaited')
  launch(open(...WORKSPACE, ...ACTIVITY))
  state.session.set(me)
  yield* followEvents(after)
  yield* trackSignIn
  yield* reportVisibility
  yield* untilStreamAnswers
  yield* afterWorkspace
})

/**
 * What the person's Try again asks for: a start that gave up begins again; a start that is only slow ends
 * and begins again; the lists of a workspace that is slow or failed are asked for again. Never two at once.
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
    if (workspace !== 'long' && workspace !== 'failed') return T.unit
    return againWhatIsStuck
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
  T.retry({ schedule: retryWaits, while: isTransient })(T.tapError((_: ApiError) => noteRetrying)(identify)),
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

/** Lets the lists be asked for once the stream answered, or failed, or is not waited for any longer. */
const untilStreamAnswers: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  const isLate = yield* T.race([
    T.map(() => false)(untilHolds(state.connection, (connection) => connection !== 'connecting')),
    T.map(() => true)(T.sleep(STREAM_WAIT_SECONDS * 1000)),
  ])
  state.stream.set(isLate ? 'late' : 'settled')
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
