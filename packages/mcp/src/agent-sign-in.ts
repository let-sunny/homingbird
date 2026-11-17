import {
  type DeviceFlowFailed,
  type DeviceFlowOptions,
  type Fetch,
  awaitDeviceTokens,
  beginDeviceFlow,
  httpApi,
} from '@homingbird/client'
import { type HasClock, Task as T } from '@homingbird/kernel'
import { readCredential, storeCredential } from './credential-file.ts'

export interface SignInOptions {
  readonly serverUrl: string
  readonly clientName: string
  readonly credentialPath: string
  readonly announce: (line: string) => void
  readonly fetch?: Fetch
}

export const agentToken = (options: SignInOptions): T.Task<string, DeviceFlowFailed, HasClock> =>
  T.gen(function* () {
    const stored = yield* readCredential(options.credentialPath, options.serverUrl)
    const now = yield* T.now
    if (
      stored !== null &&
      stored.expiresAt - now > EXPIRY_MARGIN_MS &&
      (yield* isAccepted(options, stored.token))
    )
      return stored.token
    const flow: DeviceFlowOptions = {
      serverUrl: options.serverUrl,
      clientName: options.clientName,
      wantsApproval: false,
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    }
    const authorization = yield* beginDeviceFlow(flow)
    options.announce(
      `Homingbird: to connect this agent, open ${authorization.verification_uri_complete} and confirm the code ${authorization.user_code}.`,
    )
    const tokens = yield* awaitDeviceTokens(flow, authorization)
    yield* storeCredential(options.credentialPath, options.serverUrl, {
      token: tokens.access_token,
      expiresAt: (yield* T.now) + tokens.expires_in * 1000,
    })
    options.announce('Homingbird: connected.')
    return tokens.access_token
  })

const EXPIRY_MARGIN_MS = 60_000

const isAccepted = (options: SignInOptions, token: string): T.Task<boolean> =>
  T.fold(
    () => false,
    () => true,
  )(
    httpApi({
      serverUrl: options.serverUrl,
      token: () => token,
      ...(options.fetch !== undefined && { fetch: options.fetch }),
    })['me.get']({}),
  )
