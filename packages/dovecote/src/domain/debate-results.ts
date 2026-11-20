import { Task as T } from '@homingbird/kernel'
import {
  Conflict,
  type ConversationId,
  type Debate,
  type DebateExport,
  type DebateExportFormat,
  type DebateId,
  type DebateVote,
  type DraftedResult,
  Forbidden,
  Invalid,
  type Locale,
  type MemberId,
  NOTE_BODY_MAX,
  type NotFound,
  type Note,
  debateFilename,
  debateJson,
  debateMarkdown,
  debateResultText,
  exportLabelsIn,
  resultOfDraft,
} from '@homingbird/protocol'
import { type Caller, isHuman, viewerOf } from '../environment.ts'
import type { RequestEnv } from '../events/events.ts'
import { describeDebate, lockedDebate, participantByAgent, visibleDebate } from './debate-rows.ts'
import { moveDebate } from './debate-settling.ts'
import { type NoteFailure, createDraft } from './drafts.ts'
import { chosenLocaleOf, membersByIds } from './members.ts'

/** Saves an agent's draft for this round; after `RESULT_DRAFTING_WINDOW_MS` the others vote. */
export const draftResult = (
  caller: Caller,
  id: DebateId,
  drafted: DraftedResult,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    yield* visibleDebate(viewerOf(caller), id)
    const participant = isHuman(caller) ? null : yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(Forbidden({ message: 'Only an agent opted in for this room drafts its result.' }))
    const { result, model } = resultOfDraft(drafted)
    yield* moveDebate(
      yield* lockedDebate(id),
      { type: 'draft', memberId: participant.member_id, result },
      { credentialId: caller.credential.id, agentName: participant.agent_name, model: model ?? undefined },
    )
    return yield* describeDebate(yield* lockedDebate(id))
  })

/** An agent taking part votes for another's draft; the winner closes the room. */
export const voteForDraft = (
  caller: Caller,
  id: DebateId,
  vote: DebateVote,
): T.Task<Debate, NotFound | Forbidden | Conflict | Invalid, RequestEnv> =>
  T.gen(function* () {
    yield* visibleDebate(viewerOf(caller), id)
    const participant = isHuman(caller) ? null : yield* participantByAgent(id, caller.credential.id)
    if (participant === null)
      return yield* T.fail(
        Forbidden({ message: 'Only an agent opted in for this room votes on its drafts.' }),
      )
    yield* moveDebate(
      yield* lockedDebate(id),
      { type: 'vote', memberId: participant.member_id, vote },
      { credentialId: caller.credential.id, agentName: participant.agent_name, model: vote.model },
    )
    return yield* describeDebate(yield* lockedDebate(id))
  })

export interface ResultDestination {
  readonly conversationId?: ConversationId
  readonly to?: MemberId
  readonly channel?: string
}

/**
 * Puts the settled result, and nothing else from the room, into a draft of the person's own in a channel
 * or a conversation; it leaves when they send it there, as every note does.
 */
export const postResult = (
  caller: Caller,
  id: DebateId,
  destination: ResultDestination,
): T.Task<Note, NoteFailure, RequestEnv> =>
  T.gen(function* () {
    const debate = yield* closedDebate(caller, id)
    if (!debate.turns.some((turn) => turn.memberId === caller.member.id))
      return yield* T.fail(Forbidden({ message: 'Only a person whose agent took a turn posts the result.' }))
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

/**
 * The whole closed room, transcript and result, for a member to keep; the export itself is audited. A
 * private room is exported to its members only: an administrator may read it, not take it out.
 */
export const exportDebate = (
  caller: Caller,
  id: DebateId,
  format: DebateExportFormat,
  language?: Locale,
): T.Task<DebateExport, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    const debate = yield* closedDebate(caller, id)
    if (debate.visibility === 'private' && !debate.memberIds.includes(caller.member.id))
      return yield* T.fail(Forbidden({ message: 'Only the members of a private room can export it.' }))
    const nameOf = yield* namesFor(debate)
    const labels = exportLabelsIn(language ?? (yield* chosenLocaleOf(caller.member.id)))
    return format === 'markdown'
      ? {
          filename: debateFilename(debate, 'md'),
          mediaType: 'text/markdown',
          text: debateMarkdown(debate, nameOf, labels),
        }
      : {
          filename: debateFilename(debate, 'json'),
          mediaType: 'application/json',
          text: debateJson(debate, nameOf),
        }
  })

const closedDebate = (
  caller: Caller,
  id: DebateId,
): T.Task<Debate, NotFound | Forbidden | Conflict, RequestEnv> =>
  T.gen(function* () {
    if (!isHuman(caller)) return yield* T.fail(Forbidden({ message: 'Only a person can do this.' }))
    const debate = yield* describeDebate(yield* visibleDebate(viewerOf(caller), id))
    if (debate.status !== 'closed' || debate.result === null)
      return yield* T.fail(Conflict({ message: 'Only a closed room’s settled result leaves the room.' }))
    return debate
  })

const namesFor = (debate: Debate): T.Task<(id: MemberId) => string, never, RequestEnv> =>
  T.map(
    (members: ReadonlyMap<MemberId, { readonly name: string }>) => (id: MemberId) =>
      members.get(id)?.name ?? 'A former member',
  )(membersByIds([debate.createdBy, ...debate.memberIds, ...debate.participants.map((one) => one.memberId)]))
