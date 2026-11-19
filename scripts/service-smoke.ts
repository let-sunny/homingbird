import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type HasClock, Task as T, systemClock, tagged } from '../packages/kernel/src/index.ts'

/**
 * Installs the background service against a local Dovecote with development login, and checks that it
 * runs, answers with the agent command, stops that command's whole process tree, and leaves nothing
 * behind once uninstalled. CI runs it on macOS and Windows: `pnpm build && tsx scripts/service-smoke.ts`.
 */
export const serviceSmoke = (port: number): T.Task<void, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    const server = `http://localhost:${port}`
    const scratch = mkdtempSync(join(tmpdir(), 'homingbird-smoke-'))
    const dovecote = startDovecote(port, scratch)
    const removed = T.sync(() =>
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }),
    )
    yield* T.ensuring(T.flatMap(() => removed)(stopped(dovecote)))(
      T.gen(function* () {
        yield* until('Dovecote answers /healthz', () => isHealthy(server), STARTUP_MS)
        const ana = yield* signedInPerson(server, 'ana@example.com', 'Ana')
        const ben = yield* signedInPerson(server, 'ben@example.com', 'Ben')
        yield* signedInCli(server, ana)
        yield* T.ensuring(cleanedUp(server))(
          T.tapError(() => printedServiceLog(server))(answeredAndStopped(server, scratch, ana, ben)),
        )
      }),
    )
  })

export const SmokeFailed = tagged('SmokeFailed')<{ readonly message: string }>()
export type SmokeFailed = ReturnType<typeof SmokeFailed>

export interface SmokeEnv extends HasClock {
  readonly fetch: typeof globalThis.fetch
  readonly platform: string
}

/** The agent command the service runs: it records its process id, then waits until it is stopped. */
export const SMOKE_AGENT_SOURCE = [
  "import { writeFileSync } from 'node:fs'",
  "process.stdin.on('data', () => {})",
  "process.stdin.on('end', () => writeFileSync(process.argv[2], String(process.pid)))",
  'setInterval(() => {}, 60_000)',
  '',
].join('\n')

export const smokeAgentCommand = (script: string, pidFile: string): string => `node ${script} ${pidFile}`

/** The `name=value` pair of the web client's session cookie in a Set-Cookie header. */
export const sessionCookieIn = (setCookie: string | null): string | null =>
  /(?:^|,\s*)(hb_session=[^;,\s]+)/.exec(setCookie ?? '')?.[1] ?? null

/** How to list every process with its command line on this platform. */
export const processListing = (platform: string): [string, string[]] =>
  platform === 'win32'
    ? [
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }',
        ],
      ]
    : ['ps', ['-axww', '-o', 'pid=,command=']]

/** The lines of a process listing that are a background runner for this server. */
export const leftoverRunners = (listing: string, server: string): string[] =>
  listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const unquoted = line.replaceAll('"', '')
      return / run --service /.test(unquoted) && unquoted.includes(server)
    })

/** Where `homingbird service status --json` says the log is; null when it does not say. */
export const logPathIn = (output: string): string | null => {
  const log = statusFieldsIn(output).log
  return typeof log === 'string' && log !== '' ? log : null
}

/** What `homingbird service status --json` says, read tolerantly. */
export const serviceStateIn = (output: string): { installed: boolean; running: boolean } => {
  const state = statusFieldsIn(output)
  return { installed: state.installed === true, running: state.running === true }
}

const STARTUP_MS = 60_000
const LOGIN_MS = 60_000
const SERVICE_MS = 90_000
const POLL_MS = 500
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'homingbird.js')
const DOVECOTE = join(ROOT, 'packages', 'dovecote', 'dist', 'dovecote.mjs')

interface Person {
  readonly cookie: string
  readonly id: string
}

