import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ConventionalCommit, parseCommit } from './conventional-commit.ts'
import { nextVersion } from './next-version.ts'
import { renderNotes } from './release-notes.ts'

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

export const withRelease = (changelog: string, version: string, date: string, notes: string): string => {
  const heading = `## [${version}] - ${date}`
  const changes = notes === '' ? '' : `${notes}\n\n`
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

export const versionPullRequest = (
  version: string,
  pre: string | null,
  notes: string,
): { readonly title: string; readonly body: string } => ({
  title: pre === null ? 'Version Packages' : `Version Packages (${pre})`,
  body: [
    `Merging this pull request releases **${version}**: the release workflow checks, publishes @homingbird/cli, @homingbird/mcp and @homingbird/mod to npm, tags v${version}, creates the GitHub release and pushes the image. Every push to main with commits for users updates it.`,
    'The version and these notes come from the Conventional Commit messages since the last release. Edit the section in `CHANGELOG.md` on this branch before merging to change the release notes; the release takes them from there. A later push to main rebuilds this branch.',
    ...(pre === null
      ? []
      : [
          `\`release.json\` sets \`pre\` to \`${pre}\`, so this is a pre-release. Set it to \`null\` on main to release the final version.`,
        ]),
    `## ${version}`,
    notes === '' ? '_No changelog entry._' : notes,
  ].join('\n\n'),
})

/** The `pre` setting of `release.json`: a pre-release identifier such as "rc", or null for final versions. */
export const preReleaseOf = (releaseJson: string): string | null => {
  const { pre } = JSON.parse(releaseJson) as { pre?: unknown }
  if (pre === null || pre === undefined) return null
  if (typeof pre === 'string' && /^[a-z]+$/.test(pre)) return pre
  throw new Error('release.json: "pre" must be null or lower-case letters such as "rc".')
}

export const syncedFiles = (
  version: string,
  read: (file: string) => string,
  packages: ReadonlyArray<string> = [],
): ReadonlyArray<{ readonly file: string; readonly text: string }> =>
  [
    ...packages.map((name) => ({
      file: `packages/${name}/package.json`,
      pattern: JSON_VERSION,
      replacement: (next: string) => `$1"${next}"`,
    })),
    ...VERSION_HOLDERS,
  ].map(({ file, pattern, replacement }) => {
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
const MARKETPLACE_VERSION = /("package":\s*"@homingbird\/mod",\s*"version":\s*)"[^"]*"/
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
    file: '.claude-plugin/marketplace.json',
    pattern: MARKETPLACE_VERSION,
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

const preRelease = (): string | null => preReleaseOf(read('release.json'))
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root }).toString()
const output = (lines: string): void =>
  writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/stdout', `${lines}\n`, { flag: 'a' })

const latestTag = (): string | null => {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD').trim()
  } catch {
    return null
  }
}

const commitsSince = (ref: string | null): ConventionalCommit[] =>
  git('log', '--no-merges', '--format=%B%x00', ...(ref === null ? ['HEAD'] : [`${ref}..HEAD`]))
    .split('\0')
    .map((message) => parseCommit(message.trim()))
    .filter((commit): commit is ConventionalCommit => commit !== null)
    .reverse()

const nextRelease = (since: string | null): { readonly version: string | null; readonly notes: string } => {
  const current = JSON.parse(
    since === null ? read('package.json') : git('show', `${since}:package.json`),
  ).version
  const commits = commitsSince(since)
  return { version: nextVersion(current, commits, preRelease()), notes: renderNotes(commits) }
}

const nextOnGitHub = (): void => output(`next=${nextRelease(latestTag()).version ?? ''}`)

const prepareRelease = (): void => {
  const { version, notes } = nextRelease(latestTag())
  if (version === null) {
    process.stderr.write('No commit since the last release is for users; nothing to release.\n')
    process.exit(1)
  }
  for (const { file, text } of syncedFiles(version, read, workspacePackages()))
    writeFileSync(join(root, file), text)
  const date = new Date().toISOString().slice(0, 10)
  writeFileSync(join(root, 'CHANGELOG.md'), withRelease(read('CHANGELOG.md'), version, date, notes))
  process.stdout.write(`Version ${version}.\n`)
}

const preview = (since: string | undefined): void => {
  const from = since ?? latestTag()
  const { version, notes } = nextRelease(from)
  process.stdout.write(
    `Since ${from ?? 'the first commit'} (pre: ${preRelease() ?? 'null'}): ${version === null ? 'no release' : version}\n\n${notes}\n`,
  )
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
  output(
    Object.entries({ ...plan, dist_tag: plan.distTag })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  )
}

const checkVersions = (): void => {
  const versions = versionsIn(read, workspacePackages())
  const distinct = new Set(versions.values())
  if (distinct.size === 1) return void process.stdout.write(`Every version is ${[...distinct][0]}.\n`)
  for (const [file, version] of versions) process.stderr.write(`${file}: ${version}\n`)
  process.exit(1)
}

const pullRequestOnGitHub = (bodyFile: string): void => {
  const version = JSON.parse(read('packages/cli/package.json')).version as string
  const pre = version.includes('-') ? preRelease() : null
  const { title, body } = versionPullRequest(version, pre, releaseNotes(read('CHANGELOG.md'), version))
  writeFileSync(bodyFile, body)
  output(`title=${title}\nversion=${version}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2)
  if (command === 'next') nextOnGitHub()
  else if (command === 'prepare') prepareRelease()
  else if (command === 'preview') preview(argument)
  else if (command === 'pull-request' && argument !== undefined) pullRequestOnGitHub(argument)
  else if (command === 'plan') planOnGitHub()
  else if (command === 'check') checkVersions()
  else if (command === 'notes' && argument !== undefined)
    process.stdout.write(releaseNotes(read('CHANGELOG.md'), argument))
  else {
    process.stderr.write(
      'Usage: node scripts/release-version.ts next | prepare | preview [<since ref>] | pull-request <body file> | plan | check | notes <version>\n',
    )
    process.exit(2)
  }
}
