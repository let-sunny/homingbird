import { Unauthorized } from '@homingbird/protocol'
import { describe, expect, it } from 'vitest'
import { EXIT, SIGNED_OUT_MESSAGE } from '../src/failure.ts'
import { INFO, ME, READING, everythingPrinted } from './command-fixtures.ts'
import { AGENT_FILE, AGENT_TOKEN, SERVER, world } from './support.ts'

describe('status', () => {
  it('says in one sentence to upgrade when the server speaks a protocol it cannot read', async () => {
    const w = world({ stubs: { ...READING, 'server.info': () => ({ ...INFO, protocolVersion: 2 }) } })
    expect(await w.run('status')).not.toBe(0)
    expect(w.problems).toEqual([
      'This Homingbird server is newer than this client understands; upgrade the client.',
    ])
    expect(w.calls.map((call) => call.route)).toEqual(['server.info'])
  })

  it('says who is signed in, where, with which credential and in which language', async () => {
    const w = world({ stubs: READING })
    expect(await w.run('status')).toBe(0)
    expect(w.lines[0]).toBe(
      [
        `Server:         ${SERVER}`,
        'Signed in as:   Ana <ana@example.com>',
        'Credential:     Laptop (agent)',
        'Language:       follows the browser',
        'Transport:      server-sent events, falling back to long-poll',
        'Desk:           on',
      ].join('\n'),
    )
    expect(w.calls).toMatchObject([
      { route: 'server.info', authorization: `Bearer ${AGENT_TOKEN}` },
      { route: 'me.get', authorization: `Bearer ${AGENT_TOKEN}` },
    ])
  })

  it('reports the same as JSON, with the member’s language, and never prints a token', async () => {
    const w = world({
      stubs: { ...READING, 'me.get': () => ({ ...(ME as object), locale: 'ko' }) as never },
      signedIn: 'agent',
    })
    await w.run('status', '--json')
    expect(w.json()).toMatchObject({
      signedIn: true,
      server: SERVER,
      locale: 'ko',
      member: { name: 'Ana' },
    })
    expect(everythingPrinted(w)).not.toContain(AGENT_TOKEN)
  })

  it('says not signed in without calling the server', async () => {
    const w = world({ signedIn: 'none' })
    expect(await w.run('status')).toBe(0)
    expect(w.lines).toEqual(['Not signed in.'])
    await w.run('status', '--json')
    expect(w.json()).toEqual({ signedIn: false, servers: [] })
    expect(w.calls).toEqual([])
  })

  it('treats a corrupt or foreign credential file as signed out', async () => {
    for (const content of ['not json', '{"serverUrl":"ftp://x","token":"t"}', '{"serverUrl":"https://x"}']) {
      const w = world({ signedIn: 'none' })
      w.files.set(AGENT_FILE, content)
      await w.run('status')
      expect(w.lines).toEqual(['Not signed in.'])
    }
  })

  it('finds its credentials under XDG_CONFIG_HOME when that is set', async () => {
    const w = world({ stubs: READING, signedIn: 'none', variables: { XDG_CONFIG_HOME: '/xdg' } })
    w.files.set(
      `/xdg/homingbird/agents/${encodeURIComponent(SERVER)}.json`,
      JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN }),
    )
    await w.run('status', '--json')
    expect(w.json().signedIn).toBe(true)
  })

  it('exits 3 and says how to sign in when the server no longer accepts the credential', async () => {
    const w = world({ stubs: { 'me.get': () => Unauthorized({ message: 'expired' }) } })
    expect(await w.run('status')).toBe(EXIT.signedOut)
    expect(w.problems).toEqual([SIGNED_OUT_MESSAGE])
  })
})
