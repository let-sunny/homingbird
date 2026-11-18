import { Schema as S, Task as T } from '@homingbird/kernel'
import type { CliEnv } from './environment.ts'
import { CliFailure, EXIT, SIGNED_OUT_MESSAGE } from './failure.ts'

export const StoredCredential = S.struct({
  serverUrl: S.string({ pattern: /^https?:\/\// }),
  token: S.string({ minLength: 1 }),
})
export type StoredCredential = S.Infer<typeof StoredCredential>

/**
 * The agent credential for the server this command was told to use, with `--server` or
 * HOMINGBIRD_SERVER; without one, the only credential stored. It never answers with another
 * server's credential.
 */
export const readCredential: T.Task<StoredCredential | null, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
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
  const names = yield* T.promise(() => env.files.list(agentsDirectory(env)))
  return names
    .filter((name) => name.endsWith(SUFFIX))
    .map((name) => decodeURIComponent(name.slice(0, -SUFFIX.length)))
    .sort()
})

export const credentialFor = (serverUrl: string): T.Task<StoredCredential | null, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const content = yield* T.promise(() => env.files.read(pathFor(env, serverUrl)))
    if (content === null) return null
    const decoded = StoredCredential.decode(parseJson(content))
    return decoded._tag === 'Ok' && serverKey(decoded.value.serverUrl) === serverKey(serverUrl)
      ? decoded.value
      : null
  })

export const writeCredential = (credential: StoredCredential): T.Task<void, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    yield* T.promise(() =>
      env.files.writePrivate(pathFor(env, credential.serverUrl), `${JSON.stringify(credential, null, 2)}\n`),
    )
    yield* T.promise(() => env.files.remove(`${credentialDirectory(env)}/${LEGACY_FILE}`))
  })

export const removeCredential = (serverUrl: string): T.Task<void, never, CliEnv> =>
  T.flatMap((env: CliEnv) => T.promise(() => env.files.remove(pathFor(env, serverUrl))))(T.ask<CliEnv>())

export const credentialDirectory = (env: Pick<CliEnv, 'variables' | 'homeDirectory'>): string =>
  `${env.variables.XDG_CONFIG_HOME || `${env.homeDirectory}/.config`}/homingbird`

/** One server's address as a key: scheme, host, port and path, without a trailing slash. */
export const serverKey = (serverUrl: string): string => {
  if (!URL.canParse(serverUrl)) return serverUrl.replace(/\/+$/, '')
  const url = new URL(serverUrl)
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export const AGENTS_DIRECTORY = 'agents'
export const LEGACY_FILE = 'agent-credential.json'

const SUFFIX = '.json'

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
