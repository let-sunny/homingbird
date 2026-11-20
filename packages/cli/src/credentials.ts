import { Schema as S, Task as T } from '@homingbird/kernel'
import type { CliEnv } from './environment.ts'
import { CliFailure, EXIT, SIGNED_OUT_MESSAGE, failed } from './failure.ts'

export const StoredCredential = S.struct({
  serverUrl: S.string({ pattern: /^https?:\/\// }),
  token: S.string({ minLength: 1 }),
})
export type StoredCredential = S.Infer<typeof StoredCredential>

/**
 * The agent credential for the server this command was told to use, with `--server` or
 * HOMINGBIRD_SERVER; without one, the only credential stored. It never answers with another
 * server's credential. Given a credentials file, it reads that file only.
 */
export const readCredential: T.Task<StoredCredential | null, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  if (env.credentialsFile !== null) {
    const credential = yield* readCredentialsFile(env.credentialsFile, env.server)
    yield* warnIfShared(env.credentialsFile)
    return credential
  }
  if (env.server !== null) return yield* credentialFor(env.server)
  const servers = yield* storedServers
  if (servers.length > 1)
    return yield* T.fail(
      CliFailure({
        message: `Signed in to several servers: ${servers.join(', ')}. Say which with --server <url>.`,
        exitCode: EXIT.usage,
      }),
    )
  return servers[0] === undefined ? null : yield* credentialFor(servers[0])
})

export const requireCredential: T.Task<StoredCredential, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const credential = yield* readCredential
  if (credential !== null) return credential
  return yield* T.fail(
    CliFailure({
      message:
        env.server === null
          ? SIGNED_OUT_MESSAGE
          : `Not signed in to ${env.server}. Run \`homingbird login --server ${env.server}\` first.`,
      exitCode: EXIT.signedOut,
    }),
  )
})

/** Every server this device holds an agent credential for. */
export const storedServers: T.Task<string[], never, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const names = yield* env.files.list(agentsDirectory(env))
  return names
    .filter((name) => name.endsWith(SUFFIX))
    .map((name) => decodeURIComponent(name.slice(0, -SUFFIX.length)))
    .sort()
})

export const credentialFor = (serverUrl: string): T.Task<StoredCredential | null, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const content = yield* env.files.read(pathFor(env, serverUrl))
    if (content === null) return null
    const decoded = StoredCredential.decode(parseJson(content))
    return decoded._tag === 'Ok' && serverKey(decoded.value.serverUrl) === serverKey(serverUrl)
      ? decoded.value
      : null
  })

export const writeCredential = (credential: StoredCredential): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    yield* env.files.writePrivate(pathFor(env, credential.serverUrl), serialized(credential))
    yield* env.files.remove(`${credentialDirectory(env)}/${LEGACY_FILE}`)
  })

/**
 * The agent credential in a file the person named, which is only ever read here. It fails, saying why,
 * when the file is missing, cannot be read, holds no credential, or is for another server than the one
 * named. No message quotes what the file holds.
 */
export const readCredentialsFile = (
  path: string,
  server: string | null,
): T.Task<StoredCredential, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if ((yield* env.files.mode(path)) === null)
      return yield* T.fail(
        CliFailure({
          message: `The credentials file ${path} does not exist. ${createCredentialsFile(path, server)}`,
          exitCode: EXIT.signedOut,
        }),
      )
    const content = yield* env.files.read(path)
    if (content === null)
      return yield* T.fail(
        failed(`The credentials file ${path} cannot be read by this user. Check its owner and permissions.`),
      )
    const decoded = StoredCredential.decode(parseJson(content))
    if (decoded._tag === 'Err')
      return yield* T.fail(
        failed(
          `The credentials file ${path} does not hold an agent credential. ${createCredentialsFile(path, server)}`,
        ),
      )
    if (server !== null && serverKey(decoded.value.serverUrl) !== serverKey(server))
      return yield* T.fail(
        CliFailure({
          message: `The credentials file ${path} is for ${decoded.value.serverUrl}, not ${server}.`,
          exitCode: EXIT.usage,
        }),
      )
    return decoded.value
  })

/** Warns, without failing, when a credentials file can be read by its group or by everyone. */
export const warnIfShared = (path: string): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (env.platform === 'win32') return
    const mode = yield* env.files.mode(path)
    if (mode === null || (mode & SHARED_READ_BITS) === 0) return
    env.output.problem(
      `Warning: other users of this computer can read the credentials file ${path} (mode ${mode.toString(8).padStart(4, '0')}). Only its owner should: chmod 600 ${path}`,
    )
  })

/** Refuses, before anyone approves a sign-in, to replace a credentials file without --force. */
export const requireNewCredentialsFile = (path: string, force: boolean): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (!force && (yield* env.files.exists(path))) return yield* T.fail(alreadyThere(path))
  })

/** Writes the credential to the named file, readable by its owner only. */
export const writeCredentialsFile = (
  path: string,
  credential: StoredCredential,
  force: boolean,
): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const content = serialized(credential)
    const written = yield* T.exit(
      force ? T.as(true)(env.files.writeOwnerOnly(path, content)) : env.files.createExclusive(path, content),
    )
    if (written._tag === 'Err') return yield* T.fail(couldNotWrite(path, written.error))
    if (!written.value) return yield* T.fail(alreadyThere(path))
  })

export const removeCredential = (serverUrl: string): T.Task<void, never, CliEnv> =>
  T.flatMap((env: CliEnv) => env.files.remove(pathFor(env, serverUrl)))(T.ask<CliEnv>())

export const credentialDirectory = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>): string =>
  `${env.variables.XDG_CONFIG_HOME || `${env.homeDirectory}/.config`}/homingbird`

/** One server's address as a key: scheme, host, port and path, without a trailing slash. */
export const serverKey = (serverUrl: string): string => {
  if (!URL.canParse(serverUrl)) return serverUrl.replace(/\/+$/, '')
  const url = new URL(serverUrl)
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export const AGENTS_DIRECTORY = 'agents'
const LEGACY_FILE = 'agent-credential.json'

const SUFFIX = '.json'

const SHARED_READ_BITS = 0o044

const createCredentialsFile = (path: string, server: string | null): string =>
  `Create it on a computer where you can approve the sign-in: homingbird login --server ${server ?? '<url>'} --credentials-file ${path}`

const alreadyThere = (path: string): CliFailure =>
  CliFailure({
    message: `${path} already exists. Pass --force to replace it, or choose another path.`,
    exitCode: EXIT.usage,
  })

const couldNotWrite = (path: string, cause: T.Cause<never>): CliFailure => {
  const defect = cause._tag === 'Die' ? cause.defect : cause
  return failed(`Could not write ${path}: ${defect instanceof Error ? defect.message : String(defect)}`)
}

const serialized = (credential: StoredCredential): string => `${JSON.stringify(credential, null, 2)}\n`

const agentsDirectory = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>): string =>
  `${credentialDirectory(env)}/${AGENTS_DIRECTORY}`

const pathFor = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>, serverUrl: string): string =>
  `${agentsDirectory(env)}/${encodeURIComponent(serverKey(serverUrl))}${SUFFIX}`

const parseJson = (content: string): unknown => {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}
