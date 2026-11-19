import { Task as T } from '@homingbird/kernel'
import { credentialFor, storedServers } from '../credentials.ts'
import { isClaimLive } from '../desk-claim.ts'
import type { CliEnv, ProcessRun } from '../environment.ts'
import { CliFailure, EXIT, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import type { ServiceCommand, ServiceManager, ServicePaths, ServiceSpec } from '../service-definition.ts'
import { serviceManagerFor, servicePlace } from '../service-managers.ts'
import { signInFirst } from './run-as-service.ts'

/**
 * Registers `homingbird run` with this computer's own login mechanism, for the person running this
 * command only, so that it starts when they log in and restarts if it stops.
 */
export const installService = (options: ServiceOptions): T.Task<Outcome, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const { manager, paths } = yield* serviceTarget
    if (env.userId === 0) return yield* T.fail(failed(AS_THE_PERSON))
    const workdir = yield* workdirOf(options.workdir)
    const spec: ServiceSpec = {
      server: paths.server,
      agent: options.agent,
      timeoutSeconds: options.timeoutSeconds,
      split: options.split,
      reader: options.reader,
      requireToollessReader: options.requireToollessReader,
      workdir,
      program: env.program,
      path: env.platform === 'win32' ? null : (env.variables.PATH ?? null),
    }
    const definition = manager.definition(paths, spec)
    if (definition._tag === 'Err') return yield* T.fail(usage(definition.error))
    if (manager.writesFile)
      yield* T.promise(() => env.files.writeOwnerOnly(paths.definitionPath, definition.value))
    if (!(yield* T.promise(() => env.files.exists(paths.logPath))))
      yield* T.promise(() => env.files.writePrivate(paths.logPath, ''))
    if (manager.stopsThroughRunner) yield* stoppedRunner(paths)
    for (const step of manager.install(paths, definition.value, spec)) yield* ran(step, paths)
    const signedIn = (yield* credentialFor(paths.server)) !== null
    return outcome(
      {
        installed: true,
        service: paths.name,
        kind: manager.kind,
        server: paths.server,
        definition: paths.definitionPath,
        log: paths.logPath,
        signedIn,
      },
      [
        `Installed ${paths.name} (${manager.kind}): it starts when you log in and restarts if it stops.`,
        `Definition:  ${paths.definitionPath}`,
        `Log:         ${paths.logPath}`,
        ...(signedIn ? [] : [`${signInFirst(paths.server)}. Until then the service waits.`]),
      ].join('\n'),
    )
  })

export interface ServiceOptions {
  readonly agent: string
  readonly timeoutSeconds: number | null
  readonly split: boolean
  readonly reader: string | null
  readonly requireToollessReader: boolean
  readonly workdir: string | null
}

export const serviceStatus: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const { manager, paths } = yield* serviceTarget
  const { installed, state } = yield* installedState(manager, paths, true)
  const signedIn = (yield* credentialFor(paths.server)) !== null
  const running = manager.stopsThroughRunner ? yield* isClaimLive(paths.lockPath) : (state?.running ?? false)
  const loaded = state?.loaded ?? false
  return outcome(
    {
      service: paths.name,
      kind: manager.kind,
      server: paths.server,
      installed,
      loaded,
      running,
      lastExit: state?.lastExit ?? null,
      definition: paths.definitionPath,
      log: paths.logPath,
      signedIn,
    },
    [
      `Service:     ${paths.name} (${manager.kind})`,
      `Installed:   ${installed ? `yes, ${paths.definitionPath}` : 'no'}`,
      ...(installed
        ? [
            `Running:     ${running ? 'yes' : loaded ? 'no' : 'no, not loaded'}`,
            ...(manager.stopsThroughRunner ? [] : [`Last exit:   ${state?.lastExit ?? 'none'}`]),
          ]
        : []),
      `Log:         ${paths.logPath}`,
      ...(signedIn ? [] : [signInFirst(paths.server)]),
    ].join('\n'),
  )
})

/** Stops the service until the person next logs in, leaving it installed. */
export const stopService: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const { manager, paths } = yield* serviceTarget
  const stopped = manager.stopsThroughRunner ? yield* stoppedRunner(paths) : 'stopped'
  for (const step of manager.stopNow(paths)) yield* ran(step, paths)
  return outcome(
    { stopped: stopped !== 'not running', service: paths.name, server: paths.server },
    stopped === 'not running'
      ? `${paths.name} was not running.`
      : stopped === 'still running'
        ? `Asked ${paths.name} to stop; it has not stopped yet. \`homingbird service status\` shows when it has.`
        : `Stopped ${paths.name}. It starts again when you next log in.`,
  )
})

