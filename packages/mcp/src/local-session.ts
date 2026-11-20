import {
  type DeviceAuthorization,
  type DeviceFlowOptions,
  type Fetch,
  awaitDeviceTokens,
  beginDeviceFlow,
  eventStream,
  httpApi,
  isRevokedOnServer,
  requireReadableServer,
} from '@homingbird/client'
import { type Clock, Stream, Task as T } from '@homingbird/kernel'
import { type AsRead, UPGRADE_SENTENCES, isFeatureOffered } from '@homingbird/protocol'
import { ONE_DESK } from './answering.ts'
import type { OpenInBrowser } from './browser-opener.ts'
import { readCredential, readRunnerCredential, removeCredential, storeCredential } from './credential-file.ts'

export type SessionState =
  | { readonly kind: 'signed_out'; readonly note: string | null }
  | { readonly kind: 'pending'; readonly verificationUri: string; readonly userCode: string }
  | { readonly kind: 'signed_in' }

export interface LocalSessionOptions {
  readonly serverUrl: string
  readonly clientName: string
  readonly credentialPath: string
  /**
   * The runner's own agent credential file, when a runner started this server for one agent run: the
   * session signs in with it only, and never signs in, out or removes anything itself.
   */
  readonly runnerCredentialPath?: string | null
  readonly scope: T.Scope
  readonly clock: Clock
  readonly fetch?: Fetch
  readonly openInBrowser?: OpenInBrowser
  readonly listener?: SessionListener
  readonly desk?: SessionDesk
}

/** Told when a credential is accepted or dropped, so a hosted desk runner starts and stops with it. */
export interface SessionDesk {
  readonly signedIn: (token: string) => T.Task<void>
  readonly signedOut: T.Task<void>
  readonly describe: () => string
}

export interface SessionListener {
  readonly online: T.Task<void>
  readonly received: (event: AsRead.StreamEvent) => T.Task<void>
}

export interface LocalSession {
  readonly state: () => SessionState
  readonly token: () => string | null
  /** Why the server cannot be used, in one sentence: its protocol is one this adapter cannot read. */
  readonly protocolProblem: () => string | null
  readonly restore: T.Task<void>
  readonly login: T.Task<string>
  readonly status: T.Task<string>
  readonly logout: T.Task<string>
  readonly credentialWasRefused: () => void
}

export const SIGN_IN_FIRST = 'Not signed in to Homingbird. Call the login tool first.'

/** Said in status when the server counts anonymous usage; this adapter sends none itself. */
export const ANALYTICS_NOTICE =
  'This Homingbird server counts anonymous usage from the web client and the command line, never notes, names or email addresses; this MCP adapter sends none. People turn it off with `homingbird analytics off` or DO_NOT_TRACK=1.'

