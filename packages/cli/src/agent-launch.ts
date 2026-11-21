import { Task as T } from '@homingbird/kernel'
import {
  type AgentPreset,
  type AttachedServer,
  type LaunchFormat,
  presetCommandOf,
  presetState,
  shellCommand,
  withWords,
} from './agent-presets.ts'
import { presetAsked } from './agent-probe.ts'
import { presetVersion, tooOldProblem, versionLine } from './agent-version.ts'
import type { CliEnv } from './environment.ts'
import { type CliFailure, failed } from './failure.ts'

/**
 * The commands a runner launches. A preset command is prepared first: its program is asked whether it
 * can answer, each probe it declares asks it more, and what that prints shapes the command. Any other
 * command is launched as given.
 */
export const preparedLaunches = (
  settings: LaunchSettings,
  attached: AttachedServer | null = null,
): T.Task<Launches, CliFailure, CliEnv> =>
  T.gen(function* () {
    if (attached !== null && settings.split !== null) return yield* T.fail(failed(ATTACH_WITH_SPLIT))
    const ready = new Map<string, string>()
    const agent = yield* preparedLaunch(settings.agent, 'agent', ready, attached)
    const reader =
      settings.split === null ? null : yield* preparedLaunch(settings.split.reader, 'reader', ready, null)
    return { agent, reader, installed: [...ready.values()] }
  })

/**
 * The commands as given, for a host that has no processes to ask, such as an MCP-hosted desk: a preset
 * command still talks in its format and gets its variables, without being probed.
 */
export const launchesAsGiven = (settings: LaunchSettings, platform: string): Launches => ({
  agent: unprobed(settings.agent, platform),
  reader: settings.split === null ? null : unprobed(settings.split.reader, platform),
  installed: [],
})

/**
 * Whether the agent command gets the Homingbird MCP server for its run: as asked with `--attach-mcp`,
 * or else only for a preset whose attaching was run with the real agent.
 */
export const isAttachingMcp = (
  settings: LaunchSettings & { readonly attachMcp?: boolean },
  platform: string,
) => settings.attachMcp ?? presetCommandOf(settings.agent, platform)?.preset.mcpAttach?.verified ?? false

/** In split mode the agent must never reach a note's own words, which the MCP server's tools return. */
export const ATTACH_WITH_SPLIT =
  '--attach-mcp and --split do not go together: the MCP server would let the drafting agent read the note itself.'

export const ATTACH_NEEDS_PRESET =
  '--attach-mcp needs an agent preset that can take an MCP server for one run: --agent claude or --agent codex.'

/** Why a preset's program cannot answer yet, such as not being signed in; null when it can. */
export const presetNotReady = (preset: AgentPreset): T.Task<string | null, never, CliEnv> =>
  T.gen(function* () {
    const check = preset.signInCheck
    if (check === null) return null
    const printed = yield* presetAsked(preset, check.args, check.timeoutMs)
    return printed.exitCode === 0 ? null : check.problem
  })

export interface Launches {
  readonly agent: Launch
  readonly reader: Launch | null
  /** For each preset program, which version is installed, against what the preset needs. */
  readonly installed: ReadonlyArray<string>
}

export interface Launch {
  readonly command: string
  readonly format: LaunchFormat
  /** Variables the command gets on top of the environment the runner passes on. */
  readonly environment: Readonly<Record<string, string>>
  /** Run instead, from then on, once the command refuses `--strict-mcp-config` under a managed MCP configuration. */
  readonly withoutStrictMcp: Launch | null
}

export interface LaunchSettings {
  readonly agent: string
  readonly split: { readonly reader: string } | null
}

const installedLine = (preset: AgentPreset, version: string): string => {
  const line = `${preset.program}: ${version}; ${presetState(preset)}`
  return preset.accountRisk === null ? line : `${line}. Account: ${preset.accountRisk}`
}

const unprobed = (command: string, platform: string): Launch => {
  const match = presetCommandOf(command, platform)
  if (match === null) return launchAsGiven(command)
  return { ...launchAsGiven(command), format: match.launch.format, environment: match.preset.environment }
}

const launchAsGiven = (command: string): Launch => ({
  command,
  format: 'text',
  environment: {},
  withoutStrictMcp: null,
})

const preparedLaunch = (
  command: string,
  role: 'agent' | 'reader',
  ready: Map<string, string>,
  attached: AttachedServer | null,
): T.Task<Launch, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const match = presetCommandOf(command, env.platform)
    const attach = match?.preset.mcpAttach ?? null
    if (attached !== null && (match === null || attach === null))
      return yield* T.fail(failed(ATTACH_NEEDS_PRESET))
    if (match === null) return launchAsGiven(command)
    const { preset, launch } = match
    if (!ready.has(preset.name)) {
      const version = yield* presetVersion(preset)
      const problem = tooOldProblem(preset, version) ?? (yield* presetNotReady(preset))
      if (problem !== null) return yield* T.fail(failed(problem))
      ready.set(preset.name, installedLine(preset, versionLine(preset, version)))
    }
    let words = launch.words
    if (launch.probe !== null) {
      const added = launch.probe.wordsFrom(
        yield* presetAsked(preset, launch.probe.args, launch.probe.timeoutMs),
      )
      if (added._tag === 'Err')
        return yield* T.fail(
          failed(
            `The ${role} command was not started: ${added.error}, so it could not be prepared as the ${preset.name} preset intends. Give --${role} a command of your own to run it anyway.`,
          ),
        )
      words = withWords(words, added.value)
    }
    const launchOf = (words: ReadonlyArray<string>, fallback: Launch | null): Launch => ({
      command: shellCommand(words, env.platform),
      format: launch.format,
      environment: preset.environment,
      withoutStrictMcp: fallback,
    })
    if (attached !== null && attach !== null) {
      const withServer = withWords(words, attach.words(attached))
      return launchOf(withServer, withServer.includes('--strict-mcp-config') ? launchOf(words, null) : null)
    }
    const fallback = launch.withoutStrictMcp === null ? null : launchOf(launch.withoutStrictMcp, null)
    return launchOf(words, fallback)
  })
