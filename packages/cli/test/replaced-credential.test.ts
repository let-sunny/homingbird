import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { credentialToReplace, revokeReplaced } from '../src/replaced-credential.ts'
import { AGENT_FILE, AGENT_TOKEN, SERVER, world } from './support.ts'

const FILE = '/home/june/secrets/homingbird.json'

describe('credentialToReplace', () => {
  it('finds the stored credential for the server, or the one in the credentials file given', async () => {
    const stored = world()
    expect(await T.runPromise(credentialToReplace(SERVER), stored.env)).toEqual({
      serverUrl: SERVER,
      token: AGENT_TOKEN,
    })
    const inFile = world({
      signedIn: 'none',
      files: { [FILE]: JSON.stringify({ serverUrl: SERVER, token: 'hba_x' }) },
    })
    const env = { ...inFile.env, credentialsFile: FILE }
    expect(await T.runPromise(credentialToReplace(SERVER), env)).toEqual({
      serverUrl: SERVER,
      token: 'hba_x',
    })
  })

  it('finds nothing where no file is, or the file holds no credential for the server', async () => {
    const none = world({ signedIn: 'none' })
    expect(await T.runPromise(credentialToReplace(SERVER), { ...none.env, credentialsFile: FILE })).toBeNull()
    const other = world({ signedIn: 'none', files: { [FILE]: 'not json' } })
    expect(
      await T.runPromise(credentialToReplace(SERVER), { ...other.env, credentialsFile: FILE }),
    ).toBeNull()
    expect(await T.runPromise(credentialToReplace(SERVER), none.env)).toBeNull()
    expect(none.files.has(AGENT_FILE)).toBe(false)
  })
})

describe('revokeReplaced', () => {
  const current = { serverUrl: SERVER, token: 'hba_new' }

  it('asks nothing when nothing was replaced, or the same credential was written again', async () => {
    const w = world()
    await T.runPromise(revokeReplaced(null, current), w.env)
    await T.runPromise(revokeReplaced(current, current), w.env)
    expect(w.calls).toEqual([])
  })

  it('revokes the replaced credential, and warns only when the server does not confirm', async () => {
    const confirmed = world({ other: () => new Response('{}', { status: 200 }) })
    await T.runPromise(revokeReplaced({ serverUrl: SERVER, token: AGENT_TOKEN }, current), confirmed.env)
    expect(confirmed.calls.map((call) => call.path)).toEqual(['/oauth/revoke'])
    expect(confirmed.problems).toEqual([])
    const refused = world({ other: () => new Response('{}', { status: 400 }) })
    await T.runPromise(revokeReplaced({ serverUrl: SERVER, token: AGENT_TOKEN }, current), refused.env)
    expect(refused.problems).toHaveLength(1)
    expect(refused.problems[0]).not.toContain(AGENT_TOKEN)
  })
})
