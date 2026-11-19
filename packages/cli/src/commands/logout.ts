import { isRevokedOnServer } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import { readCredential, readCredentialsFile, removeCredential } from '../credentials.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'

/**
 * Signs out of one server only: the one named, or the only one signed in to. It always removes the
 * credential from this device, and says the server revoked it only when the server confirmed so.
 * Given a credentials file, it deletes the file only where this user may.
 */
export const logout: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  if (env.credentialsFile !== null) return yield* logoutFromFile(env.credentialsFile)
  const credential = yield* readCredential
  if (credential === null) return outcome({ signedOut: true }, 'Not signed in; nothing to sign out of.')
  const revoked = yield* isRevokedOnServer(env.fetch, credential.serverUrl, credential.token)
  yield* removeCredential(credential.serverUrl)
  return outcome(
    { signedOut: true, server: credential.serverUrl, removedLocally: true, revokedOnServer: revoked },
    revoked
      ? `Signed out of ${credential.serverUrl}. The server revoked this device's credential, and it was removed from this device.`
      : `Signed out of ${credential.serverUrl} on this device only: its credential was removed here, but the server did not confirm that it revoked it, so it may still work. ${REVOKE_IN_WEB_CLIENT}`,
  )
})

const logoutFromFile = (path: string): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const credential = yield* readCredentialsFile(path, env.server)
    const revoked = yield* isRevokedOnServer(env.fetch, credential.serverUrl, credential.token)
    const removed = yield* isRemoved(path)
    const server = credential.serverUrl
    return outcome(
      {
        signedOut: revoked,
        server,
        credentialsFile: path,
        removedLocally: removed,
        revokedOnServer: revoked,
      },
      revoked
        ? removed
          ? `Signed out of ${server}. The server revoked the credential in ${path}, and the file was deleted.`
          : `Signed out of ${server}. The server revoked the credential in ${path}. The file is read-only here, so it was left in place: delete it, or the secret it comes from, where it is stored.`
        : removed
          ? `Deleted ${path}, but the server did not confirm that it revoked the credential, so it may still work. ${REVOKE_IN_WEB_CLIENT}`
          : `The server did not confirm that it revoked the credential in ${path}, and the file is read-only here, so it was left in place. ${REVOKE_IN_WEB_CLIENT}`,
    )
  })

const isRemoved = (path: string): T.Task<boolean, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (!(yield* env.files.isWritable(path))) return false
    const removed = yield* T.exit(env.files.remove(path))
    return removed._tag === 'Ok'
  })

const REVOKE_IN_WEB_CLIENT = "Revoke it in the web client's device list."
