import { Task as T, tagged } from '@homingbird/kernel'
import type { Fetch } from './http-api.ts'

export interface JoinTokens {
  readonly access_token: string
  readonly expires_in: number
}

export const JoinCodeRefused = tagged('JoinCodeRefused')<{
  readonly reason: 'refused' | 'too_many' | 'off' | 'unreachable'
  readonly message: string
}>()
export type JoinCodeRefused = ReturnType<typeof JoinCodeRefused>

export interface JoinCodeOptions {
  readonly serverUrl: string
  readonly code: string
  readonly clientName: string
  readonly clientKind?: 'cli'
  readonly fetch?: Fetch
}

/** Redeems, once, a join code someone created in the web client, for the agent credential it issues. */
export const redeemJoinCode = (options: JoinCodeOptions): T.Task<JoinTokens, JoinCodeRefused> =>
  T.gen(function* () {
    const response = yield* T.tryPromise(
      (signal) =>
        (options.fetch ?? globalThis.fetch)(`${options.serverUrl.replace(/\/+$/, '')}/oauth/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: options.code,
            client_name: options.clientName,
            ...(options.clientKind !== undefined && { client_kind: options.clientKind }),
          }).toString(),
          signal,
        }),
      unreachable,
    )
    const body = yield* T.tryPromise(() => response.json() as Promise<Record<string, unknown>>, unreachable)
    if (response.ok && typeof body.access_token === 'string') return body as unknown as JoinTokens
    return yield* T.fail(refusalOf(response.status, body))
  })

const refusalOf = (status: number, body: Readonly<Record<string, unknown>>): JoinCodeRefused => {
  if (status === 429)
    return JoinCodeRefused({
      reason: 'too_many',
      message: 'Too many join codes were tried from this address. Wait ten minutes and try again.',
    })
  if (status === 404)
    return JoinCodeRefused({
      reason: 'off',
      message: 'This server does not offer join codes. Sign in with homingbird login instead.',
    })
  return JoinCodeRefused({
    reason: 'refused',
    message:
      typeof body.error_description === 'string'
        ? body.error_description
        : 'The server refused the join code. Create a new one in the web client.',
  })
}

const unreachable = (): JoinCodeRefused =>
  JoinCodeRefused({ reason: 'unreachable', message: 'The Homingbird server could not be reached.' })
