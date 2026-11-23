import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type CredentialId,
  type Debate,
  type DebateAnswerAsk,
  type DebateId,
  type DebateSuggestion,
  FEATURE_OFF_MESSAGE,
  Forbidden,
  Invalid,
  type MemberId,
  NotFound,
  type NoteId,
  RESULT_WINDOW_MS,
  SHORT_DEBATE_LIMITS,
  SUGGESTIONS_PER_PERSON,
  type SuggestionAcceptance,
  type SuggestionId,
  type SuggestionInput,
} from '@homingbird/protocol'
import { type Caller, isHuman } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { all, first, run } from '../sql/database.ts'
import { insertInto, list, sql } from '../sql/query.ts'
import { activeMembersAmong, createDebate, optInAgent, requireMayInvite } from './debates.ts'
import { featureIsOn } from './settings.ts'

/**
 * Keeps an agent's suggestion to talk a received note over with colleagues' agents before it answers, as a
 * card for its person. It opens no flock, invites nobody and tells no colleague: only `acceptSuggestion`,
 * the person's click in the web client, opens one (rule 9).
 */
export const suggestDebate = (
  caller: Caller,
  input: SuggestionInput,
): T.Task<DebateSuggestion, NotFound | Forbidden | Invalid | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireDebateRooms
    if (isHuman(caller)) return yield* T.fail(Forbidden({ message: PEOPLE_OPEN_ROOMS }))
    if (caller.member.kind !== 'person')
      return yield* T.fail(Forbidden({ message: 'A channel’s agent suggests no flocks.' }))
    const memberId = caller.member.id
    const question = input.question.trim()
    const reason = input.reason.trim()
    if (question === '' || reason === '')
      return yield* T.fail(Invalid({ message: 'A suggestion needs a question and a reason.' }))
    const note = yield* receivedNote(memberId, input.inReplyTo)
    if (input.draftId !== undefined) yield* requireOwnReply(memberId, input.draftId, input.inReplyTo)
    const people = yield* activeMembersAmong(input.memberIds.filter((id) => id !== memberId))
    if (people.length === 0)
      return yield* T.fail(Invalid({ message: 'Suggest at least one colleague other than your human.' }))
    if (people.includes(note.author_id)) return yield* T.fail(Invalid({ message: ASKER_LEFT_OUT }))
    yield* requireMayInvite(memberId, people)
    yield* run(sql`UPDATE members SET event_seq = event_seq WHERE id = ${memberId}`)
    const waiting = yield* waitingRows(memberId)
    if (waiting.length >= SUGGESTIONS_PER_PERSON)
      return yield* T.fail(Conflict({ message: SUGGESTIONS_FULL }))
    const earlier = yield* first<{ decided_at: number | null }>(sql`
      SELECT decided_at FROM debate_suggestions WHERE member_id = ${memberId} AND in_reply_to = ${input.inReplyTo}
      ORDER BY decided_at IS NULL DESC`)
    if (earlier !== null)
      return yield* T.fail(
        Conflict({
          message:
            earlier.decided_at === null
              ? 'A suggestion about this note already waits for your human.'
              : 'Your human already decided on a debate about this note: answer it yourself.',
        }),
      )
    const suggestion: DebateSuggestion = {
      id: `sugg_${env.random.identifier()}` as SuggestionId,
      inReplyTo: input.inReplyTo,
      conversationId: note.conversation_id,
      draftId: input.draftId ?? null,
      question,
      memberIds: people,
      reason,
      agentName: caller.credential.name,
      createdAt: env.clock.now(),
      askerId: note.author_id,
    }
    yield* run(
      insertInto('debate_suggestions', {
        id: suggestion.id,
        member_id: memberId,
        credential_id: caller.credential.id,
        in_reply_to: suggestion.inReplyTo,
        conversation_id: suggestion.conversationId,
        draft_id: suggestion.draftId,
        question,
        reason,
        created_at: suggestion.createdAt,
      }),
    )
    for (const [position, person] of people.entries())
      yield* run(
        insertInto('debate_suggestion_people', { suggestion_id: suggestion.id, member_id: person, position }),
      )
    yield* announceSuggestions(memberId)
    return suggestion
  })

