import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type Debate,
  type DebateExport,
  type DebateExportFormat,
  type DebateId,
  type DebateResult,
  Forbidden,
  Invalid,
  type MemberId,
  NOTE_BODY_MAX,
  type NotFound,
  type Note,
  creditsOf,
  debateFilename,
  debateJson,
  debateMarkdown,
  debateResultText,
  resultProblem,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { dialect, run } from '../sql/database.ts'
import { insertIgnoringConflict, insertInto, sql } from '../sql/query.ts'
import { recordAudit } from './audit.ts'
import {
  type DebateRow,
  announceDebate,
  describeDebate,
  lockedDebate,
  participantByAgent,
  participantsOf,
  visibleDebate,
} from './debate-rows.ts'
import { concludeOverdueDebates } from './debate-turns.ts'
import { membersByIds } from './members.ts'
import { type NoteFailure, createDraft } from './notes.ts'

/**
 * Saves the room's result as drafted by one participant's agent. It replaces nothing: a second draft
 * waits until the people decline the first. Every participant's person then approves it, or not.
 */
export const draftResult = (
  caller: Caller,
  id: DebateId,
  result: DebateResult,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    yield* concludeOverdueDebates
    yield* visibleDebate(caller.member.id, id)
    const participant = isHuman(caller) ? null : yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(Forbidden({ message: 'Only an agent opted in for this room drafts its result.' }))
    const row = yield* lockedDebate(id, now)
    if (row.status !== 'concluding')
      return yield* T.fail(Conflict({ message: 'The result is drafted once the room’s turns have run out.' }))
    if (row.result !== null)
      return yield* T.fail(
        Conflict({ message: 'A result is already drafted; its people approve or decline it.' }),
      )
    const problem = resultProblem(
      result,
      (yield* participantsOf(id)).map((one) => one.member_id),
    )
    if (problem !== null) return yield* T.fail(Invalid({ message: problem }))
    yield* run(sql`
      UPDATE debates SET result = ${JSON.stringify(result)}, result_by = ${participant.member_id},
      result_at = ${now}, updated_at = ${now} WHERE id = ${id}`)
    yield* run(sql`DELETE FROM debate_approvals WHERE debate_id = ${id}`)
    yield* announceDebate(row)
    return yield* describeDebate(yield* lockedDebate(id, now))
  })

/**
 * Records one person's approval in the web client. When every participant's person approved, the room
 * closes, read-only for good, and the growth record credits what the approved result says.
 */
export const approveResult = (
  caller: Caller,
  id: DebateId,
  draftedAt: number,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    const row = yield* waitingResult(caller, id, draftedAt, now)
    yield* run(
      insertIgnoringConflict(yield* dialect, 'debate_approvals', {
        debate_id: id,
        member_id: caller.member.id,
        approved_at: now,
      }),
    )
    const debate = yield* describeDebate(row)
    if (debate.approvals.some((one) => one.approvedAt === null)) {
      yield* announceDebate(row)
      return debate
    }
    yield* run(
      sql`UPDATE debates SET status = 'closed', closed_at = ${now}, updated_at = ${now} WHERE id = ${id}`,
    )
    for (const { memberId, credit } of creditsOf(debate.result!.result))
      yield* run(
        insertInto('debate_credits', { debate_id: id, member_id: memberId, kind: credit, created_at: now }),
      )
    yield* recordAudit({ caller, action: 'debates.closed', target: id, detail: { result: debate.result } })
    yield* announceDebate(row, 'everyone')
    return yield* describeDebate(yield* lockedDebate(id, now))
  })

/** A participant's person turns the drafted result down; the room asks its agents for another. */
export const declineResult = (
  caller: Caller,
  id: DebateId,
  draftedAt: number,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    const now = env.clock.now()
    const row = yield* waitingResult(caller, id, draftedAt, now)
    yield* run(sql`
      UPDATE debates SET result = NULL, result_by = NULL, result_at = NULL, result_round = result_round + 1
      WHERE id = ${id}`)
    yield* run(sql`DELETE FROM debate_approvals WHERE debate_id = ${id}`)
    yield* announceDebate(row)
    return yield* describeDebate(yield* lockedDebate(id, now))
  })

