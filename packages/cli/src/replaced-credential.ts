import { isRevokedOnServer } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import { type StoredCredential, credentialFor, readCredentialsFile } from './credentials.ts'
import type { CliEnv } from './environment.ts'

/**
 * The credential a new sign-in is about to replace for this server: in the credentials file given, or
 * where `homingbird login` keeps it. Null when there is none, or it cannot be read.
 */
export const credentialToReplace = (server: string): T.Task<StoredCredential | null, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (env.credentialsFile === null) return yield* credentialFor(server)
    if (!(yield* env.files.exists(env.credentialsFile))) return null
    const read = yield* T.result(readCredentialsFile(env.credentialsFile, server))
    return read._tag === 'Ok' ? read.value : null
  })

/** Asks the server to revoke a credential that a new sign-in replaced; warns, and goes on, when it does not confirm. */
export const revokeReplaced = (
  previous: StoredCredential | null,
  current: StoredCredential,
): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (previous === null || previous.token === current.token) return
    if (yield* isRevokedOnServer(env.fetch, previous.serverUrl, previous.token)) return
    env.output.problem(
      'Warning: the server did not confirm that it revoked the credential this sign-in replaced. Revoke the older connection under My agent → Connection in the web client.',
    )
  })
