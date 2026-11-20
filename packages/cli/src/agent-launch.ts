import { Task as T } from '@homingbird/kernel'
import { presetCommandOf, shellCommand, withWords } from './agent-presets.ts'
import type { CliEnv, ProcessRun } from './environment.ts'
import { type CliFailure, failed } from './failure.ts'

/**
 * The commands a runner launches. A preset command is prepared first: each probe it declares asks its
 * program, and what that prints shapes the command. Any other command is launched as given.
 */
export const preparedLaunches = (settings: LaunchSettings): T.Task<Launches, CliFailure, CliEnv> =>
  T.gen(function* () {
    const agent = yield* preparedLaunch(settings.agent, 'agent')
    const reader = settings.split === null ? null : yield* preparedLaunch(settings.split.reader, 'reader')
    return { agent, reader }
  })

/** The commands as given, for a host that has no processes to ask, such as an MCP-hosted desk. */
export const launchesAsGiven = (settings: LaunchSettings): Launches => ({
  agent: launchAsGiven(settings.agent),
  reader: settings.split === null ? null : launchAsGiven(settings.split.reader),
})

export interface Launches {
  readonly agent: Launch
  readonly reader: Launch | null
}

export interface Launch {
  readonly command: string
}

export interface LaunchSettings {
  readonly agent: string
  readonly split: { readonly reader: string } | null
}

const launchAsGiven = (command: string): Launch => ({ command })

const preparedLaunch = (command: string, role: 'agent' | 'reader'): T.Task<Launch, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const match = presetCommandOf(command, env.platform)
    if (match === null || match.launch.probe === null) return launchAsGiven(command)
    const { words, probe } = match.launch
    const printed = yield* asked(words[0]!, probe.args)
    const added = probe.wordsFrom(printed)
    if (added._tag === 'Err')
      return yield* T.fail(
        failed(
          `The ${role} command was not started: ${added.error}, so it could not be prepared as the ${match.preset.name} preset intends. Give --${role} a command of your own to run it anyway.`,
        ),
      )
    return launchAsGiven(shellCommand(withWords(words, added.value), env.platform))
  })

/** What a program printed when run directly; a program that could not be started printed nothing. */
const asked = (program: string, args: ReadonlyArray<string>): T.Task<ProcessRun, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const finished = yield* T.result(
      T.tryPromise(
        () => env.processes.run(program, args),
        () => null,
      ),
    )
    return finished._tag === 'Ok' ? finished.value : { exitCode: null, output: '' }
  })