/** The person's suggestions that wait for a decision, oldest first. */
export const waitingSuggestions = (caller: Caller): T.Task<DebateSuggestion[], NotFound, RequestEnv> =>
  T.gen(function* () {
    yield* requireDebateRooms
    const rows = yield* waitingRows(caller.member.id)
    if (rows.length === 0) return []
    const people = yield* all<{ suggestion_id: SuggestionId; member_id: MemberId }>(sql`
      SELECT suggestion_id, member_id FROM debate_suggestion_people
      WHERE suggestion_id IN ${list(rows.map((row) => row.id))} ORDER BY position`)
    return rows.map((row) => ({
      id: row.id,
      inReplyTo: row.in_reply_to,
      conversationId: row.conversation_id,
      draftId: row.draft_id,
      question: row.question,
      memberIds: people.filter((one) => one.suggestion_id === row.id).map((one) => one.member_id),
      reason: row.reason,
      agentName: row.agent_name ?? '',
      createdAt: Number(row.created_at),
      ...(row.asker_id != null && { askerId: row.asker_id }),
    }))
  })

/**
 * Opens a short private flock from the suggestion, with the person's edits, and opts in the agent that
 * suggested it, by the same path and checks as a flock they open themself. Colleagues' agents join only
 * when their own people opt them in. Only a person's own sign-in may: the route is `human`, and this
 * checks again.
 */
export const acceptSuggestion = (
  caller: Caller,
  id: string,
  acceptance: SuggestionAcceptance,
): T.Task<Debate, NotFound | Forbidden | Invalid | Conflict, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireDebateRooms
    yield* requirePerson(caller)
    const suggestion = yield* ownWaitingSuggestion(caller.member.id, id)
    const people = yield* all<{ member_id: MemberId }>(sql`
      SELECT member_id FROM debate_suggestion_people WHERE suggestion_id = ${suggestion.id} ORDER BY position`)
    const memberIds = (acceptance.memberIds ?? people.map((one) => one.member_id)).filter(
      (memberId) => memberId !== caller.member.id,
    )
    if (memberIds.length === 0)
      return yield* T.fail(Invalid({ message: 'Ask at least one colleague to the flock.' }))
    const asker = yield* first(
      sql`SELECT 1 AS present FROM notes WHERE id = ${suggestion.in_reply_to} AND author_id IN ${list(memberIds)}`,
    )
    if (asker !== null)
      return yield* T.fail(
        Invalid({
          message:
            'Leave out the person who asked the note: they would read the flock before you approve its answer.',
        }),
      )
    const opened = yield* createDebate(caller, {
      question: acceptance.question ?? suggestion.question,
      visibility: 'private',
      limits: SHORT_DEBATE_LIMITS,
      memberIds,
    })
    yield* run(sql`UPDATE debates SET suggestion_id = ${suggestion.id} WHERE id = ${opened.id}`)
    yield* run(sql`
      UPDATE debate_suggestions SET decided_at = ${env.clock.now()}, decision = 'accepted', debate_id = ${opened.id}
      WHERE id = ${suggestion.id}`)
    const debate = yield* optInAgent(caller, opened.id, suggestion.credential_id, acceptance.brief)
    yield* announceSuggestions(caller.member.id)
    return debate
  })

/** The person answers without a flock: the suggestion goes, and a draft its agent wrote stays on its card. */
export const dismissSuggestion = (
  caller: Caller,
  id: string,
): T.Task<void, NotFound | Forbidden, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* requireDebateRooms
    yield* requirePerson(caller)
    const suggestion = yield* ownWaitingSuggestion(caller.member.id, id)
    yield* run(sql`
      UPDATE debate_suggestions SET decided_at = ${env.clock.now()}, decision = 'dismissed'
      WHERE id = ${suggestion.id}`)
    yield* announceSuggestions(caller.member.id)
  })

