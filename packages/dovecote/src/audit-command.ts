import { Task as T } from '@homingbird/kernel'
import { type AuditVerdict, auditPage, exportedRow, purgeLegacyAudit, verifyAudit } from './domain/audit.ts'
import type { AppEnv } from './environment.ts'
import { transact } from './events/events.ts'
import { requireCurrentSchema } from './sql/schema.ts'

/** `dovecote audit ...` on the server host; it never migrates, and answers the exit code. */
export const runAuditCommand = (
  args: ReadonlyArray<string>,
  write: (line: string) => void,
): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const schema = yield* T.result(requireCurrentSchema)
    if (schema._tag === 'Err') {
      write(schema.error.message)
      return 3
    }
    const [command, ...options] = args
    if (command === 'verify') {
      const verdict = yield* verifyAudit
      write(verdictText(verdict))
      return verdict.ok ? 0 : 1
    }
    if (command === 'purge-legacy' && options.length === 0) {
      const removed = yield* transact(purgeLegacyAudit(Number.MAX_SAFE_INTEGER, 'command'))
      write(`Removed ${removed} rows of the first audit table, audit_log.`)
      return 0
    }
    const range = command === 'export' ? rangeOf(options) : null
    if (range === null) {
      write(USAGE)
      return 2
    }
    yield* exportFrom(0, range, write)
    return 0
  })

const verdictText = (verdict: AuditVerdict): string =>
  verdict.ok
    ? `The audit chain holds: ${verdict.rows} rows, head ${verdict.head}.`
    : `The audit chain is broken at row ${verdict.id}: ${verdict.problem}.`

const USAGE =
  'Usage: dovecote audit verify | dovecote audit export [--since YYYY-MM-DD] [--until YYYY-MM-DD] | dovecote audit purge-legacy'

const EXPORT_PAGE = 500

const exportFrom = (
  after: number,
  range: { readonly since?: number; readonly until?: number },
  write: (line: string) => void,
): T.Task<void, never, AppEnv> =>
  T.gen(function* () {
    const page = yield* auditPage({ after, limit: EXPORT_PAGE, ...range })
    for (const row of page) write(JSON.stringify(exportedRow(row)))
    if (page.length === EXPORT_PAGE) yield* exportFrom(Number(page.at(-1)!.id), range, write)
  })

const rangeOf = (options: ReadonlyArray<string>): { since?: number; until?: number } | null => {
  const pairs = options.flatMap((option, index) =>
    index % 2 === 0 ? [[option, options[index + 1]] as const] : [],
  )
  const parsed = pairs.map(([name, value]) => [name, Date.parse(value ?? '')] as const)
  if (parsed.some(([name, at]) => (name !== '--since' && name !== '--until') || Number.isNaN(at))) return null
  return Object.fromEntries(parsed.map(([name, at]) => [name === '--since' ? 'since' : 'until', at]))
}
