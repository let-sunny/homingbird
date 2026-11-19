import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.ts'
import { EXIT } from '../src/failure.ts'
import { ME } from './runner-support.ts'
import { AGENT_FILE, AGENT_TOKEN, type Call, SERVER, world } from './support.ts'

const NEW_AGENT = 'hba_new-agent-token-0123456789abcdef'

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status })

const approvedAtOnce = (call: Call): Response | undefined => {
  if (call.path === '/oauth/device_authorization')
    return json(200, {
      device_code: 'device-code',
      user_code: 'BCDF-GHJK',
      verification_uri: `${SERVER}/#/device`,
      verification_uri_complete: `${SERVER}/#/device/BCDF-GHJK`,
      expires_in: 600,
      interval: 5,
    })
  if (call.path === '/oauth/token') return json(200, { access_token: NEW_AGENT, expires_in: 3600 })
  return undefined
}

describe('login --credentials-file', () => {
  const FILE = '/home/june/secrets/homingbird-server.json'
  const approving = (options: { files?: Record<string, string> } = {}) =>
    world({
      signedIn: 'none',
      stubs: { 'me.get': () => ME },
      other: approvedAtOnce,
      ...options,
    })

  it('signs in as always, writes the credential to that file only, and says where, never the token', async () => {
    const w = approving()
    const running = w.run('login', '--server', SERVER, '--credentials-file', FILE, '--no-browser')
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    expect(JSON.parse(w.files.get(FILE)!)).toEqual({ serverUrl: SERVER, token: NEW_AGENT })
    expect([...w.files.keys()]).toEqual([FILE])
    expect(w.privateWrites).toEqual([])
    expect(w.lines.at(-1)).toBe(
      `Signed in to ${SERVER} as Ana <ana@example.com>.\nWrote the agent credential to ${FILE}, readable by you only. Store it as a secret, give it to one runner with --credentials-file or HOMINGBIRD_CREDENTIALS_FILE, and delete this copy; it can read and draft as you, never send.`,
    )
    expect([...w.lines, ...w.problems].join('\n')).not.toContain(NEW_AGENT)
  })

  it('reports the file it wrote as JSON, and takes it from HOMINGBIRD_CREDENTIALS_FILE too', async () => {
    const w = approving()
    const running = w.run('login', '--server', SERVER, '--json')
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    expect(w.files.has(AGENT_FILE)).toBe(true)
    const fromVariable = world({
      signedIn: 'none',
      variables: { HOMINGBIRD_CREDENTIALS_FILE: FILE },
      stubs: { 'me.get': () => ME },
      other: approvedAtOnce,
    })
    const second = fromVariable.run('login', '--server', SERVER, '--json')
    await fromVariable.clock.advance(5_000)
    expect(await second).toBe(0)
    expect(fromVariable.json()).toMatchObject({ step: 'signed_in', server: SERVER, credentialsFile: FILE })
    expect(JSON.stringify(fromVariable.json())).not.toContain(NEW_AGENT)
    expect([...fromVariable.files.keys()]).toEqual([FILE])
  })

  it('refuses to replace a file that exists, before anyone is asked to approve, unless --force', async () => {
    const earlier = JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN })
    const w = approving({ files: { [FILE]: earlier } })
    expect(await w.run('login', '--server', SERVER, '--credentials-file', FILE)).toBe(EXIT.usage)
    expect(w.problems).toEqual([
      `${FILE} already exists. Pass --force to replace it, or choose another path.`,
    ])
    expect(w.calls).toEqual([])
    expect(w.files.get(FILE)).toBe(earlier)
    const running = w.run('login', '--server', SERVER, '--credentials-file', FILE, '--force')
    await w.clock.advance(5_000)
    expect(await running).toBe(0)
    expect(JSON.parse(w.files.get(FILE)!)).toEqual({ serverUrl: SERVER, token: NEW_AGENT })
    expect(w.ownerOnlyWrites).toEqual([FILE])
  })

  it('refuses a file that appears while the person approves, and --force without a file', async () => {
    const w = approving()
    const running = w.run('login', '--server', SERVER, '--credentials-file', FILE)
    w.files.set(FILE, 'someone else’s')
    await w.clock.advance(5_000)
    expect(await running).toBe(EXIT.usage)
    expect(w.files.get(FILE)).toBe('someone else’s')
    expect(await w.run('login', '--server', SERVER, '--force')).toBe(EXIT.usage)
    expect(w.problems.at(-1)).toBe('--force goes with --credentials-file.')
    expect(await w.run('status', '--force')).toBe(EXIT.usage)
  })

  it('says why a credentials file could not be written, quoting nothing it would have held', async () => {
    const refusing = (force: boolean, problem: unknown) => {
      const w = approving()
      const files = {
        ...w.env.files,
        createExclusive: () => T.die(problem),
        writeOwnerOnly: () => T.die(problem),
      }
      const argv = ['login', '--server', SERVER, '--credentials-file', FILE, ...(force ? ['--force'] : [])]
      const running = T.run(runCli(argv), { ...w.env, files })
      return { w, running }
    }
    const denied = refusing(false, new Error('EACCES: permission denied'))
    await denied.w.clock.advance(5_000)
    expect(await denied.running).toEqual({ _tag: 'Ok', value: EXIT.failed })
    expect(denied.w.problems).toEqual([`Could not write ${FILE}: EACCES: permission denied`])
    const full = refusing(true, 'no space left on device')
    await full.w.clock.advance(5_000)
    expect(await full.running).toEqual({ _tag: 'Ok', value: EXIT.failed })
    expect(full.w.problems).toEqual([`Could not write ${FILE}: no space left on device`])
    expect([...denied.w.problems, ...full.w.problems].join('\n')).not.toContain(NEW_AGENT)
    expect(full.w.files.has(FILE)).toBe(false)
  })
})