/**
 * The flocks this agent's suggestions opened that ended in the last day and that it has not answered from,
 * then its suggestions its person turned down in the last day, with no flock, while their person has no
 * reply to the note: only the credential that suggested is asked, never another of its person's agents.
 * Null while suggestions are off, so that the ask is left out.
 */
export const roomAnswerAsks = (caller: Caller): T.Task<DebateAnswerAsk[] | null, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    if (!(yield* featureIsOn('debateSuggestions'))) return null
    if (isHuman(caller)) return []
    const rows = yield* all<{
      id: SuggestionId
      debate_id: DebateId
      in_reply_to: NoteId
      draft_id: NoteId | null
      result: string | null
    }>(sql`
      SELECT s.id, s.debate_id, s.in_reply_to, n.id AS draft_id, d.result FROM debate_suggestions s
      JOIN debates d ON d.id = s.debate_id
      LEFT JOIN notes n ON n.id = s.draft_id AND n.status = 'draft'
      WHERE s.credential_id = ${caller.credential.id} AND s.answered_at IS NULL
      AND d.status IN ('closed', 'ended') AND d.closed_at >= ${env.clock.now() - RESULT_WINDOW_MS}
      ORDER BY d.closed_at, s.id`)
    const dismissed = yield* all<{ id: SuggestionId; in_reply_to: NoteId }>(sql`
      SELECT s.id, s.in_reply_to FROM debate_suggestions s
      WHERE s.credential_id = ${caller.credential.id} AND s.decision = 'dismissed'
      AND s.decided_at >= ${env.clock.now() - RESULT_WINDOW_MS}
      AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.author_id = s.member_id AND n.in_reply_to = s.in_reply_to
        AND n.status IN ('draft', 'sent'))
      ORDER BY s.decided_at, s.id`)
    return [
      ...rows.map((row) => ({
        debateId: row.debate_id,
        suggestionId: row.id,
        inReplyTo: row.in_reply_to,
        draftId: row.draft_id,
        hasResult: row.result !== null,
      })),
      ...dismissed.map((row) => ({
        debateId: null,
        suggestionId: row.id,
        inReplyTo: row.in_reply_to,
        draftId: null,
        hasResult: false,
      })),
    ]
  })

/**
 * The suggestion whose flock a draft answers from: the calling agent suggested it, the flock has ended, no
 * draft answered from it yet, and the draft replies to the note it was about.
 */
export const requireRoomToAnswer = (
  caller: Caller,
  debateId: DebateId,
  inReplyTo: NoteId | null,
): T.Task<SuggestionId, NotFound | Forbidden | Invalid | Conflict, RequestEnv> =>
  T.gen(function* () {
    if (!(yield* featureIsOn('debateSuggestions')))
      return yield* T.fail(NotFound({ message: FEATURE_OFF_MESSAGE }))
    if (isHuman(caller))
      return yield* T.fail(
        Forbidden({ message: 'Only the agent whose suggestion opened a flock drafts its answer from it.' }),
      )
    const row = yield* first<{
      id: SuggestionId
      credential_id: CredentialId
      in_reply_to: NoteId
      answered_at: number | null
      status: string
    }>(sql`
      SELECT s.id, s.credential_id, s.in_reply_to, s.answered_at, d.status FROM debate_suggestions s
      JOIN debates d ON d.id = s.debate_id WHERE s.debate_id = ${debateId}`)
    if (row === null)
      return yield* T.fail(Invalid({ message: 'debateId must name a flock your suggestion opened.' }))
    if (row.credential_id !== caller.credential.id)
      return yield* T.fail(
        Forbidden({
          message: 'Only the agent whose suggestion opened this flock drafts its answer from it.',
        }),
      )
    if (row.status !== 'closed' && row.status !== 'ended')
      return yield* T.fail(Conflict({ message: 'This flock has not ended yet; answer once it has.' }))
    if (row.answered_at !== null)
      return yield* T.fail(Conflict({ message: 'A draft already answers from this flock.' }))
    if (inReplyTo !== row.in_reply_to)
      return yield* T.fail(
        Invalid({ message: 'A draft from this flock replies to the note its suggestion was about.' }),
      )
    return row.id
  })

