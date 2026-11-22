import { describe, expect, it } from 'vitest'
import { EXIT } from '../src/failure.ts'
import { AGENT_FILE, ANA, type Call, HOME, SERVER, world } from './support.ts'

const ME = {
  member: ANA,
  credential: { id: 'cred_aaaaaaaaaaaa', kind: 'agent', name: 'Laptop' },
  contactMode: 'open',
} as never

const AUTHORIZATION = {
  device_code: 'device-code',
  user_code: 'BCDF-GHJK',
  verification_uri: `${SERVER}/#/device`,
  verification_uri_complete: `${SERVER}/#/device/BCDF-GHJK`,
  expires_in: 600,
  interval: 5,
}

const NEW_AGENT = 'hba_new-agent-token-0123456789abcdef'

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status })

const deviceServer = (answers: ReadonlyArray<() => Response>) => {
  let polls = 0
  return (call: Call): Response | undefined => {
    if (call.path === '/oauth/device_authorization') return json(200, AUTHORIZATION)
    if (call.path === '/oauth/token') return answers[Math.min(polls++, answers.length - 1)]!()
    return undefined
  }
}

const pending = () => json(400, { error: 'authorization_pending' })

describe('login', () => {
  it('shows where to approve, waits, then stores the agent credential privately', async () => {
    const w = world({
      signedIn: 'none',
      stubs: { 'me.get': () => ME },
      other: deviceServer([pending, () => json(200, { access_token: NEW_AGENT, expires_in: 3600 })]),
    })
    const legacy = `${HOME}/.config/homingbird/agent-credential.json`
    w.files.set(legacy, JSON.stringify({ serverUrl: 'https://elsewhere.example', token: 'hba_old' }))
    const running = w.run('login', '--server', `${SERVER}/`)
    await w.clock.advance(5_000)
    expect(w.lines).toEqual([`Open ${SERVER}/#/device/BCDF-GHJK\nand confirm the code BCDF-GHJK`])
    expect(w.files.has(AGENT_FILE)).toBe(false)
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    expect(w.lines.at(-1)).toBe(
      `Signed in to ${SERVER} as Ana <ana@example.com>.\nKeep one desk, the one session that answers arriving notes: a Claude Code session with the Homingbird plugin’s pane open, an MCP client started as the desk (homingbird-mcp with --run-agent, or --desk in Claude Code), or homingbird run. Other sessions draft only what you ask.`,
    )
    expect(JSON.parse(w.files.get(AGENT_FILE)!)).toEqual({ serverUrl: SERVER, token: NEW_AGENT })
    expect(w.files.has(legacy)).toBe(false)
    expect(w.privateWrites).toEqual([AGENT_FILE])
    expect([...w.lines, ...w.problems].join('\n')).not.toContain(NEW_AGENT)
    const started = w.calls.find((call) => call.path === '/oauth/device_authorization')!
    expect(Object.fromEntries(new URLSearchParams(started.body))).toEqual({
      client_name: 'Homingbird CLI',
      client_kind: 'cli',
      scope: 'notes',
    })
  })

  it('opens the browser at the approval page with the code filled in', async () => {
    const w = world({
      signedIn: 'none',
      browser: () => true,
      stubs: { 'me.get': () => ME },
      other: deviceServer([() => json(200, { access_token: NEW_AGENT, expires_in: 3600 })]),
    })
    const running = w.run('login', '--server', SERVER)
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    expect(w.opened).toEqual([`${SERVER}/#/device/BCDF-GHJK`])
    expect(w.lines[0]).toBe(
      `Opened ${SERVER}/#/device/BCDF-GHJK in your browser.\nThe code BCDF-GHJK is filled in there: confirm it to finish.`,
    )
  })

  it('opens no browser with --no-browser, nor for an approval page on another server', async () => {
    const quiet = world({
      signedIn: 'none',
      browser: () => true,
      stubs: { 'me.get': () => ME },
      other: deviceServer([() => json(200, { access_token: NEW_AGENT, expires_in: 3600 })]),
    })
    const running = quiet.run('login', '--server', SERVER, '--no-browser')
    await quiet.clock.advance(5_000)
    expect(await running).toBe(0)
    expect(quiet.opened).toEqual([])

    const elsewhere = world({
      signedIn: 'none',
      browser: () => true,
      stubs: { 'me.get': () => ME },
      other: (call) =>
        call.path === '/oauth/device_authorization'
          ? json(200, {
              ...AUTHORIZATION,
              verification_uri_complete: 'https://evil.example/#/device/BCDF-GHJK',
            })
          : deviceServer([() => json(200, { access_token: NEW_AGENT, expires_in: 3600 })])(call),
    })
    const second = elsewhere.run('login', '--server', SERVER)
    await elsewhere.clock.advance(5_000)
    expect(await second).toBe(0)
    expect(elsewhere.opened).toEqual([])
    expect(elsewhere.lines[0]).toMatch(/^Open https:\/\/evil\.example/)
  })

  it('asks for the notes scope only, under the given name, and stores one credential', async () => {
    const w = world({
      signedIn: 'none',
      stubs: { 'me.get': () => ME },
      other: deviceServer([() => json(200, { access_token: NEW_AGENT, expires_in: 3600 })]),
    })
    const running = w.run('login', '--server', SERVER, '--name', 'Work laptop', '--json')
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    const started = w.calls.find((call) => call.path === '/oauth/device_authorization')!
    expect(Object.fromEntries(new URLSearchParams(started.body))).toEqual({
      client_name: 'Work laptop',
      client_kind: 'cli',
      scope: 'notes',
    })
    expect(JSON.parse(w.lines[0]!)).toEqual({
      step: 'awaiting_approval',
      verificationUri: `${SERVER}/#/device/BCDF-GHJK`,
      userCode: 'BCDF-GHJK',
      expiresInSeconds: 600,
      browserOpened: false,
    })
    expect(w.json()).toMatchObject({
      step: 'signed_in',
      server: SERVER,
      member: { email: 'ana@example.com' },
    })
    expect(w.privateWrites).toEqual([AGENT_FILE])
    expect(w.lines.join('\n')).not.toMatch(/hb[ah]_new/)
  })

  it('says it signs in for the plugin when the plugin runs it', async () => {
    const w = world({
      signedIn: 'none',
      variables: { HOMINGBIRD_CLIENT_KIND: 'plugin' },
      stubs: { 'me.get': () => ME },
      other: deviceServer([() => json(200, { access_token: NEW_AGENT, expires_in: 3600 })]),
    })
    const running = w.run('login', '--server', SERVER, '--json')
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    const started = w.calls.find((call) => call.path === '/oauth/device_authorization')!
    expect(new URLSearchParams(started.body).get('client_kind')).toBe('plugin')
  })

  it('fails when the request is denied, expires, or the server is unreachable, storing nothing', async () => {
    const denied = world({
      signedIn: 'none',
      other: deviceServer([() => json(400, { error: 'access_denied' })]),
    })
    const running = denied.run('login', '--server', SERVER)
    await denied.clock.advance(5_000)
    expect(await running).toBe(EXIT.failed)
    expect(denied.problems).toEqual(['The request was denied in the browser.'])
    expect(denied.files.size).toBe(0)

    const unreachable = world({
      signedIn: 'none',
      fetch: async () => {
        throw new Error('offline')
      },
    })
    expect(await unreachable.run('login', '--server', SERVER)).toBe(EXIT.failed)
    expect(unreachable.problems).toEqual(['The Homingbird server could not be reached.'])
  })

  it('reports a server that issues a credential it then refuses', async () => {
    const w = world({
      signedIn: 'none',
      other: deviceServer([() => json(200, { access_token: NEW_AGENT, expires_in: 3600 })]),
    })
    const running = w.run('login', '--server', SERVER)
    await w.clock.advance(5_000)
    expect(await running).toBe(EXIT.failed)
  })
})
