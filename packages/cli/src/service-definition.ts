import { Result } from '@homingbird/kernel'
import { serverKey } from './credentials.ts'
import type { ProcessRun } from './environment.ts'

/**
 * How one platform starts `homingbird run` at login and keeps it running: the definition it reads and
 * the commands that load, stop and inspect it. Every function is pure; `service.ts` runs them.
 */
export interface ServiceManager {
  readonly kind: string
  /** Whether the definition is a file; otherwise the install commands carry it, as a registry value. */
  readonly writesFile: boolean
  /** Whether stopping means asking the runner itself, through its stop file, as on Windows. */
  readonly stopsThroughRunner: boolean
  readonly place: (where: ServicePlace, server: string) => ServicePaths
  readonly definition: (paths: ServicePaths, spec: ServiceSpec) => Result.Result<string, string>
  readonly install: (
    paths: ServicePaths,
    definition: string,
    spec: ServiceSpec,
  ) => ReadonlyArray<ServiceCommand>
  /** Unregisters the service and stops it. */
  readonly stop: (paths: ServicePaths) => ReadonlyArray<ServiceCommand>
  /** Stops it until the next login, leaving it registered. */
  readonly stopNow: (paths: ServicePaths) => ReadonlyArray<ServiceCommand>
  readonly afterRemoval: (paths: ServicePaths) => ReadonlyArray<ServiceCommand>
  readonly status: (paths: ServicePaths) => ServiceCommand
  readonly stateIn: (status: ProcessRun) => ServiceState
}

export interface ServiceSpec {
  readonly server: string
  readonly agent: string
  readonly timeoutSeconds: number | null
  readonly split: boolean
  readonly reader: string | null
  readonly requireToollessReader: boolean
  readonly workdir: string
  /** How to start this command line again: the Node executable and the script. */
  readonly program: ReadonlyArray<string>
  /** The PATH the person installed with, so the service finds the agent command as their shell does. */
  readonly path: string | null
}

export interface ServicePlace {
  readonly homeDirectory: string
  readonly configDirectory: string
  readonly systemdDirectory: string
  readonly userId: number | null
  readonly windowsUser: string | null
}

export interface ServicePaths {
  readonly name: string
  readonly definitionPath: string
  readonly logPath: string
  readonly lockPath: string
  readonly stopPath: string
  readonly userId: number | null
  readonly windowsUser: string | null
  readonly server: string
}

export interface ServiceCommand {
  readonly program: string
  readonly args: ReadonlyArray<string>
  /** Whether a failure is expected and harmless, such as stopping a service that is not loaded. */
  readonly mayFail: boolean
  /** How often to try a step that can fail for a moment, such as loading a service just unloaded. */
  readonly attempts: number
}

export interface ServiceState {
  readonly loaded: boolean
  readonly running: boolean
  readonly lastExit: string | null
}

/**
 * The arguments of `homingbird run` that the service starts. Where the platform cannot redirect output
 * or set a working directory, the runner is given both.
 */
export const runnerArguments = (spec: ServiceSpec, own: RunnerOwnSettings = {}): string[] => [
  'run',
  '--service',
  '--server',
  spec.server,
  '--agent',
  spec.agent,
  ...(spec.timeoutSeconds === null ? [] : ['--timeout', String(spec.timeoutSeconds)]),
  ...(spec.split
    ? [
        '--split',
        ...(spec.reader === null ? [] : ['--reader', spec.reader]),
        ...(spec.requireToollessReader ? ['--require-toolless-reader'] : []),
      ]
    : []),
  ...(own.logFile === undefined ? [] : ['--log', own.logFile]),
  ...(own.workdir === undefined ? [] : ['--workdir', own.workdir]),
]

export interface RunnerOwnSettings {
  readonly logFile?: string
  readonly workdir?: string
}

/** The lock the running service holds, beside the desk claims: one runner per server and computer. */
export const serviceLockPath = (configDirectory: string, server: string): string =>
  `${configDirectory}/desks/service-${serviceSlug(server)}.lock`

/** The file that asks the running service to stop. */
export const serviceStopPath = (configDirectory: string, server: string): string =>
  `${configDirectory}/desks/service-${serviceSlug(server)}.stop`

/**
 * One server's address, scheme included, as a name that every service manager accepts. A long address
 * is cut, and a short hash of the whole address keeps two that share a beginning apart.
 */
export const serviceSlug = (server: string): string => {
  const key = serverKey(server)
  const whole = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
  if (whole.length <= SLUG_MAX) return whole.replace(/-+$/, '') || 'server'
  const kept = whole.slice(0, SLUG_MAX - HASH_LENGTH - 1).replace(/-+$/, '')
  return `${kept}-${shortHash(key)}`
}

export const logPathFor = (configDirectory: string, server: string): string =>
  `${configDirectory}/logs/runner-${serviceSlug(server)}.log`

/** Refuses a spec with a line break or another control character, which no service file can hold. */
export const requirePrintable = (spec: ServiceSpec): Result.Result<ServiceSpec, string> => {
  const unprintable = valuesOf(spec).find((value) => /\p{Cc}/u.test(value))
  return unprintable === undefined
    ? Result.ok(spec)
    : Result.err(
        `The service cannot hold a value with a line break or control character: ${JSON.stringify(unprintable)}.`,
      )
}

export const valuesOf = (spec: ServiceSpec): string[] => [
  spec.server,
  spec.agent,
  spec.workdir,
  ...(spec.reader === null ? [] : [spec.reader]),
  ...spec.program,
  ...(spec.path === null ? [] : [spec.path]),
]

export const command = (program: string, ...args: string[]): ServiceCommand => ({
  program,
  args,
  mayFail: false,
  attempts: 1,
})

export const optional = (program: string, ...args: string[]): ServiceCommand => ({
  ...command(program, ...args),
  mayFail: true,
})

export const retried = (attempts: number, step: ServiceCommand): ServiceCommand => ({ ...step, attempts })

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const SLUG_MAX = 60
const HASH_LENGTH = 8

/** FNV-1a over the address's UTF-16 units: stable everywhere, and enough to tell addresses apart. */
const shortHash = (text: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  return hash.toString(16).padStart(HASH_LENGTH, '0')
}
