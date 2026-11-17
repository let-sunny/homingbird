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
  T.gen(function* () {
    const all = yield* readAll(path)
    yield* T.promise(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path, JSON.stringify({ ...all, [serverUrl]: credential }, null, 2), { mode: 0o600 })
      await chmod(path, 0o600)
    })
  })

const CredentialFile = S.record(S.struct({ token: S.string({ minLength: 1 }), expiresAt: S.number() }))

const readAll = (path: string): T.Task<Readonly<Record<string, StoredCredential>>> =>
  T.catchAll(() => T.succeed({}))(
    T.tryPromise(
      async () => {
        const decoded = CredentialFile.decode(JSON.parse(await readFile(path, 'utf8')))
        if (decoded._tag === 'Err') throw new Error('unreadable credential file')
        return decoded.value
      },
      () => 'unreadable' as const,
    ),
  )
