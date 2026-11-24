import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs the web client's end-to-end suites in a real Chromium, the way CI does:
 * `pnpm e2e:web` runs them all, `pnpm e2e:web --shard 2/3` one third, `pnpm e2e:web conversation hints`
 * the named ones. It builds what they need, finds Playwright (or installs the pinned version outside the
 * workspace, once), fixes the time zone, and writes screenshots and logs to a folder of its own, so no
 * tracked file changes.
 */
export const SUITES: ReadonlyArray<Suite> = [
  { name: 'conversation', seconds: 126, needs: 'pwa' },
  { name: 'phone-popups', seconds: 63, needs: 'demo' },
  { name: 'demo-sweep', seconds: 198, needs: 'demo' },
  { name: 'channels', seconds: 19, needs: 'pwa' },
  { name: 'characters', seconds: 20, needs: 'pwa' },
  { name: 'dashboard', seconds: 21, needs: 'pwa' },
  { name: 'feedback', seconds: 77, needs: 'pwa' },
  { name: 'my-agent', seconds: 31, needs: 'pwa' },
  { name: 'thread', seconds: 19, needs: 'pwa' },
  { name: 'debate', seconds: 13, needs: 'pwa' },
  { name: 'new-message', seconds: 6, needs: 'pwa' },
  { name: 'pages', seconds: 69, needs: 'pwa' },
  { name: 'switcher', seconds: 7, needs: 'pwa' },
  { name: 'profile-card', seconds: 6, needs: 'pwa' },
  { name: 'groups', seconds: 7, needs: 'pwa' },
  { name: 'flock-form', seconds: 4, needs: 'pwa' },
  { name: 'hints', seconds: 8, needs: 'pwa' },
]

export interface Suite {
  readonly name: string
  /** About how long it takes on a CI runner, which balances the shards. */
  readonly seconds: number
  /** What it serves: the web client's own build, or the demo's. */
  readonly needs: 'pwa' | 'demo'
}

/** The Playwright the runs were checked with. */
export const PLAYWRIGHT_VERSION = '1.59.0'

/** The environment variables the suites read to choose where their screenshots go. */
export const SCREENSHOT_VARIABLES: ReadonlyArray<string> = [
  'HB_E2E_SCREENSHOTS',
  'HB_E2E_SCREENSHOTS_CHANNELS',
  'HB_E2E_SCREENSHOTS_CHARACTERS',
  'HB_E2E_SCREENSHOTS_DASHBOARD',
  'HB_E2E_SCREENSHOTS_DEBATE',
  'HB_E2E_SCREENSHOTS_DEMO',
  'HB_E2E_SCREENSHOTS_FEEDBACK',
  'HB_E2E_SCREENSHOTS_FLOCK_FORM',
  'HB_E2E_SCREENSHOTS_GROUPS',
  'HB_E2E_SCREENSHOTS_HINTS',
  'HB_E2E_SCREENSHOTS_KO',
  'HB_E2E_SCREENSHOTS_MY_AGENT',
  'HB_E2E_SCREENSHOTS_NEW_MESSAGE',
  'HB_E2E_SCREENSHOTS_PAGES',
  'HB_E2E_SCREENSHOTS_PROFILE',
  'HB_E2E_SCREENSHOTS_SWITCHER',
  'HB_E2E_SCREENSHOTS_THREAD',
  'HB_E2E_WEB_FEEDBACK',
]

/** Which suites shard `index` of `count` (counted from 1) runs: the slowest first, each to the lightest shard. */
export const shardOf = (suites: ReadonlyArray<Suite>, index: number, count: number): Suite[] => {
  const shards: Suite[][] = Array.from({ length: count }, () => [])
  const loads = new Array<number>(count).fill(0)
  for (const suite of [...suites].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))) {
    const lightest = loads.indexOf(Math.min(...loads))
    shards[lightest]!.push(suite)
    loads[lightest]! += suite.seconds
  }
  return shards[index - 1] ?? []
}

/** `2/3` as the second of three shards, or null when it is not one. */
export const parseShard = (text: string): { readonly index: number; readonly count: number } | null => {
  const match = /^(\d+)\/(\d+)$/.exec(text)
  if (match === null) return null
  const [index, count] = [Number(match[1]), Number(match[2])]
  return index >= 1 && index <= count ? { index, count } : null
}

/** The suites a pnpm script such as `pwa`'s `e2e` runs, by name, in order. */
export const suitesRunBy = (script: string): string[] =>
  [...script.matchAll(/tsx e2e\/([\w-]+)\.e2e\.ts/g)].map((match) => match[1]!)

