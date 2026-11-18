import {
  type DeviceAuthorization,
  type DeviceFlowOptions,
  type Fetch,
  awaitDeviceTokens,
  beginDeviceFlow,
  eventStream,
  httpApi,
} from '@homingbird/client'
import { type Clock, Task as T } from '@homingbird/kernel'
import type { StreamEvent } from '@homingbird/protocol'
import { ONE_DESK } from './answering.ts'
import type { OpenInBrowser } from './browser-opener.ts'
import { readCredential, removeCredential, storeCredential } from './credential-file.ts'

export type SessionState =
  | { readonly kind: 'signed_out'; readonly note: string | null }
  | { readonly kind: 'pending'; readonly verificationUri: string; readonly userCode: string }
  | { readonly kind: 'signed_in' }

export interface LocalSessionOptions {
  readonly serverUrl: string
  readonly clientName: string
  readonly credentialPath: string
  readonly scope: T.Scope
  readonly clock: Clock
  readonly fetch?: Fetch
  readonly openInBrowser?: OpenInBrowser
  readonly listener?: SessionListener
}

export interface SessionListener {
  readonly online: T.Task<void>
  readonly received: (event: StreamEvent) => T.Task<void>
}

export interface LocalSession {
  readonly state: () => SessionState
  readonly token: () => string | null
  readonly restore: T.Task<void>
  readonly login: T.Task<string>
  readonly status: T.Task<string>
  readonly logout: T.Task<string>
  readonly credentialWasRefused: () => void
}

export const SIGN_IN_FIRST = 'Not signed in to Homingbird. Call the login tool first.'

export const makeLocalSession = (options: LocalSessionOptions): LocalSession => {
  const { serverUrl, credentialPath, scope, clock } = options
  const fetching = options.fetch !== undefined ? { fetch: options.fetch } : {}
  const flow: DeviceFlowOptions = {
    serverUrl,
    clientName: options.clientName,
    wantsApproval: false,
    ...fetching,
  }
  const timed = <A, E>(task: T.Task<A, E, { clock: Clock }>): T.Task<A, E> =>
    T.provide({ clock })(task) as unknown as T.Task<A, E>

  let state: SessionState = { kind: 'signed_out', note: null }
  let token: string | null = null
  let approval: T.Fiber<void, never> | null = null
  let online: T.Fiber<void, never> | null = null

  const stop = (fiber: T.Fiber<void, never> | null): T.Task<void> =>
    fiber === null ? T.unit : fiber.interrupt

  const signedIn = (accepted: string): T.Task<void> =>
    T.gen(function* () {
      token = accepted
      state = { kind: 'signed_in' }
      yield* stop(online)
      const listener = options.listener
      if (listener === undefined) return
      online = yield* scope.fork(
        T.promise(async (signal) => {
          await T.run(listener.online, undefined, signal)
          for await (const event of eventStream(
            { serverUrl, token: () => token, clock, ...fetching },
            signal,
          ))
            await T.run(listener.received(event), undefined, signal)
        }),
      )
    })

  const signedOut = (note: string | null): T.Task<void> =>
    T.gen(function* () {
      token = null
      state = { kind: 'signed_out', note }
      const stopping = online
      online = null
      yield* stop(stopping)
    })

  const awaitApproval = (authorization: DeviceAuthorization): T.Task<void> =>
    T.gen(function* () {
      const tokens = yield* T.result(timed(awaitDeviceTokens(flow, authorization)))
      approval = null
      if (tokens._tag === 'Err') return yield* signedOut(`${tokens.error.message} Call login to try again.`)
      yield* storeCredential(credentialPath, serverUrl, {
        token: tokens.value.access_token,
        expiresAt: clock.now() + tokens.value.expires_in * 1000,
      })
      yield* signedIn(tokens.value.access_token)
    })

  const waitingText = (pending: Extract<SessionState, { kind: 'pending' }>): string =>
    `Waiting for approval in the browser. Open ${pending.verificationUri} and confirm the code ${pending.userCode}.`

  return {
    state: () => state,
    token: () => token,
    credentialWasRefused: () => {
      if (state.kind !== 'signed_in') return
      token = null
      state = { kind: 'signed_out', note: 'The stored credential is no longer accepted.' }
    },
    restore: T.gen(function* () {
      const stored = yield* readCredential(credentialPath, serverUrl)
      if (stored !== null && stored.expiresAt - clock.now() > EXPIRY_MARGIN_MS) yield* signedIn(stored.token)
    }),
    login: T.gen(function* () {
      if (state.kind === 'signed_in') return 'Already signed in to Homingbird. Call status to see as whom.'
      if (state.kind === 'pending') return waitingText(state)
      const begun = yield* T.result(beginDeviceFlow(flow))
      if (begun._tag === 'Err') return `Could not start signing in to ${serverUrl}: ${begun.error.message}`
      const pending = {
        kind: 'pending' as const,
        verificationUri: begun.value.verification_uri_complete,
        userCode: begun.value.user_code,
      }
      state = pending
      const opened =
        options.openInBrowser === undefined ? false : yield* options.openInBrowser(pending.verificationUri)
      approval = yield* scope.fork(awaitApproval(begun.value))
      return opened
        ? `The browser was opened at ${pending.verificationUri} to sign in. The code ${pending.userCode} is already filled in: one click there finishes it. Tell your human, then call status to check. ${ONE_DESK}`
        : `To sign in, show your human this link: ${pending.verificationUri}\nThe code ${pending.userCode} is already filled in: one click there finishes it. Then call status to check. ${ONE_DESK}`
    }),
    status: T.gen(function* () {
      if (state.kind === 'pending') return waitingText(state)
      if (state.kind === 'signed_out')
        return [`Not signed in to ${serverUrl}.`, state.note, 'Call login to sign in.']
          .filter(Boolean)
          .join(' ')
      const me = yield* T.result(httpApi({ serverUrl, token: () => token, ...fetching })['me.get']({}))
      if (me._tag === 'Ok')
        return `Signed in to ${serverUrl} as ${me.value.member.name} <${me.value.member.email}>, with the credential "${me.value.credential.name}". ${ONE_DESK}`
      if (me.error._tag !== 'Unauthorized')
        return `Signed in to ${serverUrl}, but it cannot be reached right now.`
      yield* signedOut('The stored credential is no longer accepted.')
      yield* removeCredential(credentialPath, serverUrl)
      return `Not signed in to ${serverUrl}. The stored credential is no longer accepted. Call login to sign in.`
    }),
    logout: T.gen(function* () {
      const revoking = token
      const waiting = approval
      approval = null
      yield* stop(waiting)
      yield* signedOut(null)
      yield* removeCredential(credentialPath, serverUrl)
      if (revoking !== null) yield* revoke(serverUrl, revoking, options.fetch ?? globalThis.fetch)
      return 'Signed out of Homingbird. The credential on this device was revoked and removed.'
    }),
  }
}

const EXPIRY_MARGIN_MS = 60_000

const revoke = (serverUrl: string, token: string, fetch: Fetch): T.Task<void> =>
  T.catchAll(() => T.unit)(
    T.tryPromise(
      async (signal) => {
        await fetch(`${serverUrl}/oauth/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
          signal,
        })
      },
      () => 'unreachable' as const,
    ),
  )
