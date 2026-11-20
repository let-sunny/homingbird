import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DESK_CLAIM_RETRY_MS,
  type DeskEnv,
  type Launcher,
  PAUSE_CHECK_MS,
  deskPausePath,
  nodeFiles,
  nodeLauncher,
} from '@homingbird/cli'
import { Task as T } from '@homingbird/kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asShown } from '../../dovecote/test/harness.ts'
import { DESCRIPTIONS } from '../src/hosted-desk.ts'
import { NO_DESK_RUNNER } from '../src/local-tools.ts'
import { type StdioProgram, USAGE, runStdioProgram } from '../src/stdio-program.ts'
import { ADAPTER_VERSION } from '../src/version.ts'
import { type RunningServer, SERVER_URL, startRunningServer } from './running-server.ts'
import { sequentialNonce } from './support.ts'

const AGENT = 'scripted-agent --answer'
const TOKEN = /hb[ah]_[A-Za-z0-9_-]{20,}/

let running: RunningServer
let home: string

beforeEach(async () => {
  running = await startRunningServer()
  home = await mkdtemp(join(tmpdir(), 'homingbird-desk-'))
})

afterEach(() => running.server.close())

interface Ran {
  readonly command: string
  readonly prompt: string
  readonly environment: Readonly<Record<string, string>>
}

const scripted = (runs: Ran[], answer = 'Yes, after six.'): Launcher => ({
  openInBrowser: async () => false,
  runAgent: async (command, prompt, environment) => {
    runs.push({ command, prompt, environment })
    return { exitCode: 0, output: answer }
  },
})

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

const instance = (
  options: {
    readonly launcher?: Launcher
    readonly arguments?: ReadonlyArray<string>
    readonly environment?: Readonly<Record<string, string>>
    readonly name?: string
  } = {},
) => {
  const written: string[] = []
  const logged: string[] = []
  const problems: string[] = []
  const feed = lineFeed()
  const nonce = sequentialNonce()
  let lastId = 0
  const deskEnv: DeskEnv = {
    clock: running.server.clock,
    fetch: running.fetch,
    files: nodeFiles,
    output: { line: (text) => logged.push(text), problem: (text) => problems.push(text) },
    variables: { PATH: process.env.PATH ?? '', ...options.environment },
    homeDirectory: home,
    nonce: () => `${options.name ?? 'first'}${nonce()}`,
    stopped: new AbortController().signal,
    launcher: options.launcher ?? scripted([]),
  }
  const program: StdioProgram = {
    arguments: options.arguments ?? ['--server', SERVER_URL, '--run-agent', AGENT],
    environment: options.environment ?? {},
    credentialPath: running.credentialPath,
    hostName: 'laptop',
    version: ADAPTER_VERSION,
    input: feed.input,
    write: (line) => written.push(line),
    nonce: sequentialNonce(),
    fetch: running.fetch,
    launch: running.launch,
    deskEnv,
    log: (line) => logged.push(line),
  }
  const exit = T.run(runStdioProgram(program), { clock: running.server.clock })
  const messages = (): any[] => written.map((line) => JSON.parse(line))
  const request = async (method: string, params: object = {}): Promise<any> => {
    const id = ++lastId
    feed.say({ jsonrpc: '2.0', id, method, params })
    await running.until(() => messages().some((message) => message.id === id))
    return messages().find((message) => message.id === id)
  }
  const said = async (name: string, args: object = {}): Promise<string> =>
    (await request('tools/call', { name, arguments: args })).result.content[0].text
  const prompt = async (name: string, args: object = {}) => request('prompts/get', { name, arguments: args })
  const signIn = async () => {
    await running.decide(await said('login'))
    await running.until(async () => (await said('status')).startsWith('Signed in'))
  }
  return { exit, written, logged, problems, feed, request, said, prompt, signIn }
}

const sendFromBen = async (body: string) => {
  const ben = await running.server.signIn('ben@example.com', 'Ben')
  const draft = (await ben.api('POST', '/drafts', { to: [running.owner.me.member.id], body })).json
  await ben.api('POST', `/drafts/${draft.id}/send`, await asShown(ben, draft.id))
  return draft
}

const draftsOfAna = async (): Promise<any[]> => (await running.owner.api('GET', '/drafts')).json.drafts

