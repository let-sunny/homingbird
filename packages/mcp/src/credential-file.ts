import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Schema as S, Task as T } from '@homingbird/kernel'

export interface StoredCredential {
  readonly token: string
  readonly expiresAt: number
}

export const credentialFilePath = (
  environment: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string =>
  join(environment.XDG_CONFIG_HOME || join(homeDirectory, '.config'), 'homingbird', 'mcp-credentials.json')

export const readCredential = (path: string, serverUrl: string): T.Task<StoredCredential | null> =>
  T.map((all: Readonly<Record<string, StoredCredential>>) => all[serverUrl] ?? null)(readAll(path))

export const storeCredential = (
  path: string,
  serverUrl: string,
  credential: StoredCredential,
): T.Task<void> =>
  T.flatMap((all: Stored) => writeAll(path, { ...all, [serverUrl]: credential }))(readAll(path))

export const removeCredential = (path: string, serverUrl: string): T.Task<void> =>
  T.flatMap((all: Stored) => {
    const { [serverUrl]: _removed, ...kept } = all
    return writeAll(path, kept)
  })(readAll(path))

type Stored = Readonly<Record<string, StoredCredential>>

const writeAll = (path: string, all: Stored): T.Task<void> =>
  T.gen(function* () {
    yield* T.promise(() => mkdir(dirname(path), { recursive: true, mode: 0o700 }))
    yield* T.promise(() => writeFile(path, JSON.stringify(all, null, 2), { mode: 0o600 }))
    yield* T.promise(() => chmod(path, 0o600))
  })

const CredentialFile = S.record(S.struct({ token: S.string({ minLength: 1 }), expiresAt: S.number() }))

const readAll = (path: string): T.Task<Readonly<Record<string, StoredCredential>>> =>
  T.catchAll(() => T.succeed({}))(
    T.gen(function* () {
      const text = yield* T.tryPromise(() => readFile(path, 'utf8'), unreadable)
      const parsed = yield* T.attempt((): unknown => JSON.parse(text), unreadable)
      const decoded = CredentialFile.decode(parsed)
      if (decoded._tag === 'Err') return yield* T.fail(unreadable())
      return decoded.value
    }),
  )

const unreadable = () => 'unreadable' as const
