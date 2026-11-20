import { Task as T } from '@homingbird/kernel'
import { describe, expect, it } from 'vitest'
import { SERVICE_RETRY_MS, SIGN_IN_CHECK_MS, STOP_CHECK_MS } from '../src/commands/run-as-service.ts'
import { DESK_HEARTBEAT_MS } from '../src/desk-claim.ts'
import type { Files } from '../src/environment.ts'
import { EXIT } from '../src/failure.ts'
import { serviceMissingPath } from '../src/service-definition.ts'
import { ME, QUESTION, REQUEST, once, runner, settle, waitingQuestion } from './runner-support.ts'
import { AGENT_FILE, AGENT_TOKEN, HOME, SERVER, world } from './support.ts'

describe('homingbird run --service', () => {
  const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /

  it('waits for a sign-in instead of stopping, and starts once there is one', async () => {
    const r = runner({ signedIn: 'none', argv: ['--service', '--server', SERVER] })
    await settle(() => r.w.lines.length === 1)
    expect(r.w.lines[0]).toMatch(STAMP)
    expect(r.w.lines[0]).toContain(`Sign in first: homingbird login --server ${SERVER}`)
    await r.w.clock.advance(SIGN_IN_CHECK_MS * 2)
    expect(r.w.lines).toHaveLength(1)
    r.w.files.set(AGENT_FILE, JSON.stringify({ serverUrl: SERVER, token: AGENT_TOKEN }))
    await r.w.clock.advance(SIGN_IN_CHECK_MS)
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    const online = r.w.lines.find((line) => line.includes('Answering notes'))!.split('\n')
    expect(online.length).toBeGreaterThan(1)
    for (const line of online) expect(line).toMatch(STAMP)
    await r.stop()
  })

  it('says once that a preset’s program is missing from its PATH, waits for no note, and starts once it is there', async () => {
    let installed = false
    const r = runner({
      argv: ['--service', '--server', SERVER, '--agent', 'claude'],
      variables: { PATH: '/usr/local/bin' },
      runnable: (path) => installed && path === '/usr/local/bin/claude',
    })
    await settle(() => r.w.lines.length === 1)
    expect(r.w.lines[0]).toContain(
      'The agent command could not be found: "claude" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/claude, or set PATH. The service looks again every minute.',
    )
    expect(r.w.calls).toEqual([])
    const marker = serviceMissingPath(`${HOME}/.config/homingbird`, SERVER)
    await settle(() => r.w.files.has(marker))
    expect(r.w.files.get(marker)).toMatch(/^The agent command could not be found: "claude"/)
    await r.w.clock.advance(SERVICE_RETRY_MS * 2)
    expect(r.w.lines).toHaveLength(1)
    installed = true
    await r.w.clock.advance(SERVICE_RETRY_MS)
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    expect(r.w.files.has(marker)).toBe(false)
    await r.stop()
  })

  it('waits, saying why, while a preset command cannot be prepared, and starts once it can', async () => {
    let listed = false
    const r = runner({
      argv: ['--service', '--server', SERVER, '--agent', 'codex', '--split'],
      process: () => (listed ? { exitCode: 0, output: '[]' } : { exitCode: 1, output: '' }),
    })
    await settle(() => r.w.lines.length === 1)
    expect(r.w.lines[0]).toContain(
      'The reader command was not started: codex mcp list exited with code 1, so it could not be prepared as the codex preset intends. Give --reader a command of your own to run it anyway. The service looks again every minute.',
    )
    const marker = serviceMissingPath(`${HOME}/.config/homingbird`, SERVER)
    await settle(() => r.w.files.has(marker))
    listed = true
    await r.w.clock.advance(SERVICE_RETRY_MS)
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    expect(r.w.files.has(marker)).toBe(false)
    await r.stop()
  })

  it('does not tell the service manager’s log to press Ctrl-C', async () => {
    const r = runner({ argv: ['--service', '--server', SERVER] })
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    expect(r.w.lines.join('\n')).not.toContain('Ctrl-C')
    await r.stop()
  })

  it('waits for a new sign-in when the server refuses the credential', async () => {
    const r = runner({
      argv: ['--service', '--server', SERVER],
      stubs: { 'me.get': () => ({ _tag: 'Unauthorized', message: 'revoked' }) as never },
    })
    await settle(() => r.w.lines.some((line) => line.includes('Sign in again')))
    await r.w.clock.advance(SIGN_IN_CHECK_MS * 3)
    expect(r.w.calls.filter((call) => call.route === 'me.get')).toHaveLength(1)
    await r.stop()
  })

  it('tries again a minute after another failure', async () => {
    let failing = true
    const r = runner({
      argv: ['--service', '--server', SERVER],
      stubs: { 'me.get': () => (failing ? ({ _tag: 'Unavailable', message: 'down' } as never) : ME) },
    })
    await settle(() => r.w.lines.some((line) => line.endsWith('down Trying again in a minute.')))
    failing = false
    await r.w.clock.advance(SERVICE_RETRY_MS)
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    await r.stop()
  })

  it('keeps the reason an agent gave for a skip out of its log, and still gives it to the person', async () => {
    const released: unknown[] = []
    const r = runner({
      argv: ['--service', '--server', SERVER],
      stubs: {
        'inbox.list': once(waitingQuestion, { items: [] }),
        'draftRequests.list': once({ requests: [REQUEST] }, { requests: [] }),
        'notes.release': (request) => {
          released.push(request)
          return QUESTION
        },
      },
      agent: () => ({ exitCode: 0, output: 'SKIP: Ben asks about the salary review.' }),
    })
    await settle(() => released.length === 1 && r.w.problems.length === 1)
    expect(released).toMatchObject([{ body: { reason: 'Ben asks about the salary review.' } }])
    expect([...r.w.lines, ...r.w.problems].join('\n')).not.toContain('salary')
    expect(r.w.lines.at(-1)).toContain(`Gave ${QUESTION.id} back without a draft.`)
    await r.stop()
  })

  it('needs the server it serves', async () => {
    const w = world()
    expect(await w.run('run', '--agent', 'claude', '--service')).toBe(EXIT.usage)
    expect(w.problems[0]).toMatch(STAMP)
    expect(w.problems[0]).toMatch(/Z run --service needs --server <url>\.$/)
  })
})

