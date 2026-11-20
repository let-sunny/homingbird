import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  FEATURE_OFF_MESSAGE,
  Forbidden,
  type MemberId,
  NotFound,
  type NoteId,
  REVIEWS_LIMIT,
  type Review,
  isPerson,
  possibleReviewers,
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

/** The agents' drafts waiting for this person as a manager, never one meant for them (rule 2). */
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
        AND (c.asked_by IS NULL OR c.asked_by <> ${viewerId})
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
    const askers = yield* askersOf(read)
    const standing = reviewerStanding({
      reviewerId: caller.member.id,
      isPerson: isHuman(caller) && isPerson(caller.member),
      managers,
      askers,
    })
    if (standing === 'not_a_person')
      return yield* T.fail(Forbidden({ message: 'Only a person can approve a note.' }))
    if (standing !== 'reviewer') return yield* T.fail(noSuchDraft)
    const draft = yield* agentDraft(id)
    if (draft.status !== 'draft') return yield* T.fail(yield* alreadyDecided(draft))
    return { draft, channel, reviewers: possibleReviewers(managers, askers) }
  })

export const reviewersOf = (draft: NoteRow): T.Task<MemberId[], never, AppEnv> =>
  T.gen(function* () {
    const channel = yield* channelOfAgentRoom(draft.conversation_id)
    if (channel === null) return []
    return possibleReviewers(yield* managersOf(channel), yield* askersOf(draft))
  })

/** Whom a draft is for, so who may never see or send it: the note's author and a private question's asker. */
export const askersOf = (
  draft: Pick<NoteRow, 'conversation_id' | 'in_reply_to'>,
): T.Task<MemberId[], never, AppEnv> =>
  T.gen(function* () {
    const answered =
      draft.in_reply_to === null
        ? null
        : yield* first<{ author_id: MemberId }>(
            sql`SELECT author_id FROM notes WHERE id = ${draft.in_reply_to}`,
          )
    const room = yield* first<{ asked_by: MemberId | null }>(
      sql`SELECT asked_by FROM conversations WHERE id = ${draft.conversation_id}`,
    )
    return [...new Set([answered?.author_id ?? null, room?.asked_by ?? null])].filter(
      (id): id is MemberId => id !== null,
    )
  })

const noSuchDraft = NotFound({ message: 'No such draft.' })

const agentDraft = (id: NoteId): T.Task<NoteRow, NotFound, AppEnv> =>
  T.flatMap((row: NoteRow | null) => (row === null ? T.fail(noSuchDraft) : T.succeed(row)))(
    first<NoteRow>(sql`
      SELECT n.* FROM notes n JOIN members a ON a.id = n.author_id AND a.kind = 'channel_agent'
      WHERE n.id = ${id}`),
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