export const markRoomAnswered = (id: SuggestionId): T.Task<void, never, RequestEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<RequestEnv>()
    yield* run(sql`UPDATE debate_suggestions SET answered_at = ${env.clock.now()} WHERE id = ${id}`)
  })

const PEOPLE_OPEN_ROOMS = 'A person opens a flock in the web client; an agent only suggests one.'
const ASKER_LEFT_OUT =
  'Leave out the person who asked the note: they would read the flock before your human approves its answer.'
const SUGGESTIONS_FULL = `Your human has ${SUGGESTIONS_PER_PERSON} suggestions waiting. Answer alone, or ask them to decide some in the web client first.`

const requireDebateRooms: T.Task<void, NotFound, RequestEnv> = T.flatMap((on: boolean) =>
  on ? T.unit : T.fail(NotFound({ message: FEATURE_OFF_MESSAGE })),
)(featureIsOn('debateRooms'))

const requirePerson = (caller: Caller): T.Task<void, Forbidden> =>
  isHuman(caller)
    ? T.unit
    : T.fail(Forbidden({ message: 'Only a person can open a suggested flock or answer without one.' }))

const receivedNote = (
  memberId: MemberId,
  id: NoteId,
): T.Task<{ readonly conversation_id: ConversationId; readonly author_id: MemberId }, Invalid, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<{ conversation_id: ConversationId; author_id: MemberId }>(sql`
      SELECT n.conversation_id, n.author_id FROM notes n
      JOIN participants p ON p.conversation_id = n.conversation_id AND p.member_id = ${memberId}
      WHERE n.id = ${id} AND n.status = 'sent' AND n.author_id <> ${memberId}`)
    if (row === null)
      return yield* T.fail(Invalid({ message: 'inReplyTo must name a note your human received.' }))
    return row
  })

const requireOwnReply = (
  memberId: MemberId,
  draftId: NoteId,
  inReplyTo: NoteId,
): T.Task<void, Invalid, RequestEnv> =>
  T.flatMap((row: unknown) =>
    row === null
      ? T.fail(Invalid({ message: 'draftId must name your own waiting draft that replies to inReplyTo.' }))
      : T.unit,
  )(
    first(sql`
      SELECT id FROM notes WHERE id = ${draftId} AND author_id = ${memberId} AND status = 'draft'
      AND in_reply_to = ${inReplyTo}`),
  )

const ownWaitingSuggestion = (memberId: MemberId, id: string): T.Task<SuggestionRow, NotFound, RequestEnv> =>
  T.gen(function* () {
    const row = yield* first<SuggestionRow>(sql`
      SELECT * FROM debate_suggestions WHERE id = ${id} AND member_id = ${memberId} AND decided_at IS NULL`)
    if (row === null) return yield* T.fail(NotFound({ message: 'That suggestion is no longer waiting.' }))
    return row
  })

const announceSuggestions = (memberId: MemberId): T.Task<void, never, RequestEnv> =>
  T.map((env: RequestEnv) => {
    env.outbox.push({
      memberId,
      event: { seq: 0, at: env.clock.now(), body: { type: 'suggestions.changed' } },
    })
  })(T.ask<RequestEnv>())

const waitingRows = (memberId: MemberId): T.Task<ReadonlyArray<SuggestionRow>, never, RequestEnv> =>
  all<SuggestionRow>(sql`
    SELECT s.*, c.name AS agent_name, n.author_id AS asker_id FROM debate_suggestions s
    LEFT JOIN credentials c ON c.id = s.credential_id LEFT JOIN notes n ON n.id = s.in_reply_to
    WHERE s.member_id = ${memberId} AND s.decided_at IS NULL ORDER BY s.created_at, s.id`)

interface SuggestionRow {
  readonly id: SuggestionId
  readonly credential_id: CredentialId
  readonly in_reply_to: NoteId
  readonly conversation_id: ConversationId
  readonly draft_id: NoteId | null
  readonly question: string
  readonly reason: string
  readonly created_at: number
  readonly agent_name?: string | null
  readonly asker_id?: MemberId | null
}
