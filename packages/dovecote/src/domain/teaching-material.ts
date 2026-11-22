import { Task as T } from '@homingbird/kernel'
import {
  type ConversationId,
  Forbidden,
  type MemberId,
  type NoteId,
  PROPOSALS_PER_PERSON,
  REWRITES_SHOWN,
  type Rewrite,
  type RewriteOutcome,
  type TeachingInterview,
  type TeachingMaterial,
} from '@homingbird/protocol'
import type { AppEnv, Caller } from '../environment.ts'
import { all, first, inTransaction, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { PLACE_COLUMNS, PLACE_JOIN, type PlaceRow, placeOf } from './places.ts'
import { principlesOf } from './principle-rows.ts'
import { DAY_MS } from './trust-figures.ts'

/**
 * What a person's own agent reads to run a teaching chat: the document the person pasted, the drafts
 * they recently edited or discarded, and the titles already taught or waiting. Only the person's own
 * notes, in conversations they are still in, and the sent note each answered.
 */
export const teachingMaterial = (caller: Caller): T.Task<TeachingMaterial, Forbidden, AppEnv> =>
  T.gen(function* () {
    const memberId = caller.member.id
    if (caller.member.kind === 'channel_agent')
      return yield* T.fail(
        Forbidden({ message: 'A channel’s agent is taught by its managers on its channel’s page.' }),
      )
    const proposed = yield* all<{ topic: string }>(
      sql`SELECT topic FROM principle_proposals WHERE member_id = ${memberId} ORDER BY created_at, id`,
    )
    return {
      personName: caller.member.name,
      personEmail: caller.member.email,
      document: yield* teachingDocumentOf(memberId),
      rewrites: yield* rewritesOf(memberId),
      taught: (yield* principlesOf(memberId)).map((principle) => principle.topic),
      proposed: proposed.map((row) => row.topic),
      room: Math.max(0, PROPOSALS_PER_PERSON - proposed.length),
    }
  })

/** The person's pasted document and waiting proposals, as the web client shows the teaching chat. */
export const teachingInterview = (
  memberId: MemberId,
  proposals: TeachingInterview['proposals'],
): T.Task<TeachingInterview, never, AppEnv> =>
  T.map((document: string | null) => ({ document, proposals, limit: PROPOSALS_PER_PERSON }))(
    teachingDocumentOf(memberId),
  )

/** Keeps the principles document a person pasted for their agent to ask about, or removes it. */
export const setTeachingDocument = (
  memberId: MemberId,
  document: string | null,
): T.Task<void, never, AppEnv> =>
  inTransaction(
    T.gen(function* () {
      const env = yield* T.ask<AppEnv>()
      yield* run(sql`DELETE FROM teaching_documents WHERE member_id = ${memberId}`)
      const text = document?.trim() ?? ''
      if (text !== '')
        yield* run(
          insertInto('teaching_documents', {
            member_id: memberId,
            document: text,
            updated_at: env.clock.now(),
          }),
        )
    }),
  )

/** Whether a note is a draft of the person's that they edited or discarded, and which. */
export const rewriteOutcome = (
  memberId: MemberId,
  noteId: string,
): T.Task<RewriteOutcome | null, never, AppEnv> =>
  T.map((row: RewriteRow | null) => (row === null ? null : outcomeOf(row)))(
    first<RewriteRow>(
      sql`SELECT n.*, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN} ${REWRITTEN}
        AND n.author_id = ${memberId} AND n.id = ${noteId}`,
    ),
  )

/** The decided drafts their author changed or set aside, in conversations the author is still in. */
const REWRITTEN = sql`
  JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = n.author_id
  WHERE n.agent_body IS NOT NULL AND n.debate_id IS NULL AND n.decided_at IS NOT NULL
  AND ((n.status = 'sent' AND n.origin <> 'agent') OR n.status = 'discarded')`

const REWRITES_KEPT_MS = 30 * DAY_MS

const teachingDocumentOf = (memberId: MemberId): T.Task<string | null, never, AppEnv> =>
  T.map((row: { document: string } | null) => row?.document ?? null)(
    first<{ document: string }>(sql`SELECT document FROM teaching_documents WHERE member_id = ${memberId}`),
  )

const rewritesOf = (memberId: MemberId): T.Task<Rewrite[], never, AppEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<AppEnv>()
    const rows =
      yield* all<RewriteRow>(sql`SELECT n.*, ${PLACE_COLUMNS} FROM notes n ${PLACE_JOIN} ${REWRITTEN}
      AND n.author_id = ${memberId} AND n.decided_at >= ${env.clock.now() - REWRITES_KEPT_MS}
      ORDER BY n.decided_at DESC, n.id LIMIT ${REWRITES_SHOWN}`)
    const answered = rows.flatMap((row) => (row.in_reply_to === null ? [] : [row.in_reply_to]))
    const asked =
      answered.length === 0
        ? []
        : yield* all<AskedRow>(sql`SELECT n.id, n.body, n.sent_at, m.name, m.email FROM notes n
            JOIN members m ON m.id = n.author_id
            WHERE n.id IN ${list(answered)} AND n.status = 'sent'`)
    const byId = new Map(asked.map((row) => [row.id, row]))
    return rows.map((row) => toRewrite(row, row.in_reply_to === null ? undefined : byId.get(row.in_reply_to)))
  })

const toRewrite = (row: RewriteRow, question: AskedRow | undefined): Rewrite => ({
  noteId: row.id,
  conversationId: row.conversation_id,
  place: placeOf(row),
  outcome: outcomeOf(row),
  draft: row.agent_body,
  sent: row.status === 'sent' ? row.body : null,
  decidedAt: Number(row.decided_at),
  asked:
    question === undefined
      ? null
      : {
          noteId: question.id,
          authorName: question.name,
          authorEmail: question.email,
          sentAt: question.sent_at === null ? null : Number(question.sent_at),
          body: question.body,
        },
})

const outcomeOf = (row: Pick<RewriteRow, 'status'>): RewriteOutcome =>
  row.status === 'sent' ? 'edited' : 'discarded'

interface RewriteRow extends PlaceRow {
  readonly id: NoteId
  readonly conversation_id: ConversationId
  readonly status: string
  readonly body: string
  readonly agent_body: string
  readonly in_reply_to: NoteId | null
  readonly decided_at: number
}

interface AskedRow {
  readonly id: NoteId
  readonly body: string
  readonly sent_at: number | null
  readonly name: string
  readonly email: string
}
