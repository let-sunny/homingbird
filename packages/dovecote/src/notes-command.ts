import { Task as T } from '@homingbird/kernel'
import { personIdForEmail } from './domain/members.ts'
import { exportNotesOf } from './domain/note-export.ts'
import { type UnsentErased, countUnsentOf, eraseUnsentNotesOf } from './domain/unsent-erasure.ts'
import type { AppEnv } from './environment.ts'
import { transact } from './events/events.ts'
import { requireCurrentSchema } from './sql/schema.ts'

/**
 * `dovecote notes ...` on the server host: export one person's notes, or delete what they never sent.
 * Deleting asks for `--yes` and, without it, only says what it would delete. Answers the exit code.
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

const countsText = (counts: UnsentErased): string =>
  `${plural(counts.drafts, 'draft')}, ${plural(counts.discarded, 'discarded note')} and ${plural(counts.draftRequests, 'draft request')}`

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const USAGE = 'Usage: dovecote notes export <email> | dovecote notes delete-drafts <email> [--yes]'
