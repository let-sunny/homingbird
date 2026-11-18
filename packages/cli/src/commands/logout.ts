import { Task as T } from '@homingbird/kernel'
import { type CredentialRole, readCredential, removeCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import { type Outcome, outcome } from '../outcome.ts'

export const logout: T.Task<Outcome, never, CliEnv> = T.gen(function* () {
  for (const role of ROLES) {
    const credential = yield* readCredential(role)
    if (credential !== null) yield* revokeOnServer(credential.serverUrl, credential.token)
    yield* removeCredential(role)
  }
  return outcome({ signedOut: true }, 'Signed out. The credentials on this device were revoked and removed.')
})

const ROLES: ReadonlyArray<CredentialRole> = ['agent', 'approval']

const revokeOnServer = (serverUrl: string, token: string): T.Task<void, never, CliEnv> =>
  T.flatMap((env: CliEnv) =>
    T.catchAll(() => T.unit)(
      T.tryPromise(
        async (signal) => {
          await env.fetch(`${serverUrl}/oauth/revoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
            signal,
          })
        },
        () => 'unreachable' as const,
      ),
    ),
  )(T.ask<CliEnv>())
