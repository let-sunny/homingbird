import type { ConventionalCommit } from './conventional-commit.ts'

/**
 * The version that releases the commits since the current one, or null when none of them is for the
 * people who use Homingbird. With `pre` set, the release is a pre-release of the next version; a
 * pre-release line keeps its version and counts up, and clearing `pre` releases that version.
 */
export const nextVersion = (
  current: string,
  commits: ReadonlyArray<ConventionalCommit>,
  pre: string | null,
): string | null => {
  const version = parseVersion(current)
  const bump = bumpFor(commits, version.major)
  const core = `${version.major}.${version.minor}.${version.patch}`
  if (version.pre !== null) {
    if (pre === null) return core
    if (version.pre.id === pre) return bump === null ? null : `${core}-${pre}.${version.pre.number + 1}`
    return `${core}-${pre}.1`
  }
  if (bump === null) return null
  const next = bumped(version, bump)
  return pre === null ? next : `${next}-${pre}.1`
}

export type Bump = 'major' | 'minor' | 'patch'

/** Before 1.0 a breaking change bumps the minor version and anything else for users the patch. */
export const bumpFor = (commits: ReadonlyArray<ConventionalCommit>, major: number): Bump | null => {
  if (commits.some((commit) => commit.breaking)) return major === 0 ? 'minor' : 'major'
  if (commits.some((commit) => commit.type === 'feat')) return major === 0 ? 'patch' : 'minor'
  if (commits.some((commit) => RELEASED_TYPES.includes(commit.type))) return 'patch'
  return null
}

export const RELEASED_TYPES: ReadonlyArray<string> = ['feat', 'fix', 'perf']

export interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly pre: { readonly id: string; readonly number: number } | null
}

export const parseVersion = (text: string): Version => {
  const parts = VERSION.exec(text.replace(/^v/, ''))
  if (parts === null) throw new Error(`${text} is not a version such as 1.2.3 or 1.2.3-rc.1.`)
  const [, major, minor, patch, id, number] = parts
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: id === undefined ? null : { id, number: Number(number) },
  }
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/

const bumped = (version: Version, bump: Bump): string =>
  bump === 'major'
    ? `${version.major + 1}.0.0`
    : bump === 'minor'
      ? `${version.major}.${version.minor + 1}.0`
      : `${version.major}.${version.minor}.${version.patch + 1}`
