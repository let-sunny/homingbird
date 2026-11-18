import { httpApi } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import type { Api, ApiError } from '@homingbird/protocol'
import { type StoredCredential, requireCredential } from './credentials.ts'
import type { CliEnv } from './environment.ts'
import { type CliFailure, fromApiError } from './failure.ts'

export interface Session {
  readonly api: Api
  readonly credential: StoredCredential
}

export const openSession: T.Task<Session, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const credential = yield* requireCredential
  return { credential, api: apiFor(env, credential) }
})

export const apiFor = (env: Pick<CliEnv, 'fetch'>, credential: StoredCredential): Api =>
  httpApi({ serverUrl: credential.serverUrl, fetch: env.fetch, token: () => credential.token })

export const calling = <A>(call: T.Task<A, ApiError>): T.Task<A, CliFailure> => T.mapError(fromApiError)(call)