describe('homingbird run --service as its own supervisor', () => {
  const LOCK = '/home/june/.config/homingbird/desks/service-https-hb-example-com.lock'
  const STOP = '/home/june/.config/homingbird/desks/service-https-hb-example-com.stop'
  const service = (options: Parameters<typeof runner>[0] = {}) =>
    runner({ ...options, argv: ['--service', '--server', SERVER, ...(options.argv ?? [])] })

  it('holds one lock per server on this computer, so a second copy exits at once', async () => {
    const first = service()
    await settle(() => first.w.lines.some((line) => line.includes('Answering notes')))
    expect(JSON.parse(first.w.files.get(LOCK)!).holder).toBeTruthy()
    const second = world()
    second.files.set(LOCK, JSON.stringify({ holder: 'the-first-copy', heartbeatAt: second.clock.now() }))
    expect(await second.run('run', '--agent', 'claude', '--service', '--server', SERVER)).toBe(0)
    expect(second.lines.at(-1)).toContain(
      `The service for ${SERVER} already runs on this computer; this copy exits.`,
    )
    await first.stop()
    expect(first.w.files.has(LOCK)).toBe(false)
  })

  it('keeps its lock fresh while it runs', async () => {
    const r = service()
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    const before = JSON.parse(r.w.files.get(LOCK)!).heartbeatAt
    await r.w.clock.advance(DESK_HEARTBEAT_MS + STOP_CHECK_MS)
    await settle(() => JSON.parse(r.w.files.get(LOCK)!).heartbeatAt > before)
    await r.stop()
  })

  it('stops when its stop file appears, ending the agent command it is running, and releases its lock', async () => {
    let aborted = false
    const r = service({
      stubs: { 'inbox.list': () => waitingQuestion },
      agent: (_prompt, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('stopped'))
          }),
        ),
    })
    await settle(() => r.w.agentRuns.length === 1)
    r.w.files.set(STOP, '')
    await r.w.clock.advance(STOP_CHECK_MS)
    expect(await r.exit).toBe(0)
    expect(aborted).toBe(true)
    expect(r.w.files.has(STOP)).toBe(false)
    expect(r.w.files.has(LOCK)).toBe(false)
    expect(r.w.lines.at(-1)).toContain('Asked to stop; stopping the agent command and exiting.')
  })

  it('ignores a stop file left from an earlier copy', async () => {
    const r = service()
    r.w.files.set(STOP, '')
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    await r.w.clock.advance(STOP_CHECK_MS * 2)
    expect(r.w.lines.some((line) => line.includes('Asked to stop'))).toBe(false)
    expect(r.w.files.has(STOP)).toBe(false)
    await r.stop()
  })

  it('tries again a minute after the runner crashes, not only after a failed request', async () => {
    const r = service()
    const files = r.w.env.files as { read: Files['read'] }
    const read = files.read
    let crashes = 1
    files.read = (path) =>
      path.includes('/desks/https') && crashes-- > 0 ? T.die(new Error('disk on fire')) : read(path)
    await settle(() => r.w.lines.some((line) => line.includes('unexpected error')))
    expect(r.w.lines.find((line) => line.includes('unexpected error'))).toContain(
      'The runner stopped on an unexpected error. Trying again in a minute.',
    )
    await r.w.clock.advance(SERVICE_RETRY_MS)
    await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
    await r.stop()
  })

  describe('with a credentials file', () => {
    const FILE = '/run/secrets/homingbird.json'
    const FILE_TOKEN = 'hba_mounted-secret-token-0123456789ab'
    const argv = ['--service', '--server', SERVER, '--credentials-file', FILE]

    it('waits, saying why once, until the file holds a credential, then answers with it alone', async () => {
      const r = runner({ argv })
      await settle(() => r.w.lines.length === 1)
      expect(r.w.lines[0]).toContain(
        `This service starts answering once it can use the credentials file. The credentials file ${FILE} does not exist. Create it on a computer where you can approve the sign-in: homingbird login --server ${SERVER} --credentials-file ${FILE}`,
      )
      await r.w.clock.advance(SIGN_IN_CHECK_MS * 2)
      expect(r.w.lines).toHaveLength(1)
      r.w.files.set(FILE, JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }))
      await r.w.clock.advance(SIGN_IN_CHECK_MS)
      await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
      await r.stop()
      expect(r.w.calls.map((call) => call.authorization).filter((header) => header !== null)).not.toContain(
        `Bearer ${AGENT_TOKEN}`,
      )
      expect(r.w.files.get(FILE)).toBe(JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }))
      expect(r.w.lines.join('\n')).not.toContain(FILE_TOKEN)
    })

    it('warns in its log, without stopping, when others can read the file', async () => {
      const r = runner({
        argv,
        files: { [FILE]: JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }) },
        modes: { [FILE]: 0o644 },
      })
      await settle(() => r.w.lines.some((line) => line.includes('Answering notes')))
      await r.stop()
      expect(r.w.problems).toHaveLength(1)
      expect(r.w.problems[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z Warning: /)
      expect(r.w.problems[0]).toContain(`can read the credentials file ${FILE} (mode 0644)`)
    })

    it('waits for a new file when the server refuses the one it holds', async () => {
      const r = runner({
        argv,
        files: { [FILE]: JSON.stringify({ serverUrl: SERVER, token: FILE_TOKEN }) },
        stubs: { 'me.get': () => ({ _tag: 'Unauthorized', message: 'revoked' }) as never },
      })
      await settle(() => r.w.lines.some((line) => line.includes('refused')))
      expect(r.w.lines.at(-1)).toContain(
        `The server refused the credential in ${FILE}. Sign in again where you can approve it, and replace the file: homingbird login --server ${SERVER} --credentials-file ${FILE}`,
      )
      await r.w.clock.advance(SIGN_IN_CHECK_MS * 3)
      expect(r.w.calls.filter((call) => call.route === 'me.get')).toHaveLength(1)
      await r.stop()
    })
  })
})
