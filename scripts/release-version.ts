import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReleasePlan {
  readonly version: string
  readonly tag: string
  readonly prerelease: boolean
  readonly distTag: 'latest' | 'next'
  readonly release: boolean
}

export const releasePlan = (facts: {
  readonly version: string
  readonly tagExists: boolean
  readonly published: boolean
}): ReleasePlan => {
  const prerelease = facts.version.includes('-')
  return {
    version: facts.version,
    tag: `v${facts.version}`,
    prerelease,
    distTag: prerelease ? 'next' : 'latest',
    release: !(facts.tagExists && facts.published),
  }
}

export const withRelease = (
  changelog: string,
  version: string,
  date: string,
  summaries: ReadonlyArray<string>,
): string => {
  const heading = `## [${version}] - ${date}`
  const changes = summaries.length === 0 ? '' : `### Changes\n\n${summaries.join('\n\n')}\n\n`
  const unreleased = version.includes('-') ? -1 : changelog.indexOf(UNRELEASED)
  const released =
    unreleased >= 0
      ? `${changelog.slice(0, unreleased)}${heading}${insertedBeforeNextRelease(changelog.slice(unreleased + UNRELEASED.length), changes)}`
      : insertedBeforeFirstRelease(changelog, `${heading}\n\n${changes}`)
  return withLink(released.replace(/^\[Unreleased\]:.*\n/m, ''), version)
}

export const releaseNotes = (changelog: string, version: string): string => {
  const start = changelog.indexOf(`## [${version}]`)
  if (start < 0) return ''
  const body = changelog.slice(changelog.indexOf('\n', start) + 1)
  const end = body.search(/^## \[|^\[[^\]]+\]: /m)
  return (end < 0 ? body : body.slice(0, end)).trim()
}

export const pendingSummaries = (changesets: ReadonlyArray<string>): string[] =>
  changesets
    .map((text) => text.replace(/^---\n(?:[\s\S]*?\n)?---\n?/, '').trim())
    .filter((summary) => summary !== '')

export const syncedFiles = (
  version: string,
  read: (file: string) => string,
): ReadonlyArray<{ readonly file: string; readonly text: string }> =>
  VERSION_HOLDERS.map(({ file, pattern, replacement }) => {
    const text = read(file)
    if (!pattern.test(text)) throw new Error(`${file} has no version to set.`)
    return { file, text: text.replace(pattern, replacement(version)) }
  })

export const versionsIn = (
  read: (file: string) => string,
  packages: ReadonlyArray<string>,
): Map<string, string> =>
  new Map(
    [
      ...packages.map((name) => `packages/${name}/package.json`),
      ...VERSION_HOLDERS.map((holder) => holder.file),
    ].map((file) => [file, VERSION_IN.exec(read(file))?.[1] ?? '']),
  )

const UNRELEASED = '## [Unreleased]'
const VERSION_IN = /(?:"version":\s*"|_VERSION = ')([^"']+)/
const JSON_VERSION = /^(\s*"version":\s*)"[^"]*"/m
const CONSTANT_VERSION = /^(export const \w+_VERSION = )'[^']*'/m
const RELEASES = 'https://github.com/let-sunny/homingbird/releases/tag'

const VERSION_HOLDERS: ReadonlyArray<{
  readonly file: string
  readonly pattern: RegExp
  readonly replacement: (version: string) => string
}> = [
  { file: 'package.json', pattern: JSON_VERSION, replacement: (version) => `$1"${version}"` },
  {
    file: 'packages/mod/.claude-plugin/plugin.json',
    pattern: JSON_VERSION,
    replacement: (version) => `$1"${version}"`,
  },
  {
    file: 'packages/mcp/src/version.ts',
    pattern: CONSTANT_VERSION,
    replacement: (version) => `$1'${version}'`,
  },
  {
    file: 'packages/dovecote/src/version.ts',
    pattern: CONSTANT_VERSION,
    replacement: (version) => `$1'${version}'`,
  },
]

