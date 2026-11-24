import { Task as T } from '@homingbird/kernel'
import { UNKNOWN, upgradeNeeded } from '@homingbird/protocol'
import { trackSignIn } from '../analytics.ts'
import type { Action, App } from '../app.ts'
import { keptComposerTexts } from '../composer-texts.ts'
import { preferredLanguage } from '../languages.ts'
import { strings, useLanguage } from '../strings.ts'
import { followEvents, latestEvent } from './events.ts'
import { reportUnsettled } from './held.ts'
import { reportVisibility } from './presence.ts'
import { loadBranding, loadWorkspace } from './workspace.ts'

/** Starts the page: the branding and the server first, then the person, their workspace and live events. */
export const boot: Action = T.gen(function* () {
  const { api, state, page } = yield* T.ask<App>()
  state.branding.set(yield* loadBranding)
  const info = yield* api['server.info']({})
  state.serverInfo.set(info)
  const upgrade = upgradeNeeded(info)
  if (upgrade !== null) return state.notice.set({ kind: 'error', text: strings.upgrade[upgrade] })
  const me = yield* T.result(api['me.get']({}))
  if (me._tag === 'Err') return state.session.set(null)
  const locale = me.value.locale
  useLanguage(preferredLanguage(locale === UNKNOWN ? undefined : locale, page.languages()))
  state.composerTexts.set(keptComposerTexts(page.storage, me.value.member.id))
  state.session.set(me.value)
  yield* trackSignIn
  const loadedAfter = yield* latestEvent
  yield* loadWorkspace
  yield* T.result(reportUnsettled)
  yield* followEvents(loadedAfter)
  yield* reportVisibility
})
