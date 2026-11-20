import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  FEATURE_OFF_MESSAGE,
  Forbidden,
  type MemberId,
  NotFound,
  type NoteId,
  type Review,
  isPerson,
  reviewerStanding,
} from '@homingbird/protocol'
import { type AppEnv, type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first } from '../sql/database.ts'
import { sql } from '../sql/query.ts'
import { type ChannelRow, channelOfAgentRoom, managersOf } from './channel-rows.ts'
import { lockGroups } from './group-rows.ts'
import { memberById } from './members.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'
import { featureIsOn } from './settings.ts'

/**
 * The drafts of channels' agents waiting for this person: in a channel they manage and are in, never one
 * answering their own question, which stays invisible to them like any draft to its recipient (rule 2).
 */
export const reviewsFor = (caller: Caller): T.Task<Review[], never, AppEnv> =>
  T.gen(function* () {
    const viewerId = caller.member.id
    const rows = yield* all<ReviewRow>(sql`
      SELECT n.*, t.slug AS review_channel, c.channel_id AS asked_of FROM notes n
      JOIN members a ON a.id = n.author_id AND a.kind = 'channel_agent'
      JOIN conversations c ON c.id = n.conversation_id
      JOIN channels t ON t.conversation_id = COALESCE(c.channel_id, c.id)
      JOIN group_members g ON g.group_id = t.manager_group_id AND g.member_id = ${viewerId}
      JOIN participants p ON p.conversation_id = t.conversation_id AND p.member_id = ${viewerId}
      WHERE n.status = 'draft'
        AND NOT EXISTS (SELECT 1 FROM notes q WHERE q.id = n.in_reply_to AND q.author_id = ${viewerId})
      ORDER BY n.created_at, n.id LIMIT ${REVIEWS_LIMIT}`)
    return yield* T.forEach(rows, toReview)
  })

export const reviewFor = (caller: Caller, id: NoteId): T.Task<Review, NotFound, AppEnv> =>
  T.gen(function* () {
    const shown = (yield* reviewsFor(caller)).find((review) => review.note.id === id)
    return shown ?? (yield* T.fail(NotFound({ message: 'No such draft.' })))
  })

/**
 * A channel's agent's draft this person may send or discard, read again under the channel group's lock
 * so that two managers deciding at once settle in turn: the second is told who already sent it.
 */
export const reviewedDraft = (
  caller: Caller,
  id: NoteId,
): T.Task<
  { readonly draft: NoteRow; readonly channel: ChannelRow; readonly reviewers: MemberId[] },
  NotFound | Forbidden | Conflict,
  RequestEnv
> =>
  T.gen(function* () {
    const read = yield* agentDraft(id)
    if (!(yield* featureIsOn('channelAgents')))
      return yield* T.fail(NotFound({ message: FEATURE_OFF_MESSAGE }))
    const before = yield* channelOfAgentRoom(read.conversation_id)
    if (before === null) return yield* T.fail(noSuchDraft)
    yield* lockGroups([before.manager_group_id])
    const channel = yield* channelOfAgentRoom(read.conversation_id)
    if (channel === null) return yield* T.fail(noSuchDraft)
    const managers = yield* managersOf(channel)
    const askerId = yield* askerOf(read)
    const standing = reviewerStanding({
      reviewerId: caller.member.id,
      isPerson: isHuman(caller) && isPerson(caller.member),
      managers,
      askerId,
    })
    if (standing === 'not_a_person')
      return yield* T.fail(Forbidden({ message: 'Only a person can approve a note.' }))
    if (standing !== 'reviewer') return yield* T.fail(noSuchDraft)
    const draft = yield* agentDraft(id)
    if (draft.status !== 'draft') return yield* T.fail(yield* alreadyDecided(draft))
    return { draft, channel, reviewers: managers.filter((memberId) => memberId !== askerId) }
  })

/** Who is told that a channel's agent's draft changed: the managers who may review it. */
export const reviewersOf = (draft: NoteRow): T.Task<MemberId[], never, AppEnv> =>
  T.gen(function* () {
    const channel = yield* channelOfAgentRoom(draft.conversation_id)
    if (channel === null) return []
    const askerId = yield* askerOf(draft)
    return (yield* managersOf(channel)).filter((memberId) => memberId !== askerId)
  })

const REVIEWS_LIMIT = 200

const noSuchDraft = NotFound({ message: 'No such draft.' })

const agentDraft = (id: NoteId): T.Task<NoteRow, NotFound, AppEnv> =>
  T.flatMap((row: NoteRow | null) => (row === null ? T.fail(noSuchDraft) : T.succeed(row)))(
    first<NoteRow>(sql`
      SELECT n.* FROM notes n JOIN members a ON a.id = n.author_id AND a.kind = 'channel_agent'
      WHERE n.id = ${id}`),
  )

const askerOf = (draft: Pick<NoteRow, 'in_reply_to'>): T.Task<MemberId | null, never, AppEnv> =>
  draft.in_reply_to === null
    ? T.succeed(null)
    : T.map((row: { author_id: MemberId } | null) => row?.author_id ?? null)(
        first<{ author_id: MemberId }>(sql`SELECT author_id FROM notes WHERE id = ${draft.in_reply_to}`),
      )

/** The first approval wins; the others, all of them reviewers, are told who sent it. */
const alreadyDecided = (draft: NoteRow): T.Task<Conflict, never, AppEnv> =>
  T.gen(function* () {
    const approvedBy = draft.approved_by
    if (draft.status !== 'sent' || approvedBy === null)
      return Conflict({ message: 'This draft was already sent or discarded.' })
    const approver = yield* T.result(memberById(approvedBy))
    const name = approver._tag === 'Ok' ? approver.value.name : 'another manager'
    return Conflict({ message: `${name} already sent this answer.` })
  })

interface ReviewRow extends NoteRow {
  readonly review_channel: string
  readonly asked_of: string | null
}

const toReview = ({ review_channel, asked_of, ...row }: ReviewRow): T.Task<Review, never, AppEnv> =>
  T.gen(function* () {
    const [note] = yield* hydrateNotes([row], row.author_id)
    const question =
      row.in_reply_to === null
        ? []
        : yield* hydrateNotes(
            yield* all<NoteRow>(sql`SELECT * FROM notes WHERE id = ${row.in_reply_to} AND status = 'sent'`),
            null,
          )
    return {
      note: { ...note!, basis: row.basis },
      question: question[0] ?? null,
      channel: review_channel,
      agent: yield* T.orDie(memberById(row.author_id)),
      privately: asked_of !== null,
    }
  })
