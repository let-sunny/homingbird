import { Task as T } from '@homingbird/kernel'
import type { AgentPreset } from './agent-presets.ts'
import { presetAsked } from './agent-probe.ts'
import type { CliEnv } from './environment.ts'

/**
 * Which version of a preset's program is installed, asked with `--version`, and whether the preset
 * supports it. A version that cannot be read lets the runner start; only a known older one stops it.
 */
export const presetVersion = (preset: AgentPreset): T.Task<VersionCheck, never, CliEnv> =>
  T.gen(function* () {
    const asked = yield* presetAsked(preset, ['--version'], VERSION_TIMEOUT_MS)
    if (asked.exitCode === null) return { status: 'missing', version: null }
    const version = asked.exitCode === 0 ? versionIn(asked.output) : null
    if (version === null) return { status: 'unknown', version: null }
    const minimum = preset.minimumVersion
    return minimum !== null && isOlder(version, minimum)
      ? { status: 'too_old', version }
      : { status: 'supported', version }
  })

export type VersionCheck =
  | { readonly status: 'supported' | 'too_old'; readonly version: string }
  | { readonly status: 'unknown' | 'missing'; readonly version: null }

/** Why the runner does not start with this version, with the command that upgrades it; null when it can. */
export const tooOldProblem = (preset: AgentPreset, check: VersionCheck): string | null =>
  check.status === 'too_old'
    ? `${preset.program} ${check.version} is older than ${preset.minimumVersion}, the oldest the ${preset.name} preset works with. Upgrade it: ${preset.upgrade}`
    : null

/** One line on what is installed, against what the preset needs and was verified with. */
export const versionLine = (preset: AgentPreset, check: VersionCheck): string => {
  const needs = preset.minimumVersion === null ? '' : `, needs ${preset.minimumVersion} or later`
  switch (check.status) {
    case 'missing':
      return `not found on this PATH${needs}`
    case 'unknown':
      return `installed, version not readable${needs}`
    case 'too_old':
      return `${check.version}, too old${needs}: ${preset.upgrade}`
    case 'supported':
      return `${check.version}${needs}`
  }
}

/** The first version number a program printed, such as `2.1.329` in `2.1.329 (Claude Code)`. */
export const versionIn = (printed: string): string | null =>
  printed.match(/\b(\d+)\.(\d+)\.(\d+)\b/)?.[0] ?? null

const isOlder = (version: string, minimum: string): boolean => {
  const [a, b] = [version, minimum].map((each) => each.split('.').map(Number))
  for (let index = 0; index < 3; index++) if (a![index] !== b![index]) return a![index]! < b![index]!
  return false
}

const VERSION_TIMEOUT_MS = 5_000