export const makeLocalSession = (options: LocalSessionOptions): LocalSession => {
  const runnerCredential = options.runnerCredentialPath ?? null
  if (runnerCredential !== null) return runnersSession(options, runnerCredential)
  const { serverUrl, credentialPath, scope, clock } = options
  const fetching = options.fetch !== undefined ? { fetch: options.fetch } : {}
  const flow: DeviceFlowOptions = {
    serverUrl,
    clientName: options.clientName,
    clientKind: 'mcp',
    ...fetching,
  }
  const timed = <A, E>(task: T.Task<A, E, { clock: Clock }>): T.Task<A, E> =>
    T.provide({ clock })(task) as unknown as T.Task<A, E>

  let state: SessionState = { kind: 'signed_out', note: null }
  let token: string | null = null
  let approval: T.Fiber<void, never> | null = null
  let online: T.Fiber<void, never> | null = null
  let checking: T.Fiber<void, never> | null = null
  let protocolProblem: string | null = null

  const stop = (fiber: T.Fiber<void, never> | null): T.Task<void> =>
    fiber === null ? T.unit : fiber.interrupt

  const signedIn = (accepted: string): T.Task<void> =>
    T.gen(function* () {
      token = accepted
      state = { kind: 'signed_in' }
      protocolProblem = null
      yield* stop(checking)
      checking = yield* scope.fork(checkProtocol(accepted))
      yield* stop(online)
      if (options.desk !== undefined) yield* options.desk.signedIn(accepted)
      const listener = options.listener
      if (listener === undefined) return
      online = yield* scope.fork(listening(listener))
    })

  /** Says the session is online, then hands the listener every event; a listener's defect never ends it. */
  const listening = (listener: SessionListener): T.Task<void> =>
    T.gen(function* () {
      yield* T.exit(listener.online)
      const stopping = new AbortController()
      const events = eventStream({ serverUrl, token: () => token, clock, ...fetching }, stopping.signal)
      yield* T.ensuring(T.sync(() => stopping.abort()))(
        Stream.forEach((event: AsRead.StreamEvent) => T.exit(listener.received(event)))(events),
      )
    })

  /**
   * Asked once beside the session, never before it, so that an MCP client's first request is answered
   * at once; a server that does not answer in time is not refused.
   */
  const checkProtocol = (accepted: string): T.Task<void> =>
    T.gen(function* () {
      const checked = yield* T.result(
        timed(
          T.timeout(PROTOCOL_CHECK_TIMEOUT_MS)(
            requireReadableServer(httpApi({ serverUrl, token: () => accepted, ...fetching })),
          ),
        ),
      )
      const message = checked._tag === 'Err' && 'message' in checked.error ? checked.error.message : null
      if (token === accepted && isUpgradeSentence(message)) protocolProblem = message
    })

  const signedOut = (note: string | null): T.Task<void> =>
    T.gen(function* () {
      token = null
      state = { kind: 'signed_out', note }
      protocolProblem = null
      const stoppingCheck = checking
      checking = null
      yield* stop(stoppingCheck)
      const stopping = online
      online = null
      yield* stop(stopping)
      if (options.desk !== undefined) yield* options.desk.signedOut
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
    protocolProblem: () => protocolProblem,
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
    status: T.map((text: string) =>
      options.desk === undefined ? text : `${text} ${options.desk.describe()}`,
    )(
      T.gen(function* () {
        if (state.kind === 'pending') return waitingText(state)
        if (state.kind === 'signed_out')
          return [`Not signed in to ${serverUrl}.`, state.note, 'Call login to sign in.']
            .filter(Boolean)
            .join(' ')
        const me = yield* T.result(httpApi({ serverUrl, token: () => token, ...fetching })['me.get']({}))
        if (me._tag === 'Ok') {
          const info = yield* T.result(httpApi({ serverUrl, ...fetching })['server.info']({}))
          const counted = info._tag === 'Ok' && isFeatureOffered(info.value, 'analytics')
          return `Signed in to ${serverUrl} as ${me.value.member.name} <${me.value.member.email}>, with the credential "${me.value.credential.name}". ${ONE_DESK}${counted ? ` ${ANALYTICS_NOTICE}` : ''}`
        }
        if (me.error._tag !== 'Unauthorized')
          return `Signed in to ${serverUrl}, but it cannot be reached right now.`
        yield* signedOut('The stored credential is no longer accepted.')
        yield* removeCredential(credentialPath, serverUrl)
        return `Not signed in to ${serverUrl}. The stored credential is no longer accepted. Call login to sign in.`
      }),
    ),
    logout: T.gen(function* () {
      const revoking = token
      const waiting = approval
      approval = null
      yield* stop(waiting)
      yield* signedOut(null)
      yield* removeCredential(credentialPath, serverUrl)
      if (revoking === null) return 'Signed out of Homingbird. No credential was stored on this device.'
      return (yield* isRevokedOnServer(options.fetch ?? globalThis.fetch, serverUrl, revoking))
        ? REVOKED_AND_REMOVED
        : REMOVED_ONLY_HERE
    }),
  }
}

/**
 * A session on the runner's credential, for the one agent run that started this server: it reads the
 * file once, and says so instead of signing in or out.
 */
const runnersSession = (options: LocalSessionOptions, path: string): LocalSession => {
  const { serverUrl } = options
  const fetching = options.fetch !== undefined ? { fetch: options.fetch } : {}
  let token: string | null = null
  let refused = false
  const signedOutText = () =>
    `Not signed in to ${serverUrl}: ${refused ? 'the server no longer accepts' : 'this server could not read'} the runner’s credential in ${path}. Sign in again with homingbird login.`
  return {
    state: () => (token === null ? { kind: 'signed_out', note: null } : { kind: 'signed_in' }),
    token: () => token,
    protocolProblem: () => null,
    credentialWasRefused: () => {
      token = null
      refused = true
    },
    restore: T.map((read: string | null) => void (token = read))(readRunnerCredential(path, serverUrl)),
    login: T.succeed(RUNNERS_CREDENTIAL),
    logout: T.succeed(RUNNERS_CREDENTIAL),
    status: T.gen(function* () {
      if (token === null) return signedOutText()
      const me = yield* T.result(httpApi({ serverUrl, token: () => token, ...fetching })['me.get']({}))
      if (me._tag === 'Ok')
        return `Signed in to ${serverUrl} as ${me.value.member.name} <${me.value.member.email}>, with the runner’s credential "${me.value.credential.name}".`
      if (me.error._tag !== 'Unauthorized')
        return `Signed in to ${serverUrl}, but it cannot be reached right now.`
      token = null
      refused = true
      return signedOutText()
    }),
  }
}

export const RUNNERS_CREDENTIAL =
  'This Homingbird server was started by homingbird run for one agent run, with the runner’s own credential: there is nothing to sign in or out of here.'

export const REVOKED_AND_REMOVED =
  'Signed out of Homingbird. The server revoked the credential, and it was removed from this device.'

export const REMOVED_ONLY_HERE =
  "Signed out of Homingbird on this device only: the credential was removed here, but the server did not confirm that it revoked it, so it may still work. Revoke it in the web client's device list."

const EXPIRY_MARGIN_MS = 60_000

const PROTOCOL_CHECK_TIMEOUT_MS = 10_000

const isUpgradeSentence = (message: string | null): message is string =>
  (Object.values(UPGRADE_SENTENCES) as ReadonlyArray<string | null>).includes(message)
