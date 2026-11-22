import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type DraftSource,
  Invalid,
  type MemberId,
  type NoteSource,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import type { NoteRow } from './note-rows.ts'

/** A draft's sources as stored: an earlier note must be sent and read by the author, kept with its room. */
export const storedSources = (
  authorId: MemberId,
  sources: ReadonlyArray<DraftSource> | undefined,
): T.Task<string | null, Invalid, AppEnv> =>
  T.gen(function* () {
    if (sources === undefined || sources.length === 0) return null
    const stored: NoteSource[] = []
    for (const source of sources) stored.push(yield* storedSource(authorId, source))
    return JSON.stringify(stored)
  })

/** A note's sources for whoever is shown its basis; a note stored without them has none to show. */
export const sourcesShown = (row: Pick<NoteRow, 'sources'>): { readonly sources?: NoteSource[] } =>
  (row.sources ?? null) === null ? {} : { sources: JSON.parse(row.sources!) as NoteSource[] }

export const UNREAD_SOURCE = 'A source names a note you cannot read, or one not sent yet.'

const storedSource = (authorId: MemberId, source: DraftSource): T.Task<NoteSource, Invalid, AppEnv> =>
  T.gen(function* () {
    const quote = source.quote === undefined ? {} : { quote: source.quote.trim() }
    if (source.noteId === undefined) return { url: source.url!, ...quote }
    const note = yield* first<{ conversation_id: ConversationId }>(sql`
      SELECT n.conversation_id FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${authorId}
      WHERE n.id = ${source.noteId} AND n.status = 'sent'`)
    if (note === null) return yield* T.fail(Invalid({ message: UNREAD_SOURCE }))
    return { noteId: source.noteId, conversationId: note.conversation_id, ...quote }
  })
