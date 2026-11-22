import { Task as T } from '@homingbird/kernel'
import { NOTE_RETENTION_MINIMUM_DAYS } from './config.ts'
import { personIdForEmail } from './domain/members.ts'
import { exportNotesOf } from './domain/note-export.ts'
import { expiredNoteCounts } from './domain/note-retention.ts'
import { type UnsentErased, countUnsentOf, eraseUnsentNotesOf } from './domain/unsent-erasure.ts'
import type { AppEnv } from './environment.ts'
import { transact } from './events/events.ts'
import { requireCurrentSchema } from './sql/schema.ts'

/**
 * `dovecote notes ...` on the server host: export one person's notes, delete what they never sent, or
 * preview what note retention would delete. Deleting asks for `--yes` and, without it, only says what it
 * would delete. Answers the exit code.
 */
export const runNotesCommand = (
  args: ReadonlyArray<string>,
  write: (line: string) => void,
): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const schema = yield* T.result(requireCurrentSchema)
    if (schema._tag === 'Err') {
      write(schema.error.message)
      return 3
    }
    if (args[0] === 'retention') return yield* previewRetention(args.slice(1), write)
    const [command, email, ...options] = args
    const confirmed = options.length === 1 && options[0] === '--yes'
    const known =
      (command === 'export' && options.length === 0) ||
      (command === 'delete-drafts' && (options.length === 0 || confirmed))
    if (!known || email === undefined) {
      write(USAGE)
      return 2
    }
    const memberId = yield* personIdForEmail(email)
    if (memberId === null) {
      write(`No person has the email ${email}.`)
      return 1
    }
    if (command === 'export') {
      yield* exportNotesOf(memberId, write)
      return 0
    }
    if (!confirmed) {
      write(`Would delete ${countsText(yield* countUnsentOf(memberId))} of ${email}.`)
      write('Nothing was deleted. This cannot be undone: run it again with --yes to delete them.')
      return 0
    }
    const erased = yield* transact(eraseUnsentNotesOf(memberId))
    write(`Deleted ${countsText(erased)} of ${email}. Their sent notes and the audit trail are kept.`)
    return 0
  })

/** `notes retention --dry-run [--days N]`: what the next housekeeping pass would delete, deleting nothing. */
const previewRetention = (
  options: ReadonlyArray<string>,
  write: (line: string) => void,
): T.Task<number, never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const asked = retentionOptionsOf(options)
    if (asked === null) {
      write(USAGE)
      return 2
    }
    const days = asked.days ?? env.config.noteRetentionDays
    if (days === null) {
      write(
        'HB_NOTE_RETENTION_DAYS is not set here, so no note is deleted. Pass --days N to preview a retention.',
      )
      return 2
    }
    if (days < NOTE_RETENTION_MINIMUM_DAYS) {
      write(`A note retention must be at least ${NOTE_RETENTION_MINIMUM_DAYS} days.`)
      return 2
    }
    const counts = yield* expiredNoteCounts(days)
    const day = (at: number) => new Date(at).toISOString().slice(0, 10)
    write(
      `A retention of ${plural(days, 'day')} would delete ${count(counts.sent + counts.discarded)} of ${plural(counts.notes, 'note')}: ` +
        `${count(counts.sent)} sent and ${count(counts.discarded)} discarded before ${day(counts.cutoff)}.`,
    )
    if (counts.oldestSentAt !== null) write(`The oldest of them was sent on ${day(counts.oldestSentAt)}.`)
    write('Nothing was deleted. Started with this retention, Dovecote deletes them at once, then hourly.')
    return 0
  })

const retentionOptionsOf = (options: ReadonlyArray<string>): { readonly days: number | null } | null => {
  const [dryRun, flag, value, ...rest] = options
  if (dryRun !== '--dry-run' || rest.length > 0) return null
  if (flag === undefined) return { days: null }
  return flag === '--days' && value !== undefined && /^[1-9][0-9]{0,5}$/.test(value)
    ? { days: Number(value) }
    : null
}

const count = (value: number): string => new Intl.NumberFormat('en-US').format(value)

const countsText = (counts: UnsentErased): string =>
  `${plural(counts.drafts, 'draft')}, ${plural(counts.discarded, 'discarded note')} and ${plural(counts.draftRequests, 'draft request')}`

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const USAGE =
  'Usage: dovecote notes export <email> | dovecote notes delete-drafts <email> [--yes] | dovecote notes retention --dry-run [--days N]'
