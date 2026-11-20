import { Result } from '@homingbird/kernel'
import {
  type ServiceManager,
  type ServiceSpec,
  command,
  logPathFor,
  optional,
  requirePrintable,
  runnerArguments,
  serviceLockPath,
  serviceSlug,
  serviceStopPath,
  valuesOf,
} from './service-definition.ts'

/**
 * Windows: a value under the person's own Run key, which Windows starts at their logon. The runner
 * supervises itself: it starts again detached and hidden, holds one lock per server, retries what
 * fails, writes its own log and stops when asked through its stop file.
 */
export const runKeyService: ServiceManager = {
  kind: 'Run key entry',
  writesFile: false,
  stopsThroughRunner: true,
  place: (where, server) => ({
    name: valueName(server),
    definitionPath: `${RUN_KEY}\\${valueName(server)}`,
    logPath: windowsPath(logPathFor(where.configDirectory, server)),
    lockPath: serviceLockPath(where.configDirectory, server),
    stopPath: serviceStopPath(where.configDirectory, server),
    userId: null,
    windowsUser: where.windowsUser,
    server,
  }),
  definition: (paths, spec) =>
    Result.flatMap((checked: ServiceSpec) => {
      if (paths.windowsUser === null)
        return Result.err('Cannot tell the Windows user: USERNAME is not set in this shell.')
      if (isServiceAccount(paths.windowsUser)) return Result.err(AS_THE_PERSON_ON_WINDOWS)
      const unsafe = [...valuesOf(checked), paths.logPath].find((value) => /["%]/.test(value))
      if (unsafe !== undefined)
        return Result.err(
          `A Windows service cannot hold a value with " or %: ${unsafe}. Give the agent command without them.`,
        )
      const line = commandLine(runnerCommand(paths.logPath, checked))
      if (line.length > COMMAND_LINE_MAX)
        return Result.err(
          `The service's command line would be ${line.length} characters, more than the ${COMMAND_LINE_MAX} Windows starts. Give shorter paths or a shorter agent command.`,
        )
      return Result.ok(line)
    })(requirePrintable(spec)),
  install: (paths, definition, spec) => {
    const [program, ...args] = runnerCommand(paths.logPath, spec)
    return [
      command('reg', 'add', RUN_KEY, '/v', paths.name, '/t', 'REG_SZ', '/d', definition, '/f'),
      command(program!, ...args),
    ]
  },
  stop: (paths) => [optional('reg', 'delete', RUN_KEY, '/v', paths.name, '/f')],
  stopNow: () => [],
  afterRemoval: () => [],
  status: (paths) => optional('reg', 'query', RUN_KEY, '/v', paths.name),
  stateIn: (status) => ({ loaded: status.exitCode === 0, running: false, lastExit: null }),
}

export const AS_THE_PERSON_ON_WINDOWS =
  'Run service install as the person whose agent it runs, not as SYSTEM or a machine account: in Intune, set "Run this script using the logged on credentials" to Yes.'

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

export const valueName = (server: string): string => `Homingbird Runner ${serviceSlug(server)}`

export const windowsPath = (path: string): string => path.replace(/\//g, '\\')

/** How Windows programs built with the Microsoft C runtime split a command line, for values without `"`. */
export const windowsArgument = (word: string): string => `"${word.replace(/(\\+)$/, '$1$1')}"`

const runnerCommand = (logPath: string, spec: ServiceSpec): string[] => [
  ...spec.program,
  ...runnerArguments(spec, {
    logFile: logPath,
    workdir: windowsPath(spec.workdir),
    credentialsFile: spec.credentialsFile,
  }),
]

/** The longest command line Windows' CreateProcess accepts, which also starts a Run key value. */
export const COMMAND_LINE_MAX = 32_767

const commandLine = (words: ReadonlyArray<string>): string => words.map(windowsArgument).join(' ')

const isServiceAccount = (user: string): boolean => {
  const name = user.split('\\').at(-1)!
  return /^system$/i.test(name) || name.endsWith('$')
}
