import { describe, expect, it } from 'vitest'
import { AS_THE_PERSON } from '../src/commands/service.ts'
import { EXIT } from '../src/failure.ts'
import { ME } from './runner-support.ts'
import { AGENT_FILE, ANA, type Call, HOME, SERVER, channelNamed, world } from './support.ts'

const CODE = 'hbj_join-code-0123456789abcdefghijklmnopqrstu'
const NEW_AGENT = 'hba_new-agent-token-0123456789abcdef'
const UNIT = `${HOME}/.config/systemd/user/homingbird-runner-https-hb-example-com.service`

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status })

const joining =
  (status = 200, body: unknown = { access_token: NEW_AGENT, expires_in: 3600 }) =>
  (call: Call): Response | undefined =>
    call.path === '/oauth/join' ? json(status, body) : undefined

const fresh = (options: Parameters<typeof world>[0] = {}) =>
  world({ signedIn: 'none', stubs: { 'me.get': () => ME }, other: joining(), ...options })

const everything = (w: ReturnType<typeof world>) => [...w.lines, ...w.problems].join('\n')

describe('homingbird setup', () => {
  it('redeems the join code, keeps the credential where login would, readable by its owner only, and installs the service', async () => {
    const w = fresh()
    expect(await w.run('setup', '--server', SERVER, '--join', CODE, '--agent', 'claude')).toBe(0)
    const redeemed = w.calls.find((call) => call.path === '/oauth/join')!
    expect(new URLSearchParams(redeemed.body).get('code')).toBe(CODE)
    expect(new URLSearchParams(redeemed.body).get('client_kind')).toBe('cli')
    expect(JSON.parse(w.files.get(AGENT_FILE)!)).toEqual({ serverUrl: SERVER, token: NEW_AGENT })
    expect(w.privateWrites).toContain(AGENT_FILE)
    expect(w.files.get(UNIT)).toContain(`"run" "--service" "--server" "${SERVER}" "--agent" "claude"`)
    expect(w.processRuns.at(-1)).toEqual([
      'systemctl',
      '--user',
      'restart',
      'homingbird-runner-https-hb-example-com.service',
    ])
    expect(w.lines.at(-1)).toMatch(/^Signed in to https:\/\/hb\.example\.com as Ana\.\nInstalled /)
    expect(w.lines.at(-1)).toMatch(
      /\nNext: notes that arrive for you are drafted here and wait for your approval/,
    )
    expect(w.lines.at(-1)).not.toContain('The service waits until you sign in')
    expect(everything(w)).not.toContain(NEW_AGENT)
    expect(everything(w)).not.toContain(CODE)
  })

  it('passes the service options through, and says what it set up in JSON', async () => {
    const w = fresh()
    w.files.set('/srv', '')
    const argv = ['setup', '--server', SERVER, '--join', CODE, '--agent', 'codex', '--timeout', '90']
    expect(await w.run(...argv, '--split', '--workdir', '/srv', '--json')).toBe(0)
    expect(w.files.get(UNIT)).toContain('"--agent" "codex" "--timeout" "90" "--split"')
    expect(w.files.get(UNIT)).toContain('WorkingDirectory=/srv')
    expect(w.json()).toMatchObject({
      step: 'set_up',
      server: SERVER,
      member: { id: ANA.id },
      service: { installed: true, signedIn: true },
    })
    expect(JSON.stringify(w.json())).not.toContain(NEW_AGENT)
  })

  it('only signs in with --no-service, and says how to start the desk', async () => {
    const w = fresh()
    expect(await w.run('setup', '--server', SERVER, '--join', CODE, '--no-service')).toBe(0)
    expect(w.files.has(AGENT_FILE)).toBe(true)
    expect(w.processRuns).toEqual([])
    expect(w.lines.at(-1)).toBe(
      `Signed in to ${SERVER} as Ana.\nStart its desk here with: homingbird service install --server ${SERVER} --agent <command or preset>`,
    )
  })

  it('writes to a credentials file it is given, and never replaces one without --force', async () => {
    const FILE = '/home/june/secrets/homingbird.json'
    const w = fresh({ files: { [FILE]: 'old' } })
    const argv = ['setup', '--server', SERVER, '--join', CODE, '--no-service', '--credentials-file', FILE]
    expect(await w.run(...argv)).toBe(EXIT.usage)
    expect(w.calls.some((call) => call.path === '/oauth/join')).toBe(false)
    expect(await w.run(...argv, '--force')).toBe(0)
    expect(JSON.parse(w.files.get(FILE)!)).toEqual({ serverUrl: SERVER, token: NEW_AGENT })
    expect(w.files.has(AGENT_FILE)).toBe(false)
  })

  it('names a channel’s agent and where its managers review its answers', async () => {
    const w = fresh({
      stubs: {
        'me.get': () =>
          ({ ...(ME as object), member: { ...ANA, kind: 'channel_agent', name: 'Payments wiki' } }) as never,
        'channels.list': () =>
          ({
            channels: [channelNamed('payments-wiki', { id: ANA.id, name: 'Payments wiki' })],
            hasMore: false,
            cursor: null,
          }) as never,
      },
    })
    expect(await w.run('setup', '--server', SERVER, '--join', CODE, '--agent', 'claude')).toBe(0)
    expect(w.lines.at(-1)).toContain(`Signed in to ${SERVER} as Payments wiki, the agent of #payments-wiki.`)
    expect(w.lines.at(-1)).toContain(
      `Next: its answers wait for the channel’s managers at ${SERVER}/#/channel/payments-wiki/agent.`,
    )
  })

  it('says why a code was refused, and writes nothing', async () => {
    const w = fresh({
      other: joining(400, {
        error: 'invalid_grant',
        error_description: 'This join code is unknown, expired or already used.',
      }),
    })
    expect(await w.run('setup', '--server', SERVER, '--join', CODE, '--agent', 'claude')).toBe(EXIT.failed)
    expect(w.problems).toEqual(['This join code is unknown, expired or already used.'])
    expect(w.files.size).toBe(0)
    expect(w.processRuns).toEqual([])
  })

  it('refuses to run as root before it spends the code', async () => {
    const w = fresh({ userId: 0 })
    expect(await w.run('setup', '--server', SERVER, '--join', CODE, '--agent', 'claude')).toBe(EXIT.failed)
    expect(w.problems).toEqual([AS_THE_PERSON])
    expect(w.calls).toEqual([])
  })

  it('keeps the credential when the service cannot be installed, and says the one command left', async () => {
    const w = fresh({ platform: 'aix' })
    expect(await w.run('setup', '--server', SERVER, '--join', CODE, '--agent', 'claude')).toBe(EXIT.failed)
    expect(w.files.has(AGENT_FILE)).toBe(true)
    expect(w.problems[0]).toBe(
      `Signed in to ${SERVER} as Ana. The credential is saved, but the service was not installed: The service runs on macOS, Linux and Windows, not on aix.\nFix that, then run: homingbird service install --server ${SERVER} --agent claude`,
    )
    expect(everything(w)).not.toContain(NEW_AGENT)
  })

  it('needs a server, a join code that looks like one, and an agent unless it only signs in', async () => {
    const w = fresh()
    expect(await w.run('setup', '--join', CODE, '--agent', 'claude')).toBe(EXIT.usage)
    expect(await w.run('setup', '--server', SERVER, '--join', 'BCDF-GHJK', '--agent', 'claude')).toBe(
      EXIT.usage,
    )
    expect(w.problems.at(-1)).toMatch(/^That is not a join code/)
    expect(w.problems.at(-1)).not.toContain('BCDF-GHJK')
    expect(await w.run('setup', '--server', SERVER, '--join', CODE)).toBe(EXIT.usage)
    expect(w.problems.at(-1)).toMatch(/^setup needs --agent/)
    expect(
      await w.run('setup', '--server', SERVER, '--join', CODE, '--no-service', '--agent', 'claude'),
    ).toBe(EXIT.usage)
    expect(w.calls).toEqual([])
  })
})
