import { Task as T } from '@homingbird/kernel'
import { isPresetCommand } from './agent-presets.ts'
import type { CliEnv } from './environment.ts'

/**
 * Where the shell finds a command's program on `path`, as a path that outlives the shell: null when it
 * is not there, and also null when no program can be told, as for `cd x && agent`.
 */
export const resolvedProgram = (
  command: string,
  path: string,
): T.Task<string | null, never, Pick<CliEnv, 'programs' | 'platform' | 'variables' | 'homeDirectory'>> =>
  T.gen(function* () {
    const env = yield* T.ask<Pick<CliEnv, 'programs' | 'platform' | 'variables' | 'homeDirectory'>>()
    const program = programWord(command)
    if (program === null) return null
    const pathExtensions = env.variables.PATHEXT ?? null
    for (const candidate of candidatesFor(program, path, env.platform, pathExtensions, env.homeDirectory)) {
      if (yield* T.promise(() => env.programs.isRunnable(candidate))) return yield* lastingPathOf(candidate)
    }
    return null
  })

/**
 * The first of the commands that is a preset and whose program is missing from `path`. Commands of
 * one's own are not checked here: they may be anything the shell runs.
 */
export const missingPresetCommand = (
  commands: ReadonlyArray<string>,
  path: string | undefined,
): T.Task<string | null, never, Pick<CliEnv, 'programs' | 'platform' | 'variables' | 'homeDirectory'>> =>
  T.gen(function* () {
    const env = yield* T.ask<Pick<CliEnv, 'programs' | 'platform' | 'variables' | 'homeDirectory'>>()
    if (path === undefined) return null
    for (const command of commands) {
      if (!isPresetCommand(command, env.platform)) continue
      if ((yield* resolvedProgram(command, path)) === null) return command
    }
    return null
  })

/**
 * A path the service can keep: a directory a version manager made for one shell, which vanishes with
 * it, becomes the path its link leads to. Every other path stays as given, so that a link meant to
 * last, such as Homebrew's /opt/homebrew/opt or a Nix profile, is not pinned to one version's store.
 */
export const lastingPathOf = (path: string): T.Task<string, never, Pick<CliEnv, 'programs'>> =>
  versionManagerOf(path)?.isTemporary === true ? realPathOf(path) : T.succeed(path)

/** A PATH the service can keep: each per-shell directory replaced by where it leads, nothing else changed. */
export const stablePath = (path: string, platform: string): T.Task<string, never, Pick<CliEnv, 'programs'>> =>
  T.gen(function* () {
    const separator = platform === 'win32' ? ';' : ':'
    const directories: string[] = []
    for (const directory of path.split(separator)) {
      const lasting = directory === '' ? directory : yield* lastingPathOf(directory)
      if (!directories.includes(lasting)) directories.push(lasting)
    }
    return directories.join(separator)
  })

/** The warning for a path, or else for where its links lead, as a version manager's shim does. */
export const unstablePathWarningFor = (
  what: string,
  path: string,
): T.Task<string | null, never, Pick<CliEnv, 'programs'>> =>
  T.gen(function* () {
    return unstablePathWarning(what, path) ?? unstablePathWarning(what, yield* realPathOf(path))
  })

/** Where the shell looks for a program, in order. */
export const candidatesFor = (
  program: string,
  path: string,
  platform: string,
  pathExtensions: string | null,
  home: string | null = null,
): string[] => {
  const isWindows = platform === 'win32'
  const located = isWindows ? program : expandHome(program, home)
  const names =
    isWindows && !/\.[^.\\/]+$/.test(program)
      ? (pathExtensions ?? DEFAULT_PATHEXT)
          .split(';')
          .filter((extension) => extension !== '')
          .map((extension) => `${located}${extension.toLowerCase()}`)
      : [located]
  if (/[\\/]/.test(located)) return isAbsolute(located, isWindows) ? names : []
  return path
    .split(isWindows ? ';' : ':')
    .map((directory) =>
      isWindows ? directory.trim().replace(/^"(.*)"$/, '$1') : expandHome(directory, home),
    )
    .filter((directory) => directory !== '')
    .flatMap((directory) =>
      names.map((name) => `${directory.replace(/[\\/]+$/, '')}${isWindows ? '\\' : '/'}${name}`),
    )
}

/** The program a command starts, when it is a plain word or path the shell looks up as it is. */
export const programWord = (command: string): string | null => {
  const first = command.trim().split(/\s+/)[0] ?? ''
  return /^[A-Za-z0-9._+\-\\/:~]+$/.test(first) && !first.includes('=') ? first : null
}

/**
 * The version manager a path belongs to, when it does: such a path changes when the person switches
 * Node versions, and fnm's per-shell directories vanish when the shell closes.
 */
export const versionManagerOf = (path: string): VersionManager | null =>
  VERSION_MANAGERS.find((manager) => manager.pattern.test(path)) ?? null

/** Says why a path is a poor choice for a service, and what to give instead; null for a stable path. */
export const unstablePathWarning = (what: string, path: string): string | null => {
  const manager = versionManagerOf(path)
  if (manager === null) return null
  const why = manager.isTemporary
    ? `is in a directory ${manager.name} makes for one shell, which disappears when that shell closes`
    : `belongs to ${manager.name}, a Node version manager, and breaks when that version is switched or removed`
  return `${what} ${path} ${why}. ${STABLE_PATH_ADVICE}`
}

export interface VersionManager {
  readonly name: string
  readonly pattern: RegExp
  readonly isTemporary: boolean
}

export const STABLE_PATH_ADVICE =
  'For the service, use a path that outlives a Node upgrade: a Node from your system package manager or nodejs.org, such as /opt/homebrew/bin/node, /usr/local/bin/node or ~/.nix-profile/bin/node, with @homingbird/cli and the agent installed with it, then run service install again; or give --agent the agent’s absolute path outside the version manager.'

const VERSION_MANAGERS: ReadonlyArray<VersionManager> = [
  { name: 'fnm', pattern: /[\\/]fnm_multishells[\\/]/i, isTemporary: true },
  { name: 'fnm', pattern: /[\\/]\.?fnm[\\/]/i, isTemporary: false },
  { name: 'nvm', pattern: /[\\/]\.?nvm[\\/]/i, isTemporary: false },
  { name: 'Volta', pattern: /[\\/]\.?volta[\\/]/i, isTemporary: false },
  { name: 'asdf', pattern: /[\\/]\.asdf[\\/]/i, isTemporary: false },
  { name: 'mise', pattern: /[\\/]mise[\\/](installs|shims)[\\/]/i, isTemporary: false },
]

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** A POSIX shell expands a leading ~ in PATH entries and commands alike. */
const expandHome = (path: string, home: string | null): string =>
  home !== null && (path === '~' || path.startsWith('~/')) ? `${home}${path.slice(1)}` : path

const isAbsolute = (program: string, isWindows: boolean): boolean =>
  isWindows ? /^([A-Za-z]:)?[\\/]/.test(program) : program.startsWith('/')

/** The path with every symbolic link followed, or the path itself when nothing is there. */
const realPathOf = (path: string): T.Task<string, never, Pick<CliEnv, 'programs'>> =>
  T.gen(function* () {
    const env = yield* T.ask<Pick<CliEnv, 'programs'>>()
    return (yield* T.promise(() => env.programs.realPath(path))) ?? path
  })
