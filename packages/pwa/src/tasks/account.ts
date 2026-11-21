import { Task as T } from '@homingbird/kernel'
import type {
  ApiError,
  AsRead,
  CharacterSpec,
  ConsentRequest,
  CredentialId,
  DeviceRequest,
  Locale,
} from '@homingbird/protocol'
import { type Action, type App, withApp } from '../app.ts'
import { forgetComposerTexts } from '../composer-texts.ts'
import { preferredLanguage } from '../languages.ts'
import { signedIn } from '../state.ts'
import { strings, useLanguage } from '../strings.ts'
import { loadPeople } from './workspace.ts'

export const updateProfile = (name: string, profile: string): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const member = yield* api['me.update']({ body: { name, profile } })
    const me = signedIn(state)
    if (me !== null) state.session.set({ ...me, member })
    yield* loadPeople
  })

/** Uses a character, or the default pigeon again with null. */
export const useCharacter = (spec: CharacterSpec | null): Action =>
  T.gen(function* () {
    const { api, state } = yield* T.ask<App>()
    const member =
      spec === null ? yield* api['me.character.clear']({}) : yield* api['me.character.set']({ body: spec })
    const me = signedIn(state)
    if (me !== null) state.session.set({ ...me, member })
    yield* loadPeople
  })

/** Chooses the language to read the web client in; null follows the browser. */
export const chooseLanguage = (chosen: Locale | null): Action =>
  T.gen(function* () {
    const { api, state, page } = yield* T.ask<App>()
    const member = yield* api['me.update']({ body: { locale: chosen } })
    const me = signedIn(state)
    useLanguage(preferredLanguage(chosen ?? undefined, page.languages()))
    if (me === null) return
    const { locale: _previous, ...rest } = me
    state.session.set({ ...rest, member, ...(chosen !== null && { locale: chosen }) })
  })

export const listCredentials: Action<ReadonlyArray<AsRead.Credential>> = withApp(({ api }) =>
  T.map((listed: { credentials: ReadonlyArray<AsRead.Credential> }) => listed.credentials)(
    api['credentials.list']({}),
  ),
)

export const renameCredential = (id: CredentialId, name: string): Action =>
  withApp(({ api }) => T.asUnit(api['credentials.rename']({ params: { id }, body: { name } })))

export const revokeCredential = (id: CredentialId): Action =>
  withApp(({ api }) => T.asUnit(api['credentials.revoke']({ params: { id } })))

/** A join code for `homingbird setup` on a server: for the person's own agent, or for a channel's they manage. */
export const createJoinCode = (channel: string | null): Action<AsRead.JoinCode> =>
  withApp(({ api }) => api['joinCodes.create']({ body: channel === null ? {} : { channel } }))

/** The invites still waiting: all of them for an administrator, the person's own otherwise. */
export const listInvites: Action<ReadonlyArray<AsRead.Invite>> = withApp(({ api }) =>
  T.map((listed: { invites: ReadonlyArray<AsRead.Invite> }) => listed.invites)(api['invites.list']({})),
)

/** A new invite link, bound to one address when given; the link is in this answer alone. */
export const createInvite = (email: string | null): Action<AsRead.InviteLink> =>
  withApp(({ api }) => api['invites.create']({ body: email === null ? {} : { email } }))

export const revokeInvite = (id: string): Action =>
  withApp(({ api }) => T.asUnit(api['invites.revoke']({ params: { id } })))

export const lookUpDevice = (userCode: string): Action<DeviceRequest> =>
  withApp(({ api }) => api['device.get']({ params: { userCode } }))

/** Approves or denies a device; with a channel, a manager connects it as that channel's agent. */
export const decideDevice = (userCode: string, approve: boolean, name: string, channel: string): Action =>
  withApp(({ api }) =>
    T.asUnit(
      api['device.decide']({
        params: { userCode },
        body: { approve, name, ...(approve && channel !== '' && { channel }) },
      }),
    ),
  )

export const lookUpConsent = (id: string): Action<ConsentRequest> =>
  withApp(({ api }) => api['consent.get']({ params: { id } }))

export const decideConsent = (
  id: string,
  approve: boolean,
  name: string,
): Action<{ readonly redirectTo: string }> =>
  withApp(({ api }) => api['consent.decide']({ params: { id }, body: { approve, name } }))

/** Goes to an address outside the app once the person has had a moment to read the outcome. */
export const returnAfterAMoment = (url: string): Action =>
  T.gen(function* () {
    const { page } = yield* T.ask<App>()
    yield* T.sleep(RETURN_DELAY_MS)
    page.assign(url)
  })

export const signOut: Action = T.gen(function* () {
  const { page, state } = yield* T.ask<App>()
  const me = signedIn(state)
  if (me !== null) forgetComposerTexts(page.storage, me.member.id)
  yield* T.tryPromise(
    (signal) =>
      page.fetch('/auth/logout', { method: 'POST', headers: { 'x-homingbird-request': '1' }, signal }),
    (): ApiError => ({ _tag: 'Unavailable', message: strings.serverUnreachable }),
  )
  page.assign('/')
})

const RETURN_DELAY_MS = 1500
