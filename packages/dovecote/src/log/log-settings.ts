import type { AuditTier } from '@homingbird/protocol'

export interface LogSettings {
  readonly audit: AuditTier | 'off'
  readonly operational: OperationalLevel | 'off'
  readonly requests: boolean
  readonly auditCopy: boolean
}

export type OperationalLevel = 'error' | 'warn' | 'info' | 'debug'

export const DEFAULT_LOG_SETTINGS: LogSettings = {
  audit: 'full',
  operational: 'info',
  requests: false,
  auditCopy: false,
}

/** Reads `HB_LOGS` like `HB_FEATURES`; `HB_AUDIT_STDOUT=1` means `auditCopy=on`. */
export const logSettingsFrom = (
  text: string,
  auditStdout: boolean,
): { readonly settings: LogSettings; readonly problems: ReadonlyArray<string> } => {
  const chosen: Record<string, string> = {}
  const problems: string[] = []
  for (const item of text
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '')) {
    const [name = '', value = '', ...rest] = item.split('=').map((each) => each.trim())
    const allowed = VALUES[name as keyof LogSettings]
    if (allowed === undefined || !allowed.includes(value) || rest.length > 0)
      problems.push(`HB_LOGS: "${item}" is not a log setting; ${HELP}`)
    else if (Object.hasOwn(chosen, name)) problems.push(`HB_LOGS: "${name}" is set twice`)
    else chosen[name] = value
  }
  if (auditStdout && chosen.auditCopy === 'off')
    problems.push('HB_AUDIT_STDOUT=1 and HB_LOGS auditCopy=off disagree; keep only HB_LOGS')
  const settings: LogSettings = {
    audit: (chosen.audit ?? DEFAULT_LOG_SETTINGS.audit) as LogSettings['audit'],
    operational: (chosen.operational ?? DEFAULT_LOG_SETTINGS.operational) as LogSettings['operational'],
    requests: chosen.requests === 'on',
    auditCopy: chosen.auditCopy === undefined ? auditStdout : chosen.auditCopy === 'on',
  }
  for (const kind of ['auditCopy', 'requests'] as const)
    if (settings[kind] && !isWrittenAt(settings.operational, 'info'))
      problems.push(
        `HB_LOGS: ${kind}=on writes information lines, which operational=${settings.operational} would drop; set operational=info or debug, or ${kind}=off`,
      )
  return { settings, problems }
}

export const isWrittenAt = (chosen: LogSettings['operational'], level: OperationalLevel): boolean =>
  chosen !== 'off' && OPERATIONAL_LEVELS.indexOf(level) <= OPERATIONAL_LEVELS.indexOf(chosen)

const VALUES: Readonly<Record<keyof LogSettings, ReadonlyArray<string>>> = {
  audit: ['off', 'security', 'full'],
  operational: ['off', 'error', 'warn', 'info', 'debug'],
  requests: ['off', 'on'],
  auditCopy: ['off', 'on'],
}

const HELP =
  'write audit=full|security|off, operational=info|debug|warn|error|off, requests=on|off, auditCopy=on|off'

const OPERATIONAL_LEVELS: ReadonlyArray<OperationalLevel> = ['error', 'warn', 'info', 'debug']