const answeredAndStopped = (
  server: string,
  scratch: string,
  ana: Person,
  ben: Person,
): T.Task<void, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    const script = join(scratch, 'agent.mjs')
    const pidFile = join(scratch, 'agent.pid')
    yield* T.sync(() => writeFileSync(script, SMOKE_AGENT_SOURCE))
    const agent = smokeAgentCommand(script, pidFile)
    yield* cliSucceeds(['service', 'install', '--server', server, '--agent', agent, '--workdir', scratch])
    yield* until('the service runs', () => T.map(isRunning)(serviceState(server)), SERVICE_MS)
    yield* human(server, ana, 'POST', '/api/v1/draft-requests', { to: [ben.id], instruction: 'Smoke test.' })
    yield* until('the agent command starts', () => T.sync(() => readPid(pidFile) !== null), SERVICE_MS)
    const pid = readPid(pidFile)!
    yield* cliSucceeds(['service', 'stop', '--server', server])
    yield* until('the service stops', () => T.map(isStopped)(serviceState(server)), SERVICE_MS)
    yield* until(
      `the agent command (pid ${pid}) and its process tree end`,
      () => T.sync(() => !isAlive(pid)),
      SERVICE_MS,
    )
    yield* cliSucceeds(['service', 'uninstall', '--server', server])
    const after = yield* serviceState(server)
    if (after.installed) return yield* T.fail(SmokeFailed({ message: 'The service is still installed.' }))
    const leftover = yield* runnersLeft(server)
    if (leftover.length > 0)
      return yield* T.fail(SmokeFailed({ message: `A runner outlived uninstall:\n${leftover.join('\n')}` }))
  })

const cleanedUp = (server: string): T.Task<void, never, SmokeEnv> =>
  T.gen(function* () {
    yield* T.result(cli(['service', 'uninstall', '--server', server]))
    yield* T.result(cli(['logout', '--server', server]))
  })

const isRunning = (state: { running: boolean }): boolean => state.running

const isStopped = (state: { running: boolean }): boolean => !state.running

const serviceState = (server: string): T.Task<{ installed: boolean; running: boolean }, never, SmokeEnv> =>
  T.map((run: CliRun) => serviceStateIn(run.output))(cli(['service', 'status', '--server', server, '--json']))

const runnersLeft = (server: string): T.Task<string[], never, SmokeEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<SmokeEnv>()
    const [program, args] = processListing(env.platform)
    const listed = yield* T.promise(() => ran(program, args))
    return leftoverRunners(listed.output, server)
  })

/** Signs a person in to the web client through development login, and returns their session. */
const signedInPerson = (server: string, email: string, name: string): T.Task<Person, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<SmokeEnv>()
    const login = yield* T.promise((signal) =>
      env.fetch(`${server}/auth/login`, { redirect: 'manual', signal }),
    )
    const form = new URL(login.headers.get('location') ?? '', server)
    const submitted = yield* T.promise((signal) =>
      env.fetch(`${server}/auth/dev`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, name, state: form.searchParams.get('state') ?? '' }).toString(),
        signal,
      }),
    )
    const callback = new URL(submitted.headers.get('location') ?? '', server)
    const finished = yield* T.promise((signal) => env.fetch(callback, { redirect: 'manual', signal }))
    const cookie = sessionCookieIn(finished.headers.get('set-cookie'))
    if (cookie === null)
      return yield* T.fail(SmokeFailed({ message: `Development login for ${email} failed.` }))
    const me = (yield* human(server, { cookie, id: '' }, 'GET', '/api/v1/me')) as { member: { id: string } }
    return { cookie, id: me.member.id }
  })

/** Signs the command line in with the device flow, approving the code as the person would. */
const signedInCli = (server: string, person: Person): T.Task<void, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    const login = yield* T.sync(() =>
      startCli(['login', '--server', server, '--no-browser', '--name', 'Smoke', '--json']),
    )
    const failed = (what: string) => SmokeFailed({ message: `homingbird login ${what}:\n${login.errors()}` })
    yield* T.ensuring(T.sync(() => login.child.kill()))(
      T.gen(function* () {
        const first = yield* T.mapError(() => failed('printed no code in time'))(
          T.timeout(LOGIN_MS)(T.promise(() => login.firstLine)),
        )
        if (first === null) return yield* T.fail(failed('exited before printing a code'))
        const { userCode } = JSON.parse(first) as { userCode: string }
        yield* human(server, person, 'POST', `/api/v1/device/${userCode}`, { approve: true, name: 'Smoke' })
        const exitCode = yield* T.mapError(() => failed('did not finish in time'))(
          T.timeout(LOGIN_MS)(T.promise(() => login.exit)),
        )
        if (exitCode !== 0) return yield* T.fail(failed(`exited with ${exitCode}`))
      }),
    )
  })

/** Prints the service's log, which says why a runner did not do what the smoke test waited for. */
const printedServiceLog = (server: string): T.Task<void, never, SmokeEnv> =>
  T.gen(function* () {
    const status = yield* cli(['service', 'status', '--server', server, '--json'])
    const log = logPathIn(status.output)
    const text = log === null ? null : readTextOrNull(log)
    yield* T.sync(() =>
      process.stderr.write(
        `--- service log ${log ?? '(unknown)'} ---\n${text ?? '(none)'}\n--- end of log ---\n`,
      ),
    )
  })

