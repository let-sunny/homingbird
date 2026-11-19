import { type HasClock, Task as T, tagged } from '@homingbird/kernel'
import type { Fetch } from './http-api.ts'

export interface DeviceAuthorization {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri: string
  readonly verification_uri_complete: string
  readonly expires_in: number
  readonly interval: number
}

export interface DeviceTokens {
  readonly access_token: string
  readonly expires_in: number
}

export const DeviceFlowFailed = tagged('DeviceFlowFailed')<{
  readonly reason: 'denied' | 'expired' | 'unreachable'
  readonly message: string
}>()
export type DeviceFlowFailed = ReturnType<typeof DeviceFlowFailed>

export interface DeviceFlowOptions {
  readonly serverUrl: string
  readonly clientName: string
  /** Which kind of program asks, recorded by the server instead of the name; older servers ignore it. */
  readonly clientKind?: 'cli' | 'mcp' | 'plugin'
  readonly fetch?: Fetch
}

export const beginDeviceFlow = (options: DeviceFlowOptions): T.Task<DeviceAuthorization, DeviceFlowFailed> =>
  T.map((answer: Answer) => answer.body as unknown as DeviceAuthorization)(
    post(options, '/oauth/device_authorization', {
      client_name: options.clientName,
      ...(options.clientKind !== undefined && { client_kind: options.clientKind }),
      scope: 'notes',
    }),
  )

export const awaitDeviceTokens = (
  options: DeviceFlowOptions,
  authorization: DeviceAuthorization,
): T.Task<DeviceTokens, DeviceFlowFailed, HasClock> =>
  T.gen(function* () {
    const deadline = (yield* T.now) + authorization.expires_in * 1000
    while ((yield* T.now) < deadline) {
      yield* T.sleep(authorization.interval * 1000)
      const answer = yield* post(options, '/oauth/token', {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: authorization.device_code,
      })
      if (answer.ok) return answer.body as unknown as DeviceTokens
      if (answer.body.error === 'access_denied')
        return yield* T.fail(
          DeviceFlowFailed({ reason: 'denied', message: 'The request was denied in the browser.' }),
        )
      if (answer.body.error !== 'authorization_pending' && answer.body.error !== 'slow_down') break
    }
    return yield* T.fail(
      DeviceFlowFailed({ reason: 'expired', message: 'The code expired before it was approved.' }),
    )
  })

interface Answer {
  readonly ok: boolean
  readonly body: Readonly<Record<string, unknown>>
}

const post = (
  options: DeviceFlowOptions,
  path: string,
  fields: Readonly<Record<string, string>>,
): T.Task<Answer, DeviceFlowFailed> =>
  T.gen(function* () {
    const response = yield* T.tryPromise(
      (signal) =>
        (options.fetch ?? globalThis.fetch)(`${options.serverUrl.replace(/\/+$/, '')}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields).toString(),
          signal,
        }),
      unreachable,
    )
    const body = yield* T.tryPromise(() => response.json() as Promise<Record<string, unknown>>, unreachable)
    return { ok: response.ok, body }
  })

const unreachable = (): DeviceFlowFailed =>
  DeviceFlowFailed({ reason: 'unreachable', message: 'The Homingbird server could not be reached.' })