export interface ResultDestination {
  readonly conversationId?: ConversationId
  readonly to?: MemberId
  readonly channel?: string
}

/**
 * Puts the approved result, and nothing else from the room, into a draft of the person's own in a channel
 * or a conversation; it leaves when they send it there, as every note does.
 */
export const postResult = (
  caller: Caller,
  id: DebateId,
  destination: ResultDestination,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const debate = yield* closedDebate(caller, id)
    if (!debate.participants.some((one) => one.memberId === caller.member.id))
      return yield* T.fail(Forbidden({ message: 'Only a person whose agent took part posts the result.' }))
    const chosen = [destination.conversationId, destination.to, destination.channel].filter(
      (each) => each !== undefined,
    )
    if (chosen.length !== 1)
      return yield* T.fail(
        Invalid({ message: 'Say where the result goes: one conversation, person or channel.' }),
      )
    const body = debateResultText(debate, debate.result!.result, yield* namesFor(debate))
    if (body.length > NOTE_BODY_MAX)
      return yield* T.fail(
        Invalid({
          message: `The result is ${body.length} characters, more than a note holds (${NOTE_BODY_MAX}). Export it instead.`,
        }),
      )
    return yield* createDraft(caller, {
      body,
      fromDebate: id,
      ...(destination.conversationId !== undefined && { conversationId: destination.conversationId }),
      ...(destination.to !== undefined && { to: [destination.to] }),
      ...(destination.channel !== undefined && { channel: destination.channel }),
    })
  })

/** The whole closed room, transcript and result, for a member to keep; the request itself is audited. */
export const exportDebate = (
  caller: Caller,
  id: DebateId,
  format: DebateExportFormat,
): T.Task<DebateExport, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const debate = yield* closedDebate(caller, id)
    const nameOf = yield* namesFor(debate)
    return format === 'markdown'
      ? {
          filename: debateFilename(debate, 'md'),
          mediaType: 'text/markdown',
          text: debateMarkdown(debate, nameOf),
        }
      : {
          filename: debateFilename(debate, 'json'),
          mediaType: 'application/json',
          text: debateJson(debate, nameOf),
        }
  })

const waitingResult = (
  caller: Caller,
  id: DebateId,
  draftedAt: number,
  now: number,
): T.Task<DebateRow, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller))
      return yield* T.fail(Forbidden({ message: 'Only a person approves a result, in the web client.' }))
    yield* visibleDebate(caller.member.id, id)
    const row = yield* lockedDebate(id, now)
    if (!(yield* participantsOf(id)).some((one) => one.member_id === caller.member.id))
      return yield* T.fail(
        Forbidden({ message: 'Only a person whose agent took part decides on the result.' }),
      )
    if (row.status !== 'concluding' || row.result === null)
      return yield* T.fail(Conflict({ message: 'There is no drafted result waiting for approval.' }))
    if (Number(row.result_at) !== draftedAt)
      return yield* T.fail(Conflict({ message: 'The result changed since you read it. Read it again.' }))
    return row
  })

const closedDebate = (
  caller: Caller,
  id: DebateId,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can do this.' }))
    const debate = yield* describeDebate(yield* visibleDebate(caller.member.id, id))
    if (debate.status !== 'closed' || debate.result === null)
      return yield* T.fail(Conflict({ message: 'Only a closed room, its result approved, leaves the room.' }))
    return debate
  })

const namesFor = (debate: Debate): T.Task<(id: MemberId) => string, never, RequestEnv> =>
  T.map(
    (members: ReadonlyMap<MemberId, { readonly name: string }>) => (id: MemberId) =>
      members.get(id)?.name ?? 'A former member',
  )(membersByIds([debate.createdBy, ...debate.memberIds, ...debate.participants.map((one) => one.memberId)]))