describe('a desk run inside the MCP server', () => {
  it('starts once the person signs in, and drafts each arriving note with the configured command', async () => {
    const runs: Ran[] = []
    const desk = instance({ launcher: scripted(runs) })
    expect(await desk.said('status')).toContain(DESCRIPTIONS.signed_out)
    const waiting = await sendFromBen('Is the migration safe?')
    await desk.signIn()
    await running.until(async () => (await draftsOfAna()).length === 1)
    expect(await draftsOfAna()).toMatchObject([
      { inReplyTo: waiting.id, body: 'Yes, after six.', status: 'draft' },
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0]!.command).toBe(AGENT)
    expect(runs[0]!.prompt).toContain('<colleague-note ')
    expect(await desk.said('status')).toContain(DESCRIPTIONS.answering)

    const arriving = await sendFromBen('And the export?')
    await running.until(async () => (await draftsOfAna()).length === 2)
    expect((await draftsOfAna()).map((draft) => draft.inReplyTo)).toContain(arriving.id)
    desk.feed.end()
    expect((await desk.exit)._tag).toBe('Ok')
  })

  it('reads the command from HOMINGBIRD_RUN_AGENT and keeps it, and every credential, from the agent', async () => {
    const runs: Ran[] = []
    const desk = instance({
      launcher: scripted(runs),
      arguments: ['--server', SERVER_URL],
      environment: { HOMINGBIRD_RUN_AGENT: AGENT },
    })
    await sendFromBen('Is the migration safe?')
    await desk.signIn()
    await running.until(() => runs.length === 1)
    expect(runs[0]!.command).toBe(AGENT)
    expect(Object.keys(runs[0]!.environment)).not.toContain('HOMINGBIRD_RUN_AGENT')
    expect(JSON.stringify(runs[0]!.environment)).not.toMatch(TOKEN)
    desk.feed.end()
    await desk.exit
  })

  it('logs to its own channel only: no note text, no token, nothing on the MCP output', async () => {
    const desk = instance({ launcher: scripted([], 'SKIP: The migration plan says nothing about it.') })
    await sendFromBen('Is the secret migration safe?')
    await desk.signIn()
    await running.until(() => desk.logged.some((line) => line.includes('without a draft')))
    const log = [...desk.logged, ...desk.problems].join('\n')
    expect(log).not.toContain('secret migration')
    expect(log).not.toContain('migration plan says')
    expect(log).not.toContain(AGENT)
    expect(log).not.toMatch(TOKEN)
    for (const line of desk.written) expect(JSON.parse(line).jsonrpc).toBe('2.0')
    desk.feed.end()
    await desk.exit
  })

  it('never lets two MCP clients with the same configuration both draft, and hands over when one quits', async () => {
    const firstRuns: Ran[] = []
    const secondRuns: Ran[] = []
    const first = instance({ launcher: scripted(firstRuns), name: 'first' })
    await first.signIn()
    await running.until(async () => (await first.said('status')).includes(DESCRIPTIONS.answering))
    const second = instance({ launcher: scripted(secondRuns), name: 'second' })
    await running.until(async () => (await second.said('status')).includes(DESCRIPTIONS.waiting))

    await sendFromBen('Is the migration safe?')
    await running.until(async () => (await draftsOfAna()).length === 1)
    await running.server.clock.advance(DESK_CLAIM_RETRY_MS)
    expect([firstRuns.length, secondRuns.length]).toEqual([1, 0])

    first.feed.end()
    await first.exit
    await running.server.clock.advance(DESK_CLAIM_RETRY_MS)
    await running.until(async () => (await second.said('status')).includes(DESCRIPTIONS.answering))
    await sendFromBen('And the export?')
    await running.until(async () => (await draftsOfAna()).length === 2)
    expect([firstRuns.length, secondRuns.length]).toEqual([1, 1])
    second.feed.end()
    await second.exit
  })

  it.skipIf(process.platform === 'win32')(
    'stops with the MCP client: closing its input ends the runner and the agent it was running',
    async () => {
      const pidFile = join(home, 'agent.pid')
      const slow = `sleep 30 & echo $! > ${pidFile}; wait`
      const slowDesk = instance({
        launcher: nodeLauncher(process.platform),
        arguments: ['--server', SERVER_URL, '--run-agent', slow],
        name: 'slow',
      })
      await sendFromBen('Is the migration safe?')
      await slowDesk.signIn()
      let pid = 0
      await running.until(async () => {
        pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim())
        return pid > 0
      })
      expect(isAlive(pid)).toBe(true)
      slowDesk.feed.end()
      expect((await slowDesk.exit)._tag).toBe('Ok')
      await running.until(() => !isAlive(pid))
      expect(await draftsOfAna()).toEqual([])
    },
  )

  it('pauses and resumes with the desk prompt, which takes no command', async () => {
    const runs: Ran[] = []
    const desk = instance({ launcher: scripted(runs) })
    await desk.signIn()
    await running.until(async () => (await desk.said('status')).includes(DESCRIPTIONS.answering))
    const off = (await desk.prompt('desk', { state: 'off' })).result.messages[0].content.text
    expect(off).toContain('paused')
    expect(await desk.said('status')).toContain(DESCRIPTIONS.paused)
    await sendFromBen('Is the migration safe?')
    await running.server.clock.advance(DESK_CLAIM_RETRY_MS)
    expect(runs).toEqual([])
    const on = (await desk.prompt('desk', { state: 'ON' })).result.messages[0].content.text
    expect(on).toContain('on again')
    await running.until(async () => (await draftsOfAna()).length === 1)
    expect(runs).toHaveLength(1)
    for (const state of ['', 'claude -p', 'restart']) {
      const refused = await desk.prompt('desk', { state })
      expect(refused.error.code).toBe(-32602)
    }
    for (const text of [off, on]) expect(text).not.toContain(AGENT)
    desk.feed.end()
    await desk.exit
  })

  it('waits while homingbird desk pause has paused this person’s desks, says so when turned on, and answers once resumed', async () => {
    const runs: Ran[] = []
    const desk = instance({ launcher: scripted(runs) })
    await desk.signIn()
    await running.until(async () => (await desk.said('status')).includes(DESCRIPTIONS.answering))
    const flag = deskPausePath({ variables: {}, homeDirectory: home }, SERVER_URL, running.owner.me.member.id)
    await T.runPromise(nodeFiles.writePrivate(flag, '{}'))
    await sendFromBen('Is the migration safe?')
    await running.until(async () => (await desk.said('status')).includes(DESCRIPTIONS.paused_on_computer))
    await running.server.clock.advance(PAUSE_CHECK_MS * 2)
    expect(runs).toEqual([])
    const on = (await desk.prompt('desk', { state: 'on' })).result.messages[0].content.text
    expect(on).toContain('paused with `homingbird desk pause`')
    expect(on).toContain('homingbird desk resume')
    expect(on).not.toContain('on again')
    await T.runPromise(nodeFiles.remove(flag))
    await running.server.clock.advance(PAUSE_CHECK_MS)
    await running.until(async () => (await draftsOfAna()).length === 1)
    expect(await desk.said('status')).toContain(DESCRIPTIONS.answering)
    desk.feed.end()
    await desk.exit
  })

  it('says how to configure a desk when none is, and starts nothing', async () => {
    const runs: Ran[] = []
    const plain = instance({ launcher: scripted(runs), arguments: ['--server', SERVER_URL] })
    const listed = (await plain.request('prompts/list')).result.prompts
    expect(listed.find((prompt: any) => prompt.name === 'desk').arguments).toEqual([
      { name: 'state', description: 'on or off', required: true },
    ])
    expect((await plain.prompt('desk', { state: 'on' })).result.messages[0].content.text).toBe(NO_DESK_RUNNER)
    await plain.signIn()
    await sendFromBen('Is the migration safe?')
    expect(await plain.said('status')).not.toContain('desk is')
    expect(runs).toEqual([])
    plain.feed.end()
    await plain.exit
  })

  it('drafts from the reader’s extraction in split mode, never from the note itself', async () => {
    const runs: Ran[] = []
    const extraction = JSON.stringify({
      kind: 'question',
      topic: 'Migration safety',
      asks: 'Whether the migration is safe to run',
      needs: [],
      deadline: null,
      language: 'en',
    })
    const launcher: Launcher = {
      openInBrowser: async () => false,
      runAgent: async (command, prompt, environment) => {
        runs.push({ command, prompt, environment })
        return { exitCode: 0, output: command === 'reader' ? extraction : 'Yes, after six.' }
      },
    }
    for (const [args, environment] of [
      [['--server', SERVER_URL, '--run-agent', AGENT, '--split', '--reader', 'reader'], {}],
      [
        ['--server', SERVER_URL, '--run-agent', AGENT],
        { HOMINGBIRD_SPLIT: '1', HOMINGBIRD_READER: 'reader' },
      ],
    ] as const) {
      runs.length = 0
      const desk = instance({ launcher, arguments: args, environment })
      await sendFromBen('Is the migration safe? SPLIT-MARKER-7f3a')
      if (!(await desk.said('status')).startsWith('Signed in')) await desk.signIn()
      await running.until(() => runs.length === 2)
      expect(runs.map((run) => run.command)).toEqual(['reader', AGENT])
      expect(runs[0]!.prompt).toContain('SPLIT-MARKER-7f3a')
      expect(runs[1]!.prompt).not.toContain('SPLIT-MARKER-7f3a')
      await running.until(async () => (await draftsOfAna()).length > 0)
      expect((await draftsOfAna()).at(-1).basis).toBe('Drafted from the extracted question (split mode)')
      await running.owner.api('POST', `/drafts/${(await draftsOfAna()).at(-1).id}/discard`, {})
      desk.feed.end()
      await desk.exit
    }
  })

  it.skipIf(process.platform === 'win32')(
    'runs "claude -p" from one configuration string as the program claude with the option -p',
    async () => {
      const bin = join(home, 'bin')
      await mkdir(bin)
      await writeFile(
        join(bin, 'claude'),
        `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(home, 'argv')}\ncat > /dev/null\necho 'Yes, after six.'\n`,
        { mode: 0o755 },
      )
      const desk = instance({
        launcher: nodeLauncher(process.platform),
        arguments: ['--server', SERVER_URL, '--run-agent', 'claude -p'],
        environment: { PATH: `${bin}:${process.env.PATH}` },
      })
      await sendFromBen('Is the migration safe?')
      await desk.signIn()
      await running.until(async () => (await draftsOfAna()).length === 1)
      expect(await readFile(join(home, 'argv'), 'utf8')).toBe('-p\n')
      desk.feed.end()
      await desk.exit
    },
  )

  it.skipIf(process.platform === 'win32')(
    'says in status and in its log when the agent command is not on the app’s PATH',
    async () => {
      const desk = instance({
        launcher: nodeLauncher(process.platform),
        arguments: ['--server', SERVER_URL, '--run-agent', 'no-such-agent-4e1 -p'],
      })
      await sendFromBen('Is the migration safe?')
      await desk.signIn()
      await running.until(() => desk.problems.length > 0)
      const said =
        'could not be found: "no-such-agent-4e1" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/no-such-agent-4e1, or set PATH'
      expect(desk.problems[0]).toContain(said)
      expect(await desk.said('status')).toContain(said)
      desk.feed.end()
      await desk.exit
    },
  )

  it('sets the desk on or off however often it is asked, and never changes the prompt list', async () => {
    const desk = instance()
    await desk.signIn()
    await running.until(async () => (await desk.said('status')).includes(DESCRIPTIONS.answering))
    const listed = JSON.stringify((await desk.request('prompts/list')).result)
    const started = desk.logged.filter((line) => line.includes('answering arriving notes')).length
    for (const state of ['on', 'on', 'off', 'off', 'on', 'on']) {
      await desk.prompt('desk', { state })
      expect(JSON.stringify((await desk.request('prompts/list')).result)).toBe(listed)
    }
    expect(await desk.said('status')).toContain(DESCRIPTIONS.answering)
    expect(desk.logged.filter((line) => line.includes('answering arriving notes')).length).toBe(started + 1)
    await desk.prompt('desk', { state: 'off' })
    await desk.prompt('desk', { state: 'off' })
    expect(await desk.said('status')).toContain(DESCRIPTIONS.paused)
    desk.feed.end()
    await desk.exit
  })

  it.each([
    [['--server', SERVER_URL, '--run-agent'], '--run-agent needs the agent command.'],
    [['--server', SERVER_URL, '--run-agent', ' '], '--run-agent needs the agent command.'],
    [['--server', SERVER_URL, '--desk', '--run-agent', AGENT], 'Use --run-agent or --desk, not both.'],
    [['--server', SERVER_URL, '--split'], '--split and --reader go with --run-agent.'],
    [
      ['--server', SERVER_URL, '--run-agent', AGENT, '--reader', 'reader'],
      '--reader and --require-toolless-reader go with --split.',
    ],
  ])('refuses %j', async (args, message) => {
    const { exit } = instance({ arguments: args })
    expect(await exit).toMatchObject({
      _tag: 'Err',
      error: { _tag: 'Fail', error: { message: `${message}\n\n${USAGE}` } },
    })
  })

  it('refuses to start a desk where no runner environment was given', async () => {
    const exit = await T.run(
      runStdioProgram({
        arguments: ['--server', SERVER_URL, '--run-agent', AGENT],
        environment: {},
        credentialPath: running.credentialPath,
        hostName: 'laptop',
        version: ADAPTER_VERSION,
        input: (async function* () {})(),
        write: () => {},
        nonce: sequentialNonce(),
      }),
      { clock: running.server.clock },
    )
    expect(exit).toMatchObject({ _tag: 'Err', error: { error: { _tag: 'ProgramFailed' } } })
  })
})

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
