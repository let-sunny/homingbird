import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/failure.ts'
import { ME } from './runner-support.ts'
import {
  AGENT_FILE,
  AGENT_TOKEN,
  DIRECTORY,
  HOME,
  SERVER,
  type WorldOptions,
  agentFileFor,
  world,
} from './support.ts'

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
      if (new URL(url).pathname === '/api/v1/info')
        return Response.json({
          name: 'dovecote',
          version: '0.1.3',
          contactMode: 'open',
          signInWith: 'Google',
        })
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

describe('a credentials file', () => {
  const FILE = '/run/secrets/homingbird.json'
  const FILE_TOKEN = 'hba_mounted-secret-token-0123456789ab'
  const inFile = (options: WorldOptions = {}) =>
    world({
      stubs: { 'me.get': () => ME, 'inbox.list': () => ({ items: [] }), 'directory.list': () => DIRECTORY },
      files: { [FILE]: JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }) },
      ...options,
    })
  const printed = (w: ReturnType<typeof world>): string => [...w.lines, ...w.problems].join('\n')

  it('is the only place a command reads the credential from, and is never written to', async () => {
    const w = inFile()
    expect(await w.run('status', '--credentials-file', FILE)).toBe(0)
    expect(w.lines[0]).toContain(`Read from:      ${FILE}`)
    expect(w.calls.some((call) => call.route === 'me.get')).toBe(true)
    expect(new Set(w.calls.map((call) => call.authorization ?? `Bearer ${FILE_TOKEN}`))).toEqual(
      new Set([`Bearer ${FILE_TOKEN}`]),
    )
    expect(w.reads).not.toContain(AGENT_FILE)
    expect(w.privateWrites).toEqual([])
    expect(w.ownerOnlyWrites).toEqual([])
    expect(printed(w)).not.toContain(FILE_TOKEN)
    await w.run('status', '--credentials-file', FILE, '--json')
    expect(w.json()).toMatchObject({ signedIn: true, server: SERVER, credentialsFile: FILE, servers: [] })
  })

  it('is read from HOMINGBIRD_CREDENTIALS_FILE, and --credentials-file comes first', async () => {
    const w = inFile({ variables: { HOMINGBIRD_CREDENTIALS_FILE: ` ${FILE} ` } })
    expect(await w.run('inbox', '--json')).toBe(0)
    expect(w.calls.find((call) => call.route === 'inbox.list')?.authorization).toBe(`Bearer ${FILE_TOKEN}`)
    expect(await w.run('inbox', '--credentials-file', '/elsewhere.json')).toBe(EXIT.signedOut)
    expect(w.problems.at(-1)).toContain('/elsewhere.json does not exist')
  })

  it('stands in for several stored servers, without asking which', async () => {
    const w = inFile()
    w.files.set(agentFileFor(OTHER), JSON.stringify({ serverUrl: OTHER, token: OTHER_TOKEN }))
    expect(await w.run('status', '--credentials-file', FILE, '--json')).toBe(0)
    expect(w.json()).toMatchObject({ signedIn: true, server: SERVER, credentialsFile: FILE })
  })

  it('says why it cannot be used, quoting nothing it holds, and calls no server', async () => {
    const cases: Array<[WorldOptions, string[], number, string]> = [
      [
        { files: {} },
        [],
        EXIT.signedOut,
        `The credentials file ${FILE} does not exist. Create it on a computer where you can approve the sign-in: homingbird login --server <url> --credentials-file <path>`,
      ],
      [
        { unreadable: [FILE] },
        [],
        EXIT.failed,
        `The credentials file ${FILE} cannot be read by this user. Check its owner and permissions.`,
      ],
      [
        { files: { [FILE]: `{"token":"${FILE_TOKEN}"}` } },
        [],
        EXIT.failed,
        `The credentials file ${FILE} does not hold an agent credential. Create it on a computer where you can approve the sign-in: homingbird login --server <url> --credentials-file <path>`,
      ],
      [
        { files: { [FILE]: `token=${FILE_TOKEN}` } },
        [],
        EXIT.failed,
        `The credentials file ${FILE} does not hold an agent credential.`,
      ],
      [
        {},
        ['--server', `${OTHER}/`],
        EXIT.usage,
        `The credentials file ${FILE} is for ${SERVER}, not ${OTHER}.`,
      ],
    ]
    for (const [options, extra, exitCode, message] of cases) {
      const w = inFile(options)
      expect(await w.run('inbox', '--credentials-file', FILE, ...extra)).toBe(exitCode)
      expect(w.problems.at(-1)).toContain(message)
      expect(printed(w)).not.toContain(FILE_TOKEN)
      expect(w.calls).toEqual([])
    }
  })

  it('accepts the server it names, written either way', async () => {
    const w = inFile()
    expect(await w.run('inbox', '--credentials-file', FILE, '--server', `${SERVER}/`)).toBe(0)
  })

  it('warns, without failing, when its group or others can read it, but not on Windows', async () => {
    for (const mode of [0o644, 0o640, 0o604]) {
      const w = inFile({ modes: { [FILE]: mode } })
      expect(await w.run('inbox', '--credentials-file', FILE)).toBe(0)
      expect(w.problems).toEqual([
        `Warning: other users of this computer can read the credentials file ${FILE} (mode 0${mode.toString(8)}). Only its owner should: chmod 600 ${FILE}`,
      ])
    }
    for (const options of [
      { modes: { [FILE]: 0o600 } },
      { modes: { [FILE]: 0o400 } },
      { modes: { [FILE]: 0o644 }, platform: 'win32' },
    ]) {
      const w = inFile(options)
      expect(await w.run('inbox', '--credentials-file', FILE)).toBe(0)
      expect(w.problems).toEqual([])
    }
  })
})
