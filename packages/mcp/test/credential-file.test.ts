import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Task as T } from '@homingbird/kernel'
import { beforeEach, describe, expect, it } from 'vitest'
import { credentialFilePath, readCredential, storeCredential } from '../src/credential-file.ts'

let path: string

beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), 'homingbird-mcp-')), 'nested', 'mcp-credentials.json')
})

const SERVER = 'https://hb.example.com'
const CREDENTIAL = { token: 'hba_test-token', expiresAt: 1_800_000_000_000 }

describe('credentialFilePath', () => {
  it('uses XDG_CONFIG_HOME when it is set, and ~/.config otherwise', () => {
    expect(credentialFilePath({ XDG_CONFIG_HOME: '/xdg' }, '/home/june')).toBe('/xdg/homingbird/mcp-credentials.json')
    expect(credentialFilePath({}, '/home/june')).toBe('/home/june/.config/homingbird/mcp-credentials.json')
    expect(credentialFilePath({ XDG_CONFIG_HOME: '' }, '/home/june')).toBe(
      '/home/june/.config/homingbird/mcp-credentials.json',
    )
  })
})

describe('the credential file', () => {
  it('has nothing for a server before anything is stored', async () => {
    expect(await T.runPromise(readCredential(path, SERVER))).toBeNull()
  })

  it('stores a credential readable only by its owner, in a directory only the owner can enter', async () => {
    await T.runPromise(storeCredential(path, SERVER, CREDENTIAL))
    expect(await T.runPromise(readCredential(path, SERVER))).toEqual(CREDENTIAL)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(path, '..'))).mode & 0o777).toBe(0o700)
  })

  it('keeps one credential per server', async () => {
    await T.runPromise(storeCredential(path, SERVER, CREDENTIAL))
    await T.runPromise(storeCredential(path, 'https://other.example.com', { ...CREDENTIAL, token: 'hba_other' }))
    await T.runPromise(storeCredential(path, SERVER, { ...CREDENTIAL, token: 'hba_renewed' }))
    expect((await T.runPromise(readCredential(path, SERVER)))?.token).toBe('hba_renewed')
    expect((await T.runPromise(readCredential(path, 'https://other.example.com')))?.token).toBe('hba_other')
    expect(Object.keys(JSON.parse(await readFile(path, 'utf8')))).toHaveLength(2)
  })

  it('tightens the mode of a file that was left readable', async () => {
    await T.runPromise(storeCredential(path, SERVER, CREDENTIAL))
    await writeFile(path, '{}', { mode: 0o644 })
    await T.runPromise(storeCredential(path, SERVER, CREDENTIAL))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it.each(['not json', '[]', '{"https://hb.example.com":{"token":""}}', '{"https://hb.example.com":{"token":7,"expiresAt":1}}'])(
    'treats an unreadable file as empty: %s',
    async (content) => {
      await T.runPromise(storeCredential(path, 'https://seed.example.com', CREDENTIAL))
      await writeFile(path, content)
      expect(await T.runPromise(readCredential(path, SERVER))).toBeNull()
    },
  )
})