const insertedBeforeNextRelease = (rest: string, changes: string): string => {
  const next = rest.search(/^## \[|^\[[^\]]+\]: /m)
  const body = next < 0 ? rest : rest.slice(0, next)
  const after = next < 0 ? '' : rest.slice(next)
  return `${body.trimEnd()}\n\n${changes}${after}`
}

const insertedBeforeFirstRelease = (changelog: string, section: string): string => {
  const first = changelog.search(/^## \[(?!Unreleased\])|^\[[^\]]+\]: /m)
  return first < 0
    ? `${changelog.trimEnd()}\n\n${section}`
    : `${changelog.slice(0, first)}${section}${changelog.slice(first)}`
}

const withLink = (changelog: string, version: string): string => {
  const link = `[${version}]: ${RELEASES}/v${version}`
  if (changelog.includes(`[${version}]: `)) return changelog
  const firstLink = changelog.search(/^\[[^\]]+\]: /m)
  return firstLink < 0
    ? `${changelog.trimEnd()}\n\n${link}\n`
    : `${changelog.slice(0, firstLink)}${link}\n${changelog.slice(firstLink)}`
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (file: string): string => readFileSync(join(root, file), 'utf8')
const workspacePackages = (): string[] =>
  readdirSync(join(root, 'packages')).filter((name) => {
    try {
      return read(`packages/${name}/package.json`) !== ''
    } catch {
      return false
    }
  })

const versionAfterChangesets = (): void => {
  const inPreMode = (() => {
    try {
      return (JSON.parse(read('.changeset/pre.json')) as { mode?: string }).mode === 'pre'
    } catch {
      return false
    }
  })()
  const changesetsIn = (folder: string): string[] => {
    try {
      return readdirSync(join(root, folder))
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .map((name) => read(`${folder}/${name}`))
    } catch {
      return []
    }
  }
  const summaries = pendingSummaries([
    ...(inPreMode ? [] : changesetsIn('.changeset/pre')),
    ...changesetsIn('.changeset'),
  ])
  execFileSync('pnpm', ['exec', 'changeset', 'version'], { cwd: root, stdio: 'inherit' })
  const version = JSON.parse(read('packages/cli/package.json')).version as string
  for (const { file, text } of syncedFiles(version, read)) writeFileSync(join(root, file), text)
  const date = new Date().toISOString().slice(0, 10)
  writeFileSync(join(root, 'CHANGELOG.md'), withRelease(read('CHANGELOG.md'), version, date, summaries))
  process.stdout.write(`Version ${version}.\n`)
}

const planOnGitHub = (): void => {
  const version = JSON.parse(read('packages/cli/package.json')).version as string
  const tagExists =
    execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`], { cwd: root })
      .toString()
      .trim() !== ''
  const published = (() => {
    try {
      return (
        execFileSync('npm', ['view', `@homingbird/cli@${version}`, 'version'])
          .toString()
          .trim() === version
      )
    } catch {
      return false
    }
  })()
  const plan = releasePlan({ version, tagExists, published })
  const lines = Object.entries({ ...plan, dist_tag: plan.distTag }).map(([key, value]) => `${key}=${value}`)
  writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/stdout', `${lines.join('\n')}\n`, { flag: 'a' })
}

const checkVersions = (): void => {
  const versions = versionsIn(read, workspacePackages())
  const distinct = new Set(versions.values())
  if (distinct.size === 1) return void process.stdout.write(`Every version is ${[...distinct][0]}.\n`)
  for (const [file, version] of versions) process.stderr.write(`${file}: ${version}\n`)
  process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'version') versionAfterChangesets()
  else if (command === 'plan') planOnGitHub()
  else if (command === 'check') checkVersions()
  else if (command === 'notes' && argument !== undefined)
    process.stdout.write(releaseNotes(read('CHANGELOG.md'), argument))
  else {
    process.stderr.write('Usage: node scripts/release-version.ts version | plan | check | notes <version>\n')
    process.exit(2)
  }
}