const human = (
  server: string,
  person: Person,
  method: string,
  path: string,
  body?: unknown,
): T.Task<unknown, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<SmokeEnv>()
    const response = yield* T.promise((signal) =>
      env.fetch(`${server}${path}`, {
        method,
        headers: {
          cookie: person.cookie,
          'x-homingbird-request': '1',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
      }),
    )
    const text = yield* T.promise(() => response.text())
    if (!response.ok)
      return yield* T.fail(SmokeFailed({ message: `${method} ${path} answered ${response.status}: ${text}` }))
    return text === '' ? null : (JSON.parse(text) as unknown)
  })

const isHealthy = (server: string): T.Task<boolean, never, SmokeEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<SmokeEnv>()
    const answered = yield* T.result(
      T.tryPromise(
        (signal) => env.fetch(`${server}/healthz`, { signal }),
        () => 'unreachable' as const,
      ),
    )
    return answered._tag === 'Ok' && answered.value.ok
  })

const until = (
  what: string,
  check: () => T.Task<boolean, never, SmokeEnv>,
  withinMs: number,
): T.Task<void, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    for (let waited = 0; waited < withinMs; waited += POLL_MS) {
      if (yield* check()) return
      yield* T.sleep(POLL_MS)
    }
    return yield* T.fail(SmokeFailed({ message: `Timed out waiting until ${what}.` }))
  })

interface CliRun {
  readonly exitCode: number | null
  readonly output: string
}

const cli = (args: ReadonlyArray<string>): T.Task<CliRun, never, SmokeEnv> =>
  T.promise(() => ran(process.execPath, [CLI, ...args]))

const cliSucceeds = (args: ReadonlyArray<string>): T.Task<CliRun, SmokeFailed, SmokeEnv> =>
  T.gen(function* () {
    const run = yield* cli(args)
    yield* T.sync(() => process.stdout.write(`$ homingbird ${args.join(' ')}\n${run.output}\n`))
    if (run.exitCode !== 0)
      return yield* T.fail(
        SmokeFailed({ message: `homingbird ${args.join(' ')} exited with ${run.exitCode}.` }),
      )
    return run
  })

const ran = (program: string, args: ReadonlyArray<string>): Promise<CliRun> =>
  new Promise((resolve) => {
    execFile(program, [...args], { windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) =>
      resolve({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        output: `${stdout}${stderr}`,
      }),
    )
  })

interface StartedCli {
  readonly child: ChildProcess
  /** The first line it printed, or null when it exited first. */
  readonly firstLine: Promise<string | null>
  readonly exit: Promise<number | null>
  readonly errors: () => string
}

const startCli = (args: ReadonlyArray<string>): StartedCli => {
  const child = spawn(process.execPath, [CLI, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let printed = ''
  let errors = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString('utf8')
  })
  const exit = new Promise<number | null>((resolve) => child.once('close', resolve))
  const firstLine = new Promise<string | null>((resolve) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      printed += chunk.toString('utf8')
      if (printed.includes('\n')) resolve(printed.split('\n')[0]!)
    })
    void exit.then(() => resolve(null))
  })
  return { child, firstLine, exit, errors: () => errors }
}

const startDovecote = (port: number, scratch: string): ChildProcess =>
  spawn(process.execPath, [DOVECOTE], {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      HB_PORT: String(port),
      HB_PUBLIC_URL: `http://localhost:${port}`,
      HB_DEV_LOGIN: '1',
      HB_ALLOWED_DOMAINS: 'example.com',
      HB_DATABASE_URL: `sqlite:${join(scratch, 'dovecote.sqlite')}`,
    },
  })

/** Stops a child and waits until it has exited, so that Windows lets go of the files it held open. */
const stopped = (child: ChildProcess): T.Task<void> =>
  T.promise(
    () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill()
      }),
  )

const statusFieldsIn = (output: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(output.trim().split('\n').at(-1) ?? '')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const readTextOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const readPid = (pidFile: string): number | null => {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? '8191')
  void T.run(serviceSmoke(port), {
    clock: systemClock,
    fetch: globalThis.fetch,
    platform: process.platform,
  }).then((exit) => {
    if (exit._tag === 'Ok') return void process.stdout.write('Service smoke test passed.\n')
    const cause = exit.error
    process.stderr.write(
      `Service smoke test failed: ${cause._tag === 'Fail' ? cause.error.message : cause._tag === 'Die' ? String(cause.defect) : 'interrupted'}\n`,
    )
    process.exitCode = 1
  })
}
