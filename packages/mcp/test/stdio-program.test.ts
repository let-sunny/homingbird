import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type StdioProgram, USAGE, runStdioProgram } from '../src/stdio-program.ts'
import { ADAPTER_VERSION } from '../src/version.ts'
import { type RunningServer, SERVER_URL, startRunningServer } from './running-server.ts'
import { sequentialNonce } from './support.ts'

let running: RunningServer

beforeEach(async () => {
  running = await startRunningServer()
})

afterEach(() => running.server.close())

const lineFeed = () => {
  const queued: Array<string | null> = []
  let wake: (() => void) | null = null
  const push = (line: string | null): void => {
    queued.push(line)
    wake?.()
  }
  const input = (async function* () {
    for (;;) {
      while (queued.length === 0) await new Promise<void>((resolve) => (wake = resolve))
      const next = queued.shift()!
      if (next === null) return
      yield next
    }
  })()
  return { input, say: (message: object) => push(`${JSON.stringify(message)}\n`), end: () => push(null) }
}

const program = (overrides: Partial<StdioProgram> = {}) => {
  const written: string[] = []
  const feed = lineFeed()
  const exit = T.run(
    runStdioProgram({
      arguments: ['--server', `${SERVER_URL}/`, '--name', 'Cursor'],
      environment: {},
      credentialPath: running.credentialPath,
      hostName: 'laptop',
      version: ADAPTER_VERSION,
      input: feed.input,
      write: (line) => written.push(line),
      announce: (line) => running.announced.push(line),
      nonce: sequentialNonce(),
      fetch: running.fetch,
      ...overrides,
    }),
    { clock: running.server.clock },
  )
  return { exit, written, feed }
}

const agentOnline = async (): Promise<boolean> =>
  (await running.owner.api('GET', '/directory')).json.entries.find((entry: any) => entry.relation === 'self').presence
    .agentOnline

describe('runStdioProgram', () => {
  it.each([[[]], [['--server']], [['--server', 'ftp://hb.example.com']], [['--name', 'x']]])(
    'prints usage and signs nobody in when started with %j',
    async (args) => {
      const { exit } = program({ arguments: args })
      expect(await exit).toMatchObject({
        _tag: 'Err',
        error: { _tag: 'Fail', error: { _tag: 'ProgramFailed', message: USAGE } },
      })
      expect(running.recorded).toEqual([])
    },
  )

  it('signs in, serves MCP over the line feed, and keeps the agent online meanwhile', async () => {
    const { exit, written, feed } = program()
    await running.approveAnnouncedCode()
    await running.until(() => running.announced.includes('Homingbird: connected.'))
    feed.say({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    feed.say({ jsonrpc: '2.0', method: 'notifications/initialized' })
    feed.say({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'whoami', arguments: {} } })
    await running.until(() => written.length === 2)
    expect(JSON.parse(written[0]!).result.serverInfo.version).toBe(ADAPTER_VERSION)
    expect(JSON.parse(written[1]!).result.content[0].text).toContain('ana@example.com')
    await running.until(() => running.recorded.some((call) => call.path === '/api/v1/events/stream'))
    expect(await agentOnline()).toBe(true)
    feed.end()
    expect((await exit)._tag).toBe('Ok')
    expect(await agentOnline()).toBe(false)
    const token = JSON.parse(written[1]!)
    expect(JSON.stringify([token, running.announced])).not.toMatch(/hb[ah]_[A-Za-z0-9_-]{20,}/)
  })

  it('tells drafting tools where the human approves', async () => {
    const ben = await running.server.signIn('ben@example.com', 'Ben')
    const { exit, written, feed } = program()
    await running.approveAnnouncedCode()
    feed.say({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'draft_note', arguments: { to: 'ben@example.com', body: 'Is the migration safe?' } },
    })
    await running.until(() => written.length === 1)
    expect(JSON.parse(written[0]!).result.content[0].text).toContain(SERVER_URL)
    expect((await ben.api('GET', '/inbox')).json.items).toEqual([])
    expect((await running.owner.api('GET', '/drafts')).json.drafts).toHaveLength(1)
    feed.end()
    await exit
  })

  it('reads the server address from HOMINGBIRD_SERVER and names the agent after the host', async () => {
    const { exit, feed } = program({ arguments: [], environment: { HOMINGBIRD_SERVER: SERVER_URL } })
    await running.until(() => running.recorded.some((call) => call.path === '/oauth/device_authorization'))
    const started = running.recorded.find((call) => call.path === '/oauth/device_authorization')!
    expect(new URLSearchParams(started.body).get('client_name')).toBe('MCP agent on laptop')
    await running.approveAnnouncedCode()
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('reports a sign-in that was denied', async () => {
    const { exit } = program()
    await running.approveAnnouncedCode({ approve: false })
    expect(await exit).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Fail', error: { message: 'Could not sign in: The request was denied in the browser.' } },
    })
  })

  it('works without an injected fetch up to the point of reaching the server', async () => {
    const written: string[] = []
    const exit = await T.run(
      runStdioProgram({
        arguments: ['--server', 'http://127.0.0.1:9'],
        environment: {},
        credentialPath: running.credentialPath,
        hostName: 'laptop',
        version: ADAPTER_VERSION,
        input: (async function* () {})(),
        write: (line) => written.push(line),
        announce: () => {},
        nonce: sequentialNonce(),
      }),
      { clock: running.server.clock },
    )
    expect(exit).toMatchObject({ _tag: 'Err', error: { _tag: 'Fail', error: { _tag: 'ProgramFailed' } } })
  })
})
