import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { EXIT } from '../src/failure.ts'
import { AGENT_FILE, AGENT_TOKEN, SERVER, world } from './support.ts'

const everythingPrinted = (w: ReturnType<typeof world>): string => [...w.lines, ...w.problems].join('\n')

describe('logout --credentials-file', () => {
  const FILE = '/run/secrets/homingbird.json'
  const FILE_TOKEN = 'hba_mounted-secret-token-0123456789ab'
  const withFile = (status: number, readOnly: boolean) =>
    world({
      files: { [FILE]: JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }) },
      other: () => new Response('{}', { status }),
      ...(readOnly && { readOnly: [FILE] }),
    })

  it('revokes the file’s credential on the server and deletes the file, leaving this device’s own', async () => {
    const w = withFile(200, false)
    expect(await w.run('logout', '--credentials-file', FILE)).toBe(0)
    expect(w.lines).toEqual([
      `Signed out of ${SERVER}. The server revoked the credential in ${FILE}, and the file was deleted.`,
    ])
    expect(w.files.has(FILE)).toBe(false)
    expect(w.files.has(AGENT_FILE)).toBe(true)
    expect(w.calls.map((call) => new URLSearchParams(call.body).get('token'))).toEqual([FILE_TOKEN])
    expect(everythingPrinted(w)).not.toMatch(/hb[ah]_/)
  })

  it('leaves a read-only file in place and says what is left to do', async () => {
    const w = withFile(200, true)
    expect(await w.run('logout', '--credentials-file', FILE, '--json')).toBe(0)
    expect(w.json()).toEqual({
      signedOut: true,
      server: SERVER,
      credentialsFile: FILE,
      removedLocally: false,
      revokedOnServer: true,
    })
    expect(w.files.has(FILE)).toBe(true)
    const text = withFile(200, true)
    await text.run('logout', '--credentials-file', FILE)
    expect(text.lines).toEqual([
      `Signed out of ${SERVER}. The server revoked the credential in ${FILE}. The file is read-only here, so it was left in place: delete it, or the secret it comes from, where it is stored.`,
    ])
  })

  it('says to revoke in the web client when the server does not confirm, whether or not the file could go', async () => {
    const writable = withFile(503, false)
    expect(await writable.run('logout', '--credentials-file', FILE)).toBe(0)
    expect(writable.lines).toEqual([
      `Deleted ${FILE}, but the server did not confirm that it revoked the credential, so it may still work. Revoke it in the web client's device list.`,
    ])
    expect(writable.files.has(FILE)).toBe(false)
    const readOnly = withFile(503, true)
    expect(await readOnly.run('logout', '--credentials-file', FILE, '--json')).toBe(0)
    expect(readOnly.json()).toMatchObject({ signedOut: false, removedLocally: false, revokedOnServer: false })
    const text = withFile(503, true)
    await text.run('logout', '--credentials-file', FILE)
    expect(text.lines).toEqual([
      `The server did not confirm that it revoked the credential in ${FILE}, and the file is read-only here, so it was left in place. Revoke it in the web client's device list.`,
    ])
  })

  it('reports a file whose removal fails as left in place', async () => {
    const w = withFile(200, false)
    const files = { ...w.env.files, remove: () => T.die(new Error('read-only file system')) }
    const exit = await T.run(runCli(['logout', '--credentials-file', FILE, '--json']), { ...w.env, files })
    expect(exit).toEqual({ _tag: 'Ok', value: 0 })
    expect(w.json()).toMatchObject({ removedLocally: false, revokedOnServer: true })
  })

  it('signs out of nothing when the file cannot be used', async () => {
    const w = withFile(200, false)
    expect(await w.run('logout', '--credentials-file', '/missing.json')).toBe(EXIT.signedOut)
    expect(w.calls).toEqual([])
    expect(w.files.size).toBe(2)
  })
})

describe('logout', () => {
  it('says the server revoked the credential only when the server confirmed it, and removes its file', async () => {
    const w = world({ other: () => new Response('{}', { status: 200 }) })
    expect(await w.run('logout')).toBe(0)
    expect(w.lines).toEqual([
      `Signed out of ${SERVER}. The server revoked this device's credential, and it was removed from this device.`,
    ])
    expect(w.files.size).toBe(0)
    expect(
      w.calls.map((call) => [call.method, call.path, new URLSearchParams(call.body).get('token')]),
    ).toEqual([['POST', '/oauth/revoke', AGENT_TOKEN]])
    expect(everythingPrinted(w)).not.toMatch(/hb[ah]_/)
  })

  it('removes the files when the server cannot be reached, and says to revoke the credential in the web client', async () => {
    const offline = async () => {
      throw new Error('offline')
    }
    const w = world({ fetch: offline })
    expect(await w.run('logout')).toBe(0)
    expect(w.lines).toEqual([
      `Signed out of ${SERVER} on this device only: its credential was removed here, but the server did not confirm that it revoked it, so it may still work. Revoke it in the web client's device list.`,
    ])
    expect(w.files.size).toBe(0)
    const asJson = world({ fetch: offline })
    expect(await asJson.run('logout', '--json')).toBe(0)
    expect(asJson.json()).toEqual({
      signedOut: true,
      server: SERVER,
      removedLocally: true,
      revokedOnServer: false,
    })
  })

  it('does not claim a revocation the server refused', async () => {
    const w = world({ other: () => new Response('{}', { status: 503 }) })
    expect(await w.run('logout', '--json')).toBe(0)
    expect(w.json()).toMatchObject({ removedLocally: true, revokedOnServer: false })
    expect(w.files.size).toBe(0)
  })

  it('does nothing harmful when already signed out', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('logout')).toBe(0)
    expect(w.calls).toEqual([])
  })
})
