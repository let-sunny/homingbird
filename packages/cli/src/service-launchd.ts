import { Result } from '@homingbird/kernel'
import {
  type ServiceManager,
  type ServicePaths,
  type ServiceSpec,
  command,
  escapeXml,
  logPathFor,
  optional,
  requirePrintable,
  retried,
  runnerArguments,
  serviceLockPath,
  serviceSlug,
  serviceStopPath,
} from './service-definition.ts'

/** macOS: a launchd agent in the person's own GUI session, loaded when they log in. */
export const launchdAgent: ServiceManager = {
  kind: 'launchd user agent',
  writesFile: true,
  stopsThroughRunner: false,
  place: (where, server) => ({
    name: labelFor(server),
    definitionPath: `${where.homeDirectory}/Library/LaunchAgents/${labelFor(server)}.plist`,
    logPath: logPathFor(where.configDirectory, server),
    lockPath: serviceLockPath(where.configDirectory, server),
    stopPath: serviceStopPath(where.configDirectory, server),
    userId: where.userId,
    windowsUser: null,
    server,
  }),
  definition: (paths, spec) =>
    Result.map((checked: ServiceSpec) => propertyList(paths, checked))(requirePrintable(spec)),
  install: (paths) => [
    optional('launchctl', 'bootout', target(paths)),
    command('launchctl', 'enable', target(paths)),
    retried(BOOTSTRAP_ATTEMPTS, command('launchctl', 'bootstrap', domain(paths), paths.definitionPath)),
  ],
  stop: (paths) => [optional('launchctl', 'bootout', target(paths))],
  stopNow: (paths) => [optional('launchctl', 'bootout', target(paths))],
  afterRemoval: () => [],
  status: (paths) => optional('launchctl', 'print', target(paths)),
  stateIn: (status) => {
    const lastExit = /^\s*last exit code = (.+)$/m.exec(status.output)?.[1]?.trim() ?? null
    return {
      loaded: status.exitCode === 0,
      running: status.exitCode === 0 && /^\s*state = running\s*$/m.test(status.output),
      lastExit: lastExit === null || lastExit.startsWith('(never') ? null : `code ${lastExit}`,
    }
  },
}

export const labelFor = (server: string): string => `homingbird.runner.${serviceSlug(server)}`

const THROTTLE_SECONDS = 10

/** launchd may still be tearing down the agent just booted out, and refuses to load it again until done. */
const BOOTSTRAP_ATTEMPTS = 5

const domain = (paths: ServicePaths): string => `gui/${paths.userId ?? 0}`

const target = (paths: ServicePaths): string => `${domain(paths)}/${paths.name}`

const propertyList = (paths: ServicePaths, spec: ServiceSpec): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entry('Label', string(paths.name)),
    ...entry('ProgramArguments', [
      '<array>',
      ...[...spec.program, ...runnerArguments(spec)].map((word) => `  ${string(word)}`),
      '</array>',
    ]),
    ...entry('WorkingDirectory', string(spec.workdir)),
    ...(spec.path === null
      ? []
      : entry('EnvironmentVariables', ['<dict>', '  <key>PATH</key>', `  ${string(spec.path)}`, '</dict>'])),
    ...entry('RunAtLoad', '<true/>'),
    ...entry('KeepAlive', '<true/>'),
    ...entry('ThrottleInterval', `<integer>${THROTTLE_SECONDS}</integer>`),
    ...entry('ProcessType', string('Background')),
    ...entry('StandardOutPath', string(paths.logPath)),
    ...entry('StandardErrorPath', string(paths.logPath)),
    '</dict>',
    '</plist>',
    '',
  ].join('\n')

const entry = (key: string, value: string | ReadonlyArray<string>): string[] => [
  `  <key>${key}</key>`,
  ...(typeof value === 'string' ? [value] : value).map((line) => `  ${line}`),
]

const string = (text: string): string => `<string>${escapeXml(text)}</string>`
