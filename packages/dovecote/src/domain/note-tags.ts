import { Task as T } from '@homingbird/kernel'
import { type ConversationId, Invalid, type MemberId, type NoteId, tagsAsked } from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { participantsOf } from './conversations.ts'
import type { NoteRow } from './note-rows.ts'
import { featureIsOn } from './settings.ts'

/** A draft's tags as stored: only in a group message and only its people, given as a list, never read from the body. */
export const storedTags = (draft: {
  readonly authorId: MemberId
  readonly conversationId: ConversationId
  readonly inReplyTo: NoteId | null
  readonly tags: ReadonlyArray<MemberId> | undefined
}): T.Task<string | null, Invalid, AppEnv> =>
  T.gen(function* () {
    const given = draft.tags ?? []
    if (!(yield* featureIsOn('tagging'))) {
      if (given.length > 0) return yield* T.fail(Invalid({ message: TAGGING_OFF }))
      return null
    }
    const room = yield* first<{ kind: string; channel_id: string | null }>(
      sql`SELECT kind, channel_id FROM conversations WHERE id = ${draft.conversationId}`,
    )
    if (room?.kind !== 'group' || room.channel_id !== null) {
      if (given.length > 0) return yield* T.fail(Invalid({ message: TAGS_ONLY_IN_GROUPS }))
      return null
    }
    const people = new Set(yield* participantsOf(draft.conversationId))
    if (given.some((id) => !people.has(id))) return yield* T.fail(Invalid({ message: TAG_OUTSIDE_ROOM }))
    const answered =
      draft.inReplyTo === null
        ? null
        : yield* first<{ author_id: MemberId }>(
            sql`SELECT author_id FROM notes WHERE id = ${draft.inReplyTo}`,
          )
    const answeredAuthorId = answered !== null && people.has(answered.author_id) ? answered.author_id : null
    const tags = tagsAsked({ authorId: draft.authorId, tags: given, answeredAuthorId })
    return tags.length === 0 ? null : JSON.stringify(tags)
  })

export const tagsOf = (row: Pick<NoteRow, 'tags'>): MemberId[] =>
  (row.tags ?? null) === null ? [] : (JSON.parse(row.tags!) as MemberId[])

export const tagsShown = (row: Pick<NoteRow, 'tags'>): { readonly tags?: MemberId[] } =>
  (row.tags ?? null) === null ? {} : { tags: tagsOf(row) }

export const tagsAsStored = (tags: ReadonlyArray<MemberId> | undefined): string =>
  tags === undefined || tags.length === 0 ? '' : JSON.stringify([...new Set(tags)].sort())

export const TAGGING_OFF = 'Tagging people is turned off in this organization.'
export const TAGS_ONLY_IN_GROUPS = 'Tag people only in a group message.'
export const TAG_OUTSIDE_ROOM = 'Tag only people in this group message.'
