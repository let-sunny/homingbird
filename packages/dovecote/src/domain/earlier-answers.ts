import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  type EarlierAnswer,
  type EarlierAnswersAsk,
  type MemberId,
  NotFound,
  type NoteId,
  questionTerms,
  rankEarlierAnswers,
} from '@homingbird/protocol'
import type { AppEnv } from '../environment.ts'
import { all, dialect, first, run } from '../sql/database.ts'
import { type Query, containsIgnoringCase, insertIgnoringConflict, join, list, sql } from '../sql/query.ts'
import { participatedConversation } from './conversations.ts'
import { type NoteRow, hydrateNotes } from './note-rows.ts'
import { visibleNote } from './notes.ts'

/**
 * Sent answers to earlier questions that share words with the one being written. Rule 2 and the note
 * query rule hold for both notes: the viewer takes part in each one's conversation, and each was sent.
 */
export const earlierAnswers = (
  viewerId: MemberId,
  ask: EarlierAnswersAsk,
): T.Task<EarlierAnswer[], never, AppEnv> =>
  T.gen(function* () {
    const terms = questionTerms(ask.question)
    if (terms.length === 0) return []
    const rows = yield* all<CandidateRow>(sql`
      SELECT a.id AS answer_id, a.body AS answer_body, a.sent_at AS answer_sent_at,
        a.conversation_id AS answer_conversation_id, q.id AS question_id, q.body AS question_body,
        ch.slug AS channel
      FROM notes a
      JOIN notes q ON q.id = a.in_reply_to
      JOIN participants pa ON pa.conversation_id = a.conversation_id AND pa.member_id = ${viewerId}
      JOIN participants pq ON pq.conversation_id = q.conversation_id AND pq.member_id = ${viewerId}
      LEFT JOIN channels ch ON ch.conversation_id = a.conversation_id
      WHERE a.status = 'sent' AND q.status = 'sent' AND a.author_id <> q.author_id
      AND (${anyTermIn(terms)})
      ORDER BY a.sent_at DESC, a.id DESC LIMIT ${CANDIDATES_MAX}`)
    const destination = yield* destinationOf(ask)
    const ranked = rankEarlierAnswers(rows.map(candidateOf), terms, destination)
    if (ranked.length === 0) return []
    const notes = yield* hydrateNotes(
      yield* all<NoteRow>(
        sql`SELECT * FROM notes WHERE id IN ${list(ranked.flatMap((each) => [each.question.id, each.answer.id]))}`,
      ),
      viewerId,
    )
    const byId = new Map(notes.map((note) => [note.id, note]))
    return ranked.map((candidate) => ({
      question: byId.get(candidate.question.id)!,
      answer: byId.get(candidate.answer.id)!,
      channel: candidate.channel,
    }))
  })

/**
 * Counts that an earlier answer the viewer may read answered the question they were writing to a room
 * they are in. Nothing is sent; each person, room and answer counts once.
 */
export const recordAnsweredFromHistory = (
  viewerId: MemberId,
  answerId: NoteId,
  conversationId: ConversationId,
): T.Task<Record<string, never>, NotFound, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const answer = yield* visibleNote(viewerId, answerId)
    if (answer.status !== 'sent' || answer.inReplyTo === null)
      return yield* T.fail(NotFound({ message: 'No such answer.' }))
    yield* participatedConversation(viewerId, conversationId)
    yield* run(
      insertIgnoringConflict(yield* dialect, 'history_answers', {
        member_id: viewerId,
        conversation_id: conversationId,
        note_id: answerId,
        answered_at: env.clock.now(),
      }),
    )
    return {}
  })

const destinationOf = (ask: EarlierAnswersAsk): T.Task<string | null, never, AppEnv> => {
  if (ask.conversationId !== undefined) return T.succeed(ask.conversationId)
  if (ask.channel === undefined) return T.succeed(null)
  return T.map((row: { conversation_id: string } | null) => row?.conversation_id ?? null)(
    first<{ conversation_id: string }>(sql`SELECT conversation_id FROM channels WHERE slug = ${ask.channel}`),
  )
}

const anyTermIn = (terms: ReadonlyArray<string>): Query =>
  join(
    terms.flatMap((term) => [containsIgnoringCase('q.body', term), containsIgnoringCase('a.body', term)]),
    ' OR ',
  )

const candidateOf = (row: CandidateRow): RankedRow => ({
  question: { id: row.question_id, body: row.question_body },
  answer: {
    id: row.answer_id,
    body: row.answer_body,
    sentAt: row.answer_sent_at === null ? null : Number(row.answer_sent_at),
    conversationId: row.answer_conversation_id,
  },
  channel: row.channel,
})

interface RankedRow {
  readonly question: { readonly id: NoteId; readonly body: string }
  readonly answer: {
    readonly id: NoteId
    readonly body: string
    readonly sentAt: number | null
    readonly conversationId: string
  }
  readonly channel: string | null
}

interface CandidateRow {
  readonly answer_id: NoteId
  readonly answer_body: string
  readonly answer_sent_at: number | string | null
  readonly answer_conversation_id: string
  readonly question_id: NoteId
  readonly question_body: string
  readonly channel: string | null
}

const CANDIDATES_MAX = 200
