import { Task as T } from '@homingbird/kernel'
import { agentEnvironment } from './agent-environment.ts'
import { agentSearchPath, withAgentInstallDirectories } from './agent-install-directories.ts'
import { type AgentPreset, shellCommand } from './agent-presets.ts'
import type { CliEnv, ProcessRun } from './environment.ts'
import { resolvedProgram } from './program-paths.ts'
import { cmdCommand } from './windows-shell.ts'

/**
 * What a preset's program printed when asked something before the runner starts. It runs with the
 * environment an agent command would get and finds the program on the same PATH; on Windows a batch
 * file such as npm's `codex.cmd` runs through cmd.exe. It stops when the runner is interrupted or the
 * time is up; a program that could not be started printed nothing.
 */
export const presetAsked = (
  preset: AgentPreset,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): T.Task<ProcessRun, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const variables = withAgentInstallDirectories(env.variables, env.platform)
    const environment = {
      ...agentEnvironment(variables, [env.credentialsFile ?? '']),
      ...preset.environment,
    }
    const name = preset.agent.words[0]!
    const path = agentSearchPath(env.variables, env.platform)
    const found = path === undefined ? null : yield* resolvedProgram(name, path)
    const program = found ?? name
    const [command, words, verbatim] =
      env.platform === 'win32' && /\.(?:cmd|bat)$/i.test(program)
        ? [
            ...cmdCommand(variables.SystemRoot ?? 'C:\\Windows', shellCommand([program, ...args], 'win32')),
            true,
          ]
        : [program, args, false]
    const finished = yield* T.result(
      T.tryPromise(
        (signal: AbortSignal) =>
          env.processes.run(command, words, {
            environment,
            timeoutMs,
            signal,
            ...(verbatim && { windowsVerbatimArguments: true }),
          }),
        () => null,
      ),
    )
    return finished._tag === 'Ok' ? finished.value : { exitCode: null, output: '' }
  })
