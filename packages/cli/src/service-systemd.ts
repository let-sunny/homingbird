import { Result } from '@homingbird/kernel'
import {
  type ServiceManager,
  type ServicePaths,
  type ServiceSpec,
  command,
  logPathFor,
  optional,
  requirePrintable,
  runnerArguments,
  serviceLockPath,
  serviceSlug,
  serviceStopPath,
} from './service-definition.ts'

/** Linux: a systemd user service, started by the person's own service manager when they log in. */
export const systemdUserService: ServiceManager = {
  kind: 'systemd user service',
  writesFile: true,
  stopsThroughRunner: false,
  place: (where, server) => ({
    name: unitName(server),
    definitionPath: `${where.systemdDirectory}/${unitName(server)}`,
    logPath: logPathFor(where.configDirectory, server),
    lockPath: serviceLockPath(where.configDirectory, server),
    stopPath: serviceStopPath(where.configDirectory, server),
    userId: where.userId,
    windowsUser: null,
    server,
  }),
  definition: (paths, spec) =>
    Result.map((checked: ServiceSpec) => unitFile(paths, checked))(requirePrintable(spec)),
  install: ({ name }) => [
    command('systemctl', '--user', 'daemon-reload'),
    command('systemctl', '--user', 'enable', name),
    command('systemctl', '--user', 'restart', name),
  ],
  stop: ({ name }) => [optional('systemctl', '--user', 'disable', '--now', name)],
  stopNow: ({ name }) => [command('systemctl', '--user', 'stop', name)],
  afterRemoval: ({ name }) => [
    optional('systemctl', '--user', 'daemon-reload'),
    optional('systemctl', '--user', 'reset-failed', name),
  ],
  status: ({ name }) =>
    optional('systemctl', '--user', 'show', name, `--property=${STATUS_PROPERTIES.join(',')}`),
  stateIn: (status) => {
    const shown = new Map(
      status.output
        .split('\n')
        .map((line) => /^([A-Za-z]+)=(.*)$/.exec(line.trim()))
        .filter((match) => match !== null)
        .map((match) => [match[1]!, match[2]!] as const),
    )
    const exitedAt = shown.get('ExecMainExitTimestamp') ?? ''
    return {
      loaded: status.exitCode === 0 && shown.get('LoadState') === 'loaded',
      running: shown.get('ActiveState') === 'active',
      lastExit: exitedAt === '' ? null : `code ${shown.get('ExecMainStatus') ?? 'unknown'} at ${exitedAt}`,
    }
  },
}

export const unitName = (server: string): string => `homingbird-runner-${serviceSlug(server)}.service`

const STATUS_PROPERTIES = ['LoadState', 'ActiveState', 'SubState', 'ExecMainStatus', 'ExecMainExitTimestamp']

const RESTART_SECONDS = 10

const unitFile = (paths: ServicePaths, spec: ServiceSpec): string =>
  [
    '[Unit]',
    `Description=${specifiers(`Homingbird runner for ${spec.server}`)}`,
    'Documentation=https://github.com/let-sunny/homingbird/blob/main/packages/cli/README.md',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${[...spec.program, ...runnerArguments(spec)].map(commandWord).join(' ')}`,
    `WorkingDirectory=${specifiers(spec.workdir)}`,
    ...(spec.path === null ? [] : [`Environment=${quoted(`PATH=${spec.path}`)}`]),
    'Restart=always',
    `RestartSec=${RESTART_SECONDS}`,
    `StandardOutput=append:${specifiers(paths.logPath)}`,
    `StandardError=append:${specifiers(paths.logPath)}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')

/** systemd expands `%` specifiers in every setting, and `$` variables in command lines. */
const specifiers = (text: string): string => text.replace(/%/g, '%%')

const quoted = (text: string): string => `"${specifiers(text.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))}"`

const commandWord = (word: string): string => quoted(word).replace(/\$/g, '$$$$')