const main = (): void => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const options = parseArguments(process.argv.slice(2))
  if (options === null) fail('usage: pnpm e2e:web [--shard 2/3] [--out folder] [suite ...]')
  const unknown = options.names.filter((name) => !SUITES.some((suite) => suite.name === name))
  if (unknown.length > 0) fail(`no such suite: ${unknown.join(', ')}`)
  const chosen =
    options.names.length > 0
      ? SUITES.filter((suite) => options.names.includes(suite.name))
      : options.shard === null
        ? SUITES
        : shardOf(SUITES, options.shard.index, options.shard.count)
  const out = resolve(options.out ?? join(root, 'reports', 'web-e2e'))
  mkdirSync(join(out, 'logs'), { recursive: true })
  const playwright = playwrightFor()
  for (const needs of ['pwa', 'demo'] as const)
    if (chosen.some((suite) => suite.needs === needs)) build(root, needs)
  const environment = environmentFor(playwright, out)
  const results = chosen.map((suite) => runSuite(root, suite, environment, out))
  const summary = results.map((result) => `${result.ok ? 'ok  ' : 'FAIL'} ${result.name} ${result.seconds}s`)
  const total = results.reduce((sum, result) => sum + result.seconds, 0)
  process.stdout.write(`\n${summary.join('\n')}\ntotal ${total}s\n`)
  writeFileSync(join(out, 'summary.txt'), `${summary.join('\n')}\ntotal ${total}s\n`)
  if (results.some((result) => !result.ok)) process.exit(1)
}

const parseArguments = (
  args: ReadonlyArray<string>,
): { shard: { index: number; count: number } | null; out: string | null; names: string[] } | null => {
  let shard: { index: number; count: number } | null = null
  let out: string | null = null
  const names: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--shard') {
      shard = parseShard(args[++i] ?? '')
      if (shard === null) return null
    } else if (args[i] === '--out') out = args[++i] ?? null
    else names.push(args[i]!)
  }
  return { shard, out, names }
}

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`)
  return process.exit(2)
}

const build = (root: string, needs: 'pwa' | 'demo'): void => {
  process.stdout.write(`building ${needs}\n`)
  const built = spawnSync('pnpm', ['--filter', `@homingbird/${needs}`, 'run', 'build'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

interface Playwright {
  readonly modules: string
  readonly browsers: string | null
}

/**
 * Where the pinned Playwright lives: one the shell already offers through NODE_PATH, else the cache
 * folder `HB_PLAYWRIGHT_DIR` (default `~/.cache/homingbird/playwright-<version>`), where it is installed
 * with Chromium on the first run. Nothing is added to the workspace.
 */
const playwrightFor = (): Playwright => {
  const offered = (process.env.NODE_PATH ?? '')
    .split(':')
    .find((path) => versionIn(join(path, 'playwright')) === PLAYWRIGHT_VERSION)
  if (offered !== undefined) return { modules: offered, browsers: null }
  const folder = resolve(
    process.env.HB_PLAYWRIGHT_DIR ??
      join(homedir(), '.cache', 'homingbird', `playwright-${PLAYWRIGHT_VERSION}`),
  )
  const modules = join(folder, 'node_modules')
  const browsers = join(folder, 'browsers')
  if (versionIn(join(modules, 'playwright')) !== PLAYWRIGHT_VERSION) {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'package.json'), '{"private":true}\n')
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', '--save-exact', `playwright@${PLAYWRIGHT_VERSION}`],
      folder,
    )
  }
  const install = [
    'exec',
    'playwright',
    'install',
    ...(process.env.HB_PLAYWRIGHT_DEPS === '1' ? ['--with-deps'] : []),
    'chromium',
  ]
  run('npm', install, folder, { PLAYWRIGHT_BROWSERS_PATH: browsers })
  return { modules, browsers }
}

const versionIn = (folder: string): string | null => {
  const manifest = join(folder, 'package.json')
  return existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')).version as string) : null
}

const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): void => {
  const done = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
  if (done.status !== 0) process.exit(done.status ?? 1)
}

const environmentFor = (playwright: Playwright, out: string): NodeJS.ProcessEnv => ({
  ...process.env,
  TZ: 'UTC',
  NODE_PATH: [playwright.modules, process.env.NODE_PATH].filter(Boolean).join(':'),
  ...(playwright.browsers !== null && { PLAYWRIGHT_BROWSERS_PATH: playwright.browsers }),
  ...Object.fromEntries(
    SCREENSHOT_VARIABLES.map((name) => [name, join(out, 'screenshots', name.toLowerCase())]),
  ),
})

const runSuite = (
  root: string,
  suite: Suite,
  environment: NodeJS.ProcessEnv,
  out: string,
): { name: string; ok: boolean; seconds: number } => {
  process.stdout.write(`running ${suite.name}\n`)
  const started = process.hrtime.bigint()
  const done = spawnSync('pnpm', ['exec', 'tsx', `packages/pwa/e2e/${suite.name}.e2e.ts`], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: SUITE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  const seconds = Math.round(Number(process.hrtime.bigint() - started) / 1e9)
  const text = `${done.stdout}${done.stderr}${done.error ? `\n${done.error.message}\n` : ''}`
  writeFileSync(join(out, 'logs', `${suite.name}.log`), text)
  const ok = done.status === 0
  if (!ok) process.stdout.write(`${text}\n`)
  return { name: suite.name, ok, seconds }
}

const SUITE_TIMEOUT_MS = 6 * 60 * 1000

/** The files in the e2e folder that are suites: every `*.e2e.ts` but the one that makes README pictures. */
export const suiteFilesIn = (folder: string): string[] =>
  readdirSync(folder)
    .filter((file) => file.endsWith('.e2e.ts') && file !== 'readme-screenshots.e2e.ts')
    .map((file) => file.replace(/\.e2e\.ts$/, ''))

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