export const uninstallService: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const { manager, paths } = yield* serviceTarget
  const { installed } = yield* installedState(manager, paths, false)
  for (const step of manager.stop(paths)) yield* ran(step, paths)
  if (manager.stopsThroughRunner) yield* stoppedRunner(paths)
  if (manager.writesFile) yield* T.promise(() => env.files.remove(paths.definitionPath))
  for (const step of manager.afterRemoval(paths)) yield* ran(step, paths)
  return outcome(
    { uninstalled: installed, service: paths.name, server: paths.server, log: paths.logPath },
    installed
      ? `Uninstalled ${paths.name}. Its log stays at ${paths.logPath}.`
      : `No service was installed for ${paths.server}.`,
  )
})

export const AS_THE_PERSON =
  'Install the service as the person whose agent it runs, not as root: it runs with your own account and credential.'

export const STEP_RETRY_MS = 1_000
export const STOP_POLL_MS = 500
export const STOP_WAIT_MS = 15_000

const serviceTarget: T.Task<{ manager: ServiceManager; paths: ServicePaths }, CliFailure, CliEnv> = T.gen(
  function* () {
    const env = yield* T.ask<CliEnv>()
    const manager = serviceManagerFor(env.platform)
    if (manager === null)
      return yield* T.fail(failed(`The service runs on macOS, Linux and Windows, not on ${env.platform}.`))
    const server = env.server ?? (yield* onlyServer)
    return { manager, paths: manager.place(servicePlace(env), server) }
  },
)

/** Whether the service is installed, and, when asked or when only it can tell, what the platform says. */
const installedState = (manager: ServiceManager, paths: ServicePaths, needsState: boolean) =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (manager.writesFile) {
      const installed = yield* T.promise(() => env.files.exists(paths.definitionPath))
      if (!installed || !needsState) return { installed, state: null }
    }
    const state = manager.stateIn(yield* ran(manager.status(paths), paths))
    return { installed: manager.writesFile || state.loaded, state }
  })

/** Asks a running service to stop through its stop file, and waits a while until it has. */
const stoppedRunner = (
  paths: ServicePaths,
): T.Task<'stopped' | 'not running' | 'still running', never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (!(yield* isClaimLive(paths.lockPath))) return 'not running'
    yield* T.promise(() => env.files.writePrivate(paths.stopPath, ''))
    for (let waited = 0; waited < STOP_WAIT_MS; waited += STOP_POLL_MS) {
      yield* T.sleep(STOP_POLL_MS)
      if (!(yield* isClaimLive(paths.lockPath))) {
        yield* T.promise(() => env.files.remove(paths.stopPath))
        return 'stopped'
      }
    }
    return 'still running'
  })

const onlyServer: T.Task<string, CliFailure, CliEnv> = T.gen(function* () {
  const servers = yield* storedServers
  if (servers.length === 1) return servers[0]!
  return yield* T.fail(usage('Say which server with --server <url>.'))
})

const workdirOf = (workdir: string | null): T.Task<string, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    if (workdir === null) return env.homeDirectory
    if (!/^(\/|[A-Za-z]:[\\/])/.test(workdir))
      return yield* T.fail(usage('--workdir needs an absolute path.'))
    if (!(yield* T.promise(() => env.files.exists(workdir))))
      return yield* T.fail(failed(`The working directory ${workdir} does not exist.`))
    return workdir
  })

const ran = (step: ServiceCommand, paths: ServicePaths): T.Task<ProcessRun, CliFailure, CliEnv> =>
  T.gen(function* () {
    let run = yield* attempted(step)
    for (let attempt = 1; attempt < step.attempts && run.exitCode !== 0; attempt++) {
      yield* T.sleep(STEP_RETRY_MS)
      run = yield* attempted(step)
    }
    if (run.exitCode === 0 || step.mayFail) return run
    return yield* T.fail(
      failed(
        `\`${[step.program, ...step.args].join(' ')}\` failed (${run.exitCode === null ? 'could not start' : `exit code ${run.exitCode}`}): ${run.output.trim().split('\n')[0] ?? ''}\nThe service is defined at ${paths.definitionPath}.`,
      ),
    )
  })

const attempted = (step: ServiceCommand): T.Task<ProcessRun, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const finished = yield* T.result(
      T.tryPromise(
        () => env.processes.run(step.program, step.args),
        (cause) => (cause instanceof Error ? cause.message : String(cause)),
      ),
    )
    return finished._tag === 'Ok' ? finished.value : { exitCode: null, output: finished.error }
  })

const usage = (message: string): CliFailure => CliFailure({ message, exitCode: EXIT.usage })
