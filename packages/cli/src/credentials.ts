import { Schema as S, Task as T } from '@homingbird/kernel'
import type { CliEnv } from './environment.ts'
import { CliFailure, EXIT, SIGNED_OUT_MESSAGE } from './failure.ts'

export const StoredCredential = S.struct({
  serverUrl: S.string({ pattern: /^https?:\/\// }),
  token: S.string({ minLength: 1 }),
})
export type StoredCredential = S.Infer<typeof StoredCredential>

export type CredentialRole = 'agent' | 'approval'

export const CREDENTIAL_FILES: Readonly<Record<CredentialRole, string>> = {
  agent: 'agent-credential.json',
  approval: 'approval-credential.json',
}

export const credentialDirectory = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>): string =>
  `${env.variables.XDG_CONFIG_HOME || `${env.homeDirectory}/.config`}/homingbird`

export const readCredential = (role: CredentialRole): T.Task<StoredCredential | null, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const content = yield* T.promise(() => env.files.read(pathOf(env, role)))
    if (content === null) return null
    const decoded = StoredCredential.decode(parseJson(content))
    return decoded._tag === 'Ok' ? decoded.value : null
  })

export const requireCredential = (role: CredentialRole): T.Task<StoredCredential, CliFailure, CliEnv> =>
  T.flatMap((credential: StoredCredential | null) =>
    credential !== null
      ? T.succeed(credential)
      : T.fail(CliFailure({ message: MISSING_MESSAGE[role], exitCode: EXIT.signedOut })),
  )(readCredential(role))

export const writeCredential = (
  role: CredentialRole,
  credential: StoredCredential,
): T.Task<void, never, CliEnv> =>
  T.flatMap((env: CliEnv) =>
    T.promise(() => env.files.writePrivate(pathOf(env, role), `${JSON.stringify(credential, null, 2)}\n`)),
  )(T.ask<CliEnv>())

export const removeCredential = (role: CredentialRole): T.Task<void, never, CliEnv> =>
  T.flatMap((env: CliEnv) => T.promise(() => env.files.remove(pathOf(env, role))))(T.ask<CliEnv>())

const MISSING_MESSAGE: Readonly<Record<CredentialRole, string>> = {
  agent: SIGNED_OUT_MESSAGE,
  approval:
    'This device has no approve button. Sign in with `homingbird login --server <url> --approve-button` and grant it in the browser, or approve in the web client.',
}

const pathOf = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>, role: CredentialRole): string =>
  `${credentialDirectory(env)}/${CREDENTIAL_FILES[role]}`

const parseJson = (content: string): unknown => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}
