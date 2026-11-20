import { readFile } from 'node:fs/promises'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asShown } from '../../dovecote/test/harness.ts'
import { ONE_DESK } from '../src/answering.ts'
import { CHANNEL_METHOD } from '../src/channel.ts'
import {
  ANALYTICS_NOTICE,
  REMOVED_ONLY_HERE,
  REVOKED_AND_REMOVED,
  SIGN_IN_FIRST,
} from '../src/local-session.ts'
import { DESK_INSTRUCTIONS, INSTRUCTIONS } from '../src/server.ts'
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
  let lastId = 0
  const exit = T.run(
    runStdioProgram({
      arguments: ['--server', `${SERVER_URL}/`, '--name', 'Cursor'],
      environment: {},
      credentialPath: running.credentialPath,
      version: ADAPTER_VERSION,
      input: feed.input,
      write: (line) => written.push(line),
      nonce: sequentialNonce(),
      fetch: running.fetch,
      launch: running.launch,
      ...overrides,
    }),
    { clock: running.server.clock },
  )
  const messages = (): any[] => written.map((line) => JSON.parse(line))
  const request = async (method: string, params: object = {}): Promise<any> => {
    const id = ++lastId
    feed.say({ jsonrpc: '2.0', id, method, params })
    await running.until(() => messages().some((message) => message.id === id))
    return messages().find((message) => message.id === id)
  }
  const tool = async (name: string, args: object = {}) =>
    (await request('tools/call', { name, arguments: args })).result as {
      content: Array<{ text: string }>
      isError?: true
    }
  const said = async (name: string, args: object = {}) => (await tool(name, args)).content[0]!.text
  const signIn = async () => {
    await running.decide(await said('login'))
    await running.until(async () => (await said('status')).startsWith('Signed in'))
  }
  const pushed = () => messages().filter((message) => message.method === CHANNEL_METHOD)
  return {
    exit,
    written,
    feed,
    request,
    tool,
    said,
    signIn,
    pushed,
    notify: (method: string) => feed.say({ jsonrpc: '2.0', method }),
  }
}

