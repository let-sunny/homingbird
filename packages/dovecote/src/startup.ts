import { Task as T } from '@homingbird/kernel'
import { runAuditCommand } from './audit-command.ts'
import { auditRetention, auditRetentionWarnings } from './domain/audit-retention.ts'
import { recordAudit } from './domain/audit.ts'
import type { AppEnv } from './environment.ts'
import { transact } from './events/events.ts'
import { runMembersCommand } from './members-command.ts'
import { runNotesCommand } from './notes-command.ts'
import { prepareDatabase } from './prepare-database.ts'
import type { UnknownDatabase } from './sql/schema.ts'
import { SERVER_VERSION } from './version.ts'

/**
 * Before listening: run an `audit`, `notes` or `members` command and exit, or prepare the database and
 * announce the start.
 */
export const startDovecote = (
  args: ReadonlyArray<string>,
  port: number,
  write: (line: string) => void,
): T.Task<{ readonly exitCode: number } | 'serve', UnknownDatabase, AppEnv> => {
  const [first = '', ...rest] = args
  const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first as keyof typeof COMMANDS] : null
  return command === null
    ? T.as('serve' as const)(T.flatMap(() => announceStart(port))(prepareDatabase))
    : T.map((exitCode: number) => ({ exitCode }))(command(rest, write))
}

/** Announces the start, warns about what the operator should know, and records it. */
export const announceStart = (port: number): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const { config, log } = env
    log.emit({ name: 'system.started', attributes: { version: SERVER_VERSION, port } })
    if (config.identity.devLogin)
      log.emit({
        name: 'system.development_login',
        attributes: {
          anyAddress: config.initial.allowedDomains.length === 0,
          firstMemberBecomesAdministrator: config.adminEmails.length === 0,
        },
      })
    if (config.logs.audit === 'off') log.emit({ name: 'system.audit_off', attributes: {} })
    if (config.logs.operational === 'debug') log.emit({ name: 'system.debug_on', attributes: {} })
    for (const variable of config.ignoredVariables)
      log.emit({ name: 'system.ignored_variable', attributes: { variable } })
    for (const warning of yield* auditRetentionWarnings)
      log.emit(
        warning.kind === 'raised'
          ? {
              name: 'system.audit_retention_raised',
              attributes: { requested: warning.requested, days: warning.days },
            }
          : {
              name: 'system.audit_retention_shorter',
              attributes: { saved: warning.saved, days: warning.days },
            },
      )
    if (config.logs.audit !== 'off')
      yield* transact(
        recordAudit('system.started', {
          detail: {
            version: SERVER_VERSION,
            tier: config.logs.audit,
            retentionDays: yield* auditRetention,
          },
        }),
      )
  })

const COMMANDS = { audit: runAuditCommand, notes: runNotesCommand, members: runMembersCommand } as const
