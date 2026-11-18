import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/failure.ts'
import { AGENT_TOKEN, HOME, SERVER, agentFileFor, world } from './support.ts'

const OTHER = 'https://other.example.org'
const OTHER_TOKEN = 'hba_other-server-token-0123456789abcd'
const ANA = {
  id: 'mem_aaaaaaaaaaaaaaaa',
  name: 'Ana',
  email: 'ana@example.com',
  role: 'member',
  status: 'active',
}
const BEN = {
  id: 'mem_bbbbbbbbbbbbbbbb',
  name: 'Ben',
  email: 'ben@other.org',
  role: 'member',
  status: 'active',
}

const signedInTwice = (variables: Readonly<Record<string, string>> = {}) => {
  const authorizations: Array<string | null> = []
  const w = world({
    variables,
    fetch: async (url, init = {}) => {
      const authorization = new Headers(init.headers).get('authorization')
      authorizations.push(authorization)
      if (new URL(url).pathname === '/oauth/revoke') return new Response('{}', { status: 200 })
      const member = authorization === `Bearer ${OTHER_TOKEN}` ? BEN : ANA
      return Response.json({
        member: { ...member, profile: '', characterSpec: null, character: null, createdAt: 1 },
        credential: { id: 'cred_aaaaaaaaaaaa', kind: 'agent', name: 'Laptop' },
        contactMode: 'open',
      })
    },
  })
  w.files.set(agentFileFor(OTHER), JSON.stringify({ serverUrl: OTHER, token: OTHER_TOKEN }))
  return { ...w, authorizations }
}

describe('one agent credential per server', () => {
  it('keeps each server’s credential in its own private file, keyed by address', () => {
    expect(agentFileFor('https://hb.example.com/')).toBe(
      `${HOME}/.config/homingbird/agents/${encodeURIComponent('https://hb.example.com')}.json`,
    )
    expect(agentFileFor('https://hb.example.com:8443/team')).not.toBe(agentFileFor('https://hb.example.com'))
  })

  it('reproduction: signing out of one server never makes another server’s identity appear', async () => {
    const w = signedInTwice()
    expect(await w.run('logout', '--server', OTHER)).toBe(0)
    expect(w.files.has(agentFileFor(OTHER))).toBe(false)
    expect(w.files.has(agentFileFor(SERVER))).toBe(true)
    await w.run('overview', '--server', OTHER, '--json')
    expect(w.json()).toEqual({ signedIn: false, server: OTHER })
    await w.run('status', '--server', OTHER, '--json')
    expect(w.json()).toMatchObject({ signedIn: false, server: OTHER })
    expect(w.authorizations).not.toContain(`Bearer ${AGENT_TOKEN}`)
  })

  it('uses the server it is told to use, with --server or HOMINGBIRD_SERVER', async () => {
    const w = signedInTwice()
    await w.run('status', '--server', OTHER, '--json')
    expect(w.json()).toMatchObject({ server: OTHER, member: { name: 'Ben' } })
    const fromVariable = signedInTwice({ HOMINGBIRD_SERVER: `${SERVER}/` })
    await fromVariable.run('status', '--json')
    expect(fromVariable.json()).toMatchObject({ server: SERVER, member: { name: 'Ana' } })
  })

  it('with several servers and none named, lists them and asks which, instead of picking one', async () => {
    const w = signedInTwice()
    expect(await w.run('overview')).toBe(EXIT.usage)
    expect(w.problems.at(-1)).toBe(
      `Signed in to several servers: ${SERVER}, ${OTHER}. Say which with --server <url>.`,
    )
    expect(await w.run('logout')).toBe(EXIT.usage)
    expect(w.files.size).toBe(2)
    await w.run('status', '--json')
    expect(w.json()).toEqual({
      signedIn: true,
      servers: [
        { server: SERVER, member: { name: 'Ana', email: 'ana@example.com' } },
        { server: OTHER, member: { name: 'Ben', email: 'ben@other.org' } },
      ],
    })
  })

  it('with exactly one server stored and none named, uses it', async () => {
    const w = signedInTwice()
    await w.run('logout', '--server', OTHER)
    expect(await w.run('status', '--json')).toBe(0)
    expect(w.problems).toEqual([])
    expect(w.json()).toMatchObject({ signedIn: true, server: SERVER, servers: [SERVER] })
  })

  it('ignores the old shared credential file, and removes it at the next sign-in', async () => {
    const w = world({ signedIn: 'none' })
    const legacy = `${HOME}/.config/homingbird/agent-credential.json`
    w.files.set(legacy, JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN }))
    await w.run('status', '--json')
    expect(w.json()).toMatchObject({ signedIn: false })
    expect(w.calls).toEqual([])
  })

  it('refuses a file that holds another server’s credential', async () => {
    const w = world({ signedIn: 'none' })
    w.files.set(agentFileFor(OTHER), JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN }))
    await w.run('status', '--server', OTHER, '--json')
    expect(w.json()).toMatchObject({ signedIn: false })
  })
})
