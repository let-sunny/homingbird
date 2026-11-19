import { Task as T } from '@homingbird/kernel'
import {
  type Channel,
  Conflict,
  type ConversationId,
  type MemberId,
  type NotFound,
  type NoteId,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, dialect, run } from '../sql/database.ts'
import { insertIgnoringConflict, sql } from '../sql/query.ts'
import { abandonDraft } from './abandoned-drafts.ts'
import {
  type ChannelRow,
  type Viewer,
  channelRow,
  describeChannel,
  existingChannel,
  helpersOf,
  membersOf,
  visibilityOf,
} from './channel-rows.ts'
import type { NoteRow } from './note-rows.ts'
import { announceStatus } from './note-status.ts'
import { renamePlace } from './principles.ts'

export const reviseChannel = (
  viewer: Viewer,
  slug: string,
  changes: { readonly slug?: string; readonly description?: string },
): T.Task<Channel, NotFound | Conflict, AppEnv> =>
  T.gen(function* () {
    const row = yield* existingChannel(slug)
    const renamed = changes.slug ?? slug
    if (renamed !== slug && (yield* channelRow(renamed)) !== null)
      return yield* T.fail(Conflict({ message: 'That name is not available.' }))
    yield* run(
      sql`UPDATE channels SET slug = ${renamed}, description = ${changes.description ?? row.description} WHERE slug = ${slug}`,
    )
    yield* run(sql`UPDATE conversations SET title = ${renamed} WHERE id = ${row.conversation_id}`)
    if (renamed !== slug) yield* renamePlace(slug, renamed)
    return yield* describeChannel(viewer, yield* existingChannel(renamed))
  })

/**
 * Archives a channel: it leaves the list, its room becomes read-only and stays readable to its members,
 * its notes stay where they are and its waiting drafts are discarded. With a destination, its members
 * join that channel and keep answering if they did.
 */
export const archiveChannel = (
  slug: string,
  moveMembersTo: string | null,
): T.Task<void, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const row = yield* existingChannel(slug)
    if (moveMembersTo !== null) yield* moveMembers(row, moveMembersTo)
    const drafts = yield* all<NoteRow>(
      sql`SELECT * FROM notes WHERE conversation_id = ${row.conversation_id} AND status = 'draft' ORDER BY id`,
    )
    for (const draft of drafts) yield* abandonDraft(draft, slug)
    yield* stopDraftingIn(row.conversation_id)
    yield* run(sql`DELETE FROM channel_answerers WHERE conversation_id = ${row.conversation_id}`)
    yield* run(sql`DELETE FROM channel_managers WHERE conversation_id = ${row.conversation_id}`)
    yield* run(sql`DELETE FROM channels WHERE slug = ${slug}`)
    yield* run(
      sql`UPDATE conversations SET kind = 'group', archived_at = ${env.clock.now()} WHERE id = ${row.conversation_id}`,
    )
  })

const stopDraftingIn = (conversationId: ConversationId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const picked = yield* all<{ id: NoteId }>(
      sql`SELECT DISTINCT n.id FROM notes n JOIN receipts r ON r.note_id = n.id WHERE n.conversation_id = ${conversationId} AND r.drafting_at IS NOT NULL ORDER BY n.id`,
    )
    yield* run(
      sql`DELETE FROM pickups WHERE note_id IN (SELECT id FROM notes WHERE conversation_id = ${conversationId})`,
    )
    yield* run(
      sql`UPDATE receipts SET drafting_at = NULL WHERE drafting_at IS NOT NULL AND note_id IN (SELECT id FROM notes WHERE conversation_id = ${conversationId})`,
    )
    for (const { id } of picked) yield* announceStatus(id)
  })

const moveMembers = (from: ChannelRow, intoSlug: string): T.Task<void, NotFound | Conflict, RequestEnv> =>
  T.gen(function* () {
    if (from.slug === intoSlug)
      return yield* T.fail(Conflict({ message: 'Choose another channel to move the members to.' }))
    const into = yield* existingChannel(intoSlug)
    const leaving = yield* membersOf(from.conversation_id)
    const isEitherPrivate = visibilityOf(from) === 'private' || visibilityOf(into) === 'private'
    if (isEitherPrivate && !sameMembers(leaving, yield* membersOf(into.conversation_id)))
      return yield* T.fail(
        Conflict({
          message:
            'Members of a private channel, or of any channel moving into a private one, move only between channels with the same members. Archive without moving them.',
        }),
      )
    const target = yield* dialect
    for (const member_id of leaving)
      yield* run(
        insertIgnoringConflict(target, 'participants', { conversation_id: into.conversation_id, member_id }),
      )
    for (const member_id of yield* helpersOf(from.conversation_id))
      yield* run(
        insertIgnoringConflict(target, 'channel_answerers', {
          conversation_id: into.conversation_id,
          member_id,
        }),
      )
  })

const sameMembers = (a: ReadonlyArray<MemberId>, b: ReadonlyArray<MemberId>): boolean =>
  a.length === b.length && a.every((id) => b.includes(id))