const TOKEN = /hb[ah]_[A-Za-z0-9_-]{20,}/

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

  it('starts signed out, offers login, and refuses every other tool until then', async () => {
    const { exit, request, tool, feed } = program()
    const listed = (await request('tools/list')).result.tools.map((each: { name: string }) => each.name)
    expect(listed.slice(0, 3)).toEqual(['login', 'status', 'logout'])
    expect(await tool('whoami')).toEqual({ content: [{ type: 'text', text: SIGN_IN_FIRST }], isError: true })
    expect(running.recorded.filter((call) => call.path.startsWith('/api/'))).toEqual([])
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('says in its status when the server counts anonymous usage, and that it sends none itself', async () => {
    const counting = (async (url: string, init?: RequestInit) => {
      const answer = await running.fetch(url, init)
      if (!url.endsWith('/api/v1/info')) return answer
      const info = (await answer.json()) as { features?: Record<string, boolean> }
      return new Response(JSON.stringify({ ...info, features: { ...info.features, analytics: true } }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof running.fetch
    const { exit, said, feed } = program({ fetch: counting })
    const started = await said('login')
    await running.decide(started)
    await running.until(async () => (await said('status')).startsWith('Signed in'))
    expect(await said('status')).toBe(
      `Signed in to ${SERVER_URL} as Ana <ana@example.com>, with the credential "Cursor on laptop". ${ONE_DESK} ${ANALYTICS_NOTICE}`,
    )
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('signs in through the browser with the code filled in, and never shows the credential', async () => {
    const { exit, said, feed, written } = program()
    const started = await said('login')
    expect(started).toMatch(/The browser was opened at .*\/#\/device\/[A-Z]{4}-[A-Z]{4} /)
    expect(started).toContain('is already filled in')
    expect(running.launched).toHaveLength(1)
    expect(running.launched[0]!.at(-1)).toMatch(/\/#\/device\/[A-Z]{4}-[A-Z]{4}$/)
    expect(await said('login')).toContain('Waiting for approval in the browser.')
    expect(await said('whoami')).toMatch(/^Not signed in yet: waiting for approval/)
    await running.decide(started)
    await running.until(async () => (await said('status')).startsWith('Signed in'))
    expect(await said('status')).toBe(
      `Signed in to ${SERVER_URL} as Ana <ana@example.com>, with the credential "Cursor on laptop". ${ONE_DESK}`,
    )
    expect(await said('whoami')).toContain('ana@example.com')
    expect(await said('login')).toContain('Already signed in')
    feed.end()
    expect((await exit)._tag).toBe('Ok')
    expect(written.join('')).not.toMatch(TOKEN)
  })

  it('stays offline as an ordinary session: only the desk holds the event stream', async () => {
    const { exit, request, signIn, feed } = program()
    expect((await request('initialize', { protocolVersion: '2025-06-18' })).result.instructions).toContain(
      INSTRUCTIONS,
    )
    await signIn()
    expect(running.recorded.some((call) => call.path === '/api/v1/events/stream')).toBe(false)
    expect(await running.agentOnline()).toBe(false)
    feed.end()
    await exit
  })

  it('keeps a desk session online, checks at the start, and pushes notes and draft requests as they arrive', async () => {
    const ben = await running.server.signIn('ben@example.com', 'Ben')
    const ana = running.owner.me.member.id
    const desk = program({ arguments: ['--server', SERVER_URL, '--desk'] })
    const greeting = (await desk.request('initialize', { protocolVersion: '2025-06-18' })).result
    expect(greeting.instructions).toContain(DESK_INSTRUCTIONS)
    expect(greeting.capabilities.experimental).toEqual({ 'claude/channel': {} })
    const early = (await ben.api('POST', '/drafts', { to: [ana], body: 'Is the migration safe?' })).json
    await ben.api('POST', `/drafts/${early.id}/send`, await asShown(ben, early.id))
    await desk.signIn()
    desk.notify('notifications/initialized')
    await running.until(() => desk.pushed().length === 1)
    expect(desk.pushed()[0].params.meta).toMatchObject({ kind: 'note', note_id: early.id })
    expect(desk.pushed()[0].params.content).toContain('<colleague-note ')
    await running.until(() => running.agentOnline())

    const wish = (
      await running.owner.api('POST', '/draft-requests', {
        inReplyTo: early.id,
        instruction: 'Say yes, after six.',
      })
    ).json
    await running.until(() => desk.pushed().length === 2)
    const pushedRequest = desk.pushed()[1].params
    expect(pushedRequest.meta).toMatchObject({
      kind: 'draft_request',
      request_id: wish.id,
      in_reply_to: early.id,
    })
    expect(pushedRequest.content).toContain('Say yes, after six.')
    expect(pushedRequest.content).toContain('Is the migration safe?')

    expect(await desk.said('draft_note', { requestId: wish.id, body: 'Yes, after six.' })).toContain(
      'It has NOT been sent.',
    )
    const drafts = (await running.owner.api('GET', '/drafts')).json.drafts
    expect(drafts).toMatchObject([{ inReplyTo: early.id, body: 'Yes, after six.', status: 'draft' }])
    expect((await ben.api('GET', `/conversations/${early.conversationId}/notes`)).json.notes).toHaveLength(1)
    expect(await desk.said('check_inbox')).toBe('No new notes or draft requests are waiting.')
    desk.feed.end()
    await desk.exit
    expect(await running.agentOnline()).toBe(false)
  })

  it('refuses every tool in one sentence once signed in to a server whose protocol it cannot read', async () => {
    const newer = async (url: string, init?: RequestInit) => {
      const response = await running.fetch(url, init)
      if (!url.endsWith('/api/v1/info')) return response
      return Response.json({ ...((await response.json()) as object), protocolVersion: 99 })
    }
    const { exit, said, signIn, feed } = program({ fetch: newer })
    await signIn()
    expect(await said('whoami')).toBe(
      'This Homingbird server is newer than this client understands; upgrade the client.',
    )
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('answers initialize at once after a remembered sign-in while the server never answers server.info', async () => {
    const first = program()
    await first.signIn()
    first.feed.end()
    await first.exit
    const silent = (url: string, init?: RequestInit) =>
      url.endsWith('/api/v1/info')
        ? new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
          )
        : running.fetch(url, init)
    const { exit, request, feed } = program({ fetch: silent })
    expect((await request('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo).toBeDefined()
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('tells drafting tools where the human approves', async () => {
    const ben = await running.server.signIn('ben@example.com', 'Ben')
    const { exit, said, signIn, feed } = program()
    await signIn()
    const text = await said('draft_note', { to: 'ben@example.com', body: 'Is the migration safe?' })
    expect(text).toContain(`${SERVER_URL}/#/c/conv_`)
    expect((await ben.api('GET', '/inbox')).json.items).toEqual([])
    expect((await running.owner.api('GET', '/drafts')).json.drafts).toHaveLength(1)
    feed.end()
    await exit
  })

  it('remembers the sign-in for the next start, and signs out for good with logout', async () => {
    const first = program()
    await first.signIn()
    first.feed.end()
    await first.exit
    expect(await readFile(running.credentialPath, 'utf8')).not.toBe('')

    const second = program()
    expect(await second.said('status')).toMatch(/^Signed in to /)
    expect(await second.said('logout')).toBe(REVOKED_AND_REMOVED)
    expect(running.recorded.some((call) => call.path === '/oauth/revoke')).toBe(true)
    expect(await second.said('whoami')).toBe(SIGN_IN_FIRST)
    expect(await second.said('status')).toBe(`Not signed in to ${SERVER_URL}. Call login to sign in.`)
    second.feed.end()
    await second.exit

    const third = program()
    expect(await third.said('status')).toMatch(/^Not signed in/)
    third.feed.end()
    await third.exit
  })

  it('removes the credential at logout when the server cannot be reached, and says to revoke it in the web client', async () => {
    const first = program()
    await first.signIn()
    first.feed.end()
    await first.exit

    const offline: typeof running.fetch = (input, init) =>
      String(input).endsWith('/oauth/revoke')
        ? Promise.reject(new Error('offline'))
        : running.fetch(input, init)
    const second = program({ fetch: offline })
    expect(await second.said('logout')).toBe(REMOVED_ONLY_HERE)
    expect(await second.said('status')).toBe(`Not signed in to ${SERVER_URL}. Call login to sign in.`)
    second.feed.end()
    await second.exit
  })

  it('reads the server address from HOMINGBIRD_SERVER and names the agent after the host', async () => {
    const { exit, said, feed } = program({ arguments: [], environment: { HOMINGBIRD_SERVER: SERVER_URL } })
    await said('login')
    const started = running.recorded.find((call) => call.path === '/oauth/device_authorization')!
    expect(new URLSearchParams(started.body).get('client_name')).toBe('MCP agent')
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('reports a sign-in that was denied, and lets the human try again', async () => {
    const { exit, said, feed } = program()
    await running.decide(await said('login'), { approve: false })
    await running.until(async () => (await said('status')).startsWith('Not signed in'))
    expect(await said('status')).toContain('The request was denied in the browser. Call login to try again.')
    expect(await said('login')).toContain('already filled in')
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })

  it('shows the link when no browser can be opened', async () => {
    const { exit, said, feed } = program({ launch: async () => Promise.reject(new Error('no display')) })
    expect(await said('login')).toMatch(/^To sign in, show your human this link: /)
    feed.end()
    await exit
  })

  it('says it cannot reach a server that is not there, and keeps serving', async () => {
    const written: string[] = []
    const feed = lineFeed()
    const exit = T.run(
      runStdioProgram({
        arguments: ['--server', 'http://127.0.0.1:9'],
        environment: {},
        credentialPath: running.credentialPath,
        version: ADAPTER_VERSION,
        input: feed.input,
        write: (line) => written.push(line),
        nonce: sequentialNonce(),
      }),
      { clock: running.server.clock },
    )
    feed.say({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'login', arguments: {} } })
    await running.until(() => written.length === 1)
    expect(JSON.parse(written[0]!).result.content[0].text).toMatch(
      /^Could not start signing in to http:\/\/127\.0\.0\.1:9/,
    )
    feed.end()
    expect((await exit)._tag).toBe('Ok')
  })
})
