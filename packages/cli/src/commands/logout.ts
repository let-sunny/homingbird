import { Task as T } from '@homingbird/kernel'
import { readCredential, removeCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'

/** Signs out of one server only: the one named, or the only one signed in to. */
export const logout: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const credential = yield* readCredential
  if (credential === null) return outcome({ signedOut: true }, 'Not signed in; nothing to sign out of.')
  yield* revokeOnServer(credential.serverUrl, credential.token)
  yield* removeCredential(credential.serverUrl)
  return outcome(
    { signedOut: true, server: credential.serverUrl },
    `Signed out of ${credential.serverUrl}. Its credential on this device was revoked and removed.`,
  )
})

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
