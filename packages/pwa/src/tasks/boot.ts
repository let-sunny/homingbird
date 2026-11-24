import { Iter, Schedule, Task as T } from '@homingbird/kernel'
import { type ApiError, type AsRead, UNKNOWN, upgradeNeeded } from '@homingbird/protocol'
import { trackSignIn } from '../analytics.ts'
import { type Action, type App, withApp } from '../app.ts'
import { keptComposerTexts } from '../composer-texts.ts'
import { preferredLanguage } from '../languages.ts'
import { strings, useLanguage } from '../strings.ts'
import { followEvents, latestEvent } from './events.ts'
import { reportUnsettled } from './held.ts'
import { reportVisibility } from './presence.ts'
import { loadBranding, loadWorkspace } from './workspace.ts'

/**
 * Starts the page: the branding and the server first, then the person, their workspace and live events.
 * A load that fails for a moment is repeated a few times; when it keeps failing the page offers to try
 * again, and starts again by itself when the network is back.
 */
export const boot: Action = T.gen(function* () {
  const { state } = yield* T.ask<App>()
  state.start.set('loading')
  const loaded = yield* T.result(loadWithRetries)
  if (loaded._tag === 'Err') return yield* giveUp(loaded.error)
  if (loaded.value._tag === 'upgrade')
    return state.notice.set({ kind: 'error', text: strings.upgrade[loaded.value.side] })
  if (loaded.value._tag === 'signed-out') return state.session.set(null)
  yield* trackSignIn
  yield* T.result(reportUnsettled)
  yield* followEvents(loaded.value.after)
  yield* reportVisibility
})

/** Starts again after the page gave up; nothing happens while a start is under way or once it worked. */
export const startAgain: Action = withApp(({ state }) =>
  T.suspend(() => {
    if (state.start.get() !== 'failed') return T.unit
    state.start.set('loading')
    return boot
  }),
)

type Loaded =
  | { readonly _tag: 'upgrade'; readonly side: 'client' | 'server' }
  | { readonly _tag: 'signed-out' }
  | { readonly _tag: 'ready'; readonly after: number }

const loadWithRetries: Action<Loaded> = T.suspend(() =>
  T.retry({ schedule: startWaits, while: isTransient })(T.tapError((_: ApiError) => noteFailedAttempt)(load)),
)

/** Reads only, so a whole attempt may be repeated; what must happen once happens after the last attempt. */
const load: Action<Loaded> = T.gen(function* () {
  const { state, page } = yield* T.ask<App>()
  state.branding.set(yield* loadBranding)
  const info = yield* serverInfo
  const side = upgradeNeeded(info)
  if (side !== null) return { _tag: 'upgrade', side } as const
  const me = yield* signedInPerson
  if (me === null) return { _tag: 'signed-out' } as const
  useLanguage(preferredLanguage(me.locale === UNKNOWN ? undefined : me.locale, page.languages()))
  state.composerTexts.set(keptComposerTexts(page.storage, me.member.id))
  state.session.set(me)
  const after = yield* latestEvent
  yield* loadWorkspace
  return { _tag: 'ready', after } as const
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

/** Back to the loading page, so a failed attempt leaves no half-drawn workspace behind. */
const noteFailedAttempt: Action = withApp(({ state }) =>
  T.sync(() => {
    if (state.session.get() !== 'loading') state.session.set('loading')
    state.start.set('slow')
  }),
)

/** A person whose session ended signs in again; any other refusal, or a server that stays away, is a failed start. */
const giveUp = (error: ApiError): Action =>
  withApp(({ state }) =>
    T.sync(() => {
      if (error._tag === 'Unauthorized') return state.session.set(null)
      state.start.set('failed')
    }),
  )

function isTransient(error: ApiError): boolean {
  return error._tag === 'Unavailable' || error._tag === 'RateLimited'
}

/** The waits between attempts: one, two, four and eight seconds, so a start gives up after about fifteen. */
const startWaits = (): Iterable<number> => Iter.take(4)(Schedule.exponential(1000, 2, 8000))
