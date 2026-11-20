import { Task as T } from '@homingbird/kernel'
import {
  type AgentPreset,
  type LaunchFormat,
  presetCommandOf,
  shellCommand,
  withWords,
} from './agent-presets.ts'
import type { CliEnv, ProcessOptions, ProcessRun } from './environment.ts'
import { type CliFailure, failed } from './failure.ts'

/**
 * The commands a runner launches. A preset command is prepared first: its program is asked whether it
 * can answer, each probe it declares asks it more, and what that prints shapes the command. Any other
 * command is launched as given.
 */
export const preparedLaunches = (settings: LaunchSettings): T.Task<Launches, CliFailure, CliEnv> =>
  T.gen(function* () {
    const ready = new Set<string>()
    const agent = yield* preparedLaunch(settings.agent, 'agent', ready)
    const reader =
      settings.split === null ? null : yield* preparedLaunch(settings.split.reader, 'reader', ready)
    return { agent, reader }
  })

/** The commands as given, for a host that has no processes to ask, such as an MCP-hosted desk. */
export const launchesAsGiven = (settings: LaunchSettings): Launches => ({
  agent: launchAsGiven(settings.agent),
  reader: settings.split === null ? null : launchAsGiven(settings.split.reader),
})

/** Why a preset's program cannot answer yet, such as not being signed in; null when it can. */
export const presetNotReady = (preset: AgentPreset): T.Task<string | null, never, CliEnv> =>
  T.gen(function* () {
    const check = preset.signInCheck
    if (check === null) return null
    const printed = yield* asked(preset, check.args, check.timeoutMs)
    return printed.exitCode === 0 ? null : check.problem
  })

export interface Launches {
  readonly agent: Launch
  readonly reader: Launch | null
}

export interface Launch {
  readonly command: string
  readonly format: LaunchFormat
  /** Variables the command gets on top of the environment the runner passes on. */
  readonly environment: Readonly<Record<string, string>>
}

export interface LaunchSettings {
  readonly agent: string
  readonly split: { readonly reader: string } | null
}

const launchAsGiven = (command: string): Launch => ({ command, format: 'text', environment: {} })

const preparedLaunch = (
  command: string,
  role: 'agent' | 'reader',
  ready: Set<string>,
): T.Task<Launch, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const match = presetCommandOf(command, env.platform)
    if (match === null) return launchAsGiven(command)
    const { preset, launch } = match
    if (!ready.has(preset.name)) {
      const problem = yield* presetNotReady(preset)
      if (problem !== null) return yield* T.fail(failed(problem))
      ready.add(preset.name)
    }
    let words = launch.words
    if (launch.probe !== null) {
      const added = launch.probe.wordsFrom(yield* asked(preset, launch.probe.args))
      if (added._tag === 'Err')
        return yield* T.fail(
          failed(
            `The ${role} command was not started: ${added.error}, so it could not be prepared as the ${preset.name} preset intends. Give --${role} a command of your own to run it anyway.`,
          ),
        )
      words = withWords(words, added.value)
    }
    return {
      command: shellCommand(words, env.platform),
      format: launch.format,
      environment: preset.environment,
    }
  })

/** What a preset's program printed when run directly; a program that could not be started printed nothing. */
const asked = (
  preset: AgentPreset,
  args: ReadonlyArray<string>,
  timeoutMs?: number,
): T.Task<ProcessRun, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const options: ProcessOptions = {
      environment: preset.environment,
      ...(timeoutMs !== undefined && { timeoutMs }),
    }
    const finished = yield* T.result(
      T.tryPromise(
        () => env.processes.run(preset.agent.words[0]!, args, options),
        () => null,
      ),
    )
    return finished._tag === 'Ok' ? finished.value : { exitCode: null, output: '' }
  })
