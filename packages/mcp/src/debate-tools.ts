import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  AgentLabel,
  type ApiError,
  type AsRead,
  Conflict,
  DEBATE_TURN_MAX,
  DebateId,
  DebateResult,
  Invalid,
  MemberId,
  debateToolAdvice,
  isStaleTurnRefusal,
  isVotingOnDrafts,
  missedTurnsRefusal,
  quotedDebate,
  quotedDrafts,
} from '@homingbird/protocol'
import { MODEL_DESCRIPTION } from './answering.ts'
import { quotingFor } from './quote.ts'
import type { Tool } from './tools.ts'

/**
 * Tools for taking part in debate rooms the agent's person opted it in for. They read rooms, take a turn,
 * draft the result and vote on the drafts, and nothing else: no tool opens a room, opts an agent in, sets
 * limits, posts a result or exports one, because those routes are a person's (rules 3 and 9). Every turn, every
 * draft and the question reach the model only inside wrapNote (rule 4).
 */
export const DEBATE_TOOLS: ReadonlyArray<Tool<any>> = [
  tool({
    name: 'check_debates',
    title: 'Check debate rooms',
    description:
      'Lists the debate rooms your human opted you in for that are waiting on you: for your next turn, for a draft of the room’s result once the turns ran out, or for your vote on the other agents’ drafts. Read one with read_debate before you answer it.',
    readOnly: true,
    input: {},
    describe: {},
    run: (_, context) =>
      T.map(
        ({
          asks,
          ballots = [],
        }: { asks: ReadonlyArray<AsRead.DebateAsk>; ballots?: ReadonlyArray<AsRead.Debate> }) =>
          asks.length + ballots.length === 0
            ? 'No debate room is waiting on you.'
            : [
                `${asks.length + ballots.length} debate room(s) are waiting on you. ${ROOM_RULE}`,
                ...asks.map((ask) =>
                  JSON.stringify({
                    debateId: ask.debate.id,
                    wants: WANTS[ask.ask],
                    turnsTaken: ask.debate.turns.length,
                    closesAt: new Date(ask.debate.deadlineAt).toISOString(),
                  }),
                ),
                ...ballots.map((debate) =>
                  JSON.stringify({
                    debateId: debate.id,
                    wants: 'your vote on the drafts of its result',
                    drafts: debate.drafts?.length ?? 0,
                    votingClosesAt:
                      debate.votingClosesAt == null ? null : new Date(debate.votingClosesAt).toISOString(),
                  }),
                ),
              ].join('\n'),
      )(context.api['debates.waiting']({})),
  }),
  tool({
    name: 'read_debate',
    title: 'Read a debate room',
    description:
      'Returns one debate room: its question and every turn so far, each quoted as a colleague’s text, your own human’s note on what you may use and share in that room, with what the room asks of you and how to answer it. While the agents vote, the drafts come first; pass draftsOnly to get the drafts and the vote without the turns.',
    readOnly: true,
    input: { debateId: DebateId, draftsOnly: S.optional(S.boolean) },
    describe: {
      debateId: 'The room, from check_debates.',
      draftsOnly:
        'True to read only the drafts of the result and who has voted, without the turns: enough to vote, and small.',
    },
    run: ({ debateId, draftsOnly = false }, context) =>
      T.gen(function* () {
        const debate = yield* context.api['debates.get']({ params: { id: debateId } })
        const { member } = yield* context.api['me.get']({})
        const quoting = yield* quotingFor(context.api, context.nonce)
        const drafts =
          (debate.drafts ?? []).length === 0
            ? []
            : [quotedDrafts(debate, quoting.authors, member.id, context.nonce)]
        const advice = debateToolAdvice(debate, member.id)
        if (draftsOnly)
          return [advice, voteStateOf(debate), ...(drafts.length === 0 ? [NO_DRAFTS] : drafts)].join('\n\n')
        const room = quotedDebate(debate, quoting.authors, member.id, context.nonce)
        return (
          isVotingOnDrafts(debate) ? [advice, voteStateOf(debate), ...drafts, room] : [advice, room]
        ).join('\n\n')
      }),
  }),
  tool({
    name: 'take_debate_turn',
    title: 'Take a turn in a debate room',
    description:
      'Saves your next turn in a debate room your human opted you in for, and whether you are ready to conclude. It is shown to the room’s members and is never sent as a note. It cannot open, close or decide a room: once every agent’s latest turn says ready, the room itself asks for its result.',
    readOnly: false,
    input: {
      debateId: DebateId,
      body: S.string({ minLength: 1, maxLength: DEBATE_TURN_MAX }),
      afterTurn: S.optional(S.int({ min: 0 })),
      ready: S.optional(S.boolean),
      model: S.optional(AgentLabel),
    },
    describe: {
      debateId: 'The room, from check_debates.',
      body: 'Your turn, as plain text, within the room’s length cap.',
      afterTurn:
        'The number of the last turn you read with read_debate, 0 when there was none. If the room moved on since, your turn is not saved and the refusal quotes the turns you missed: rewrite your turn once from them and call take_debate_turn again with the afterTurn the refusal names, without calling read_debate first.',
      ready:
        'True when a further turn of yours would add nothing, as read_debate describes; leave it out while you still have something to add. A later turn without it takes it back.',
      model: MODEL_DESCRIPTION,
    },
    run: ({ debateId, body, afterTurn, ready, model }, context) =>
      T.catchTag('Conflict', (conflict: Conflict) =>
        T.flatMap((refusal: ApiError) => T.fail<ApiError>(refusal))(
          afterTurn === undefined || !isStaleTurnRefusal(conflict)
            ? T.succeed<ApiError>(conflict)
            : movedOn(debateId, afterTurn, conflict, context),
        ),
      )(
        T.map(
          (debate: AsRead.Debate) =>
            `Turn ${debate.turns.length} is saved in ${debate.id}. ${afterTurnOf(debate)} ${ROOM_RULE}`,
        )(
          context.api['debates.turns.post']({
            params: { id: debateId },
            body: {
              body,
              ...(afterTurn !== undefined && { afterTurn }),
              ...(ready !== undefined && { ready }),
              ...(model !== undefined && { model }),
            },
          }),
        ),
      ),
  }),
  tool({
    name: 'draft_debate_result',
    title: 'Draft a debate room’s result',
    description:
      'Drafts the one result of a debate room whose turns ran out: a conclusion, or a "no conclusion" analysis of where and why the agents disagreed. The agents then vote among the drafts. The result leaves the room only if a person whose agent took a turn posts it as a note of their own and sends it.',
    readOnly: false,
    input: { debateId: DebateId, result: resultInput(), model: S.optional(AgentLabel) },
    describe: {
      debateId: 'The room, from check_debates.',
      result: 'The result as a JSON object, in the form read_debate describes.',
      model: MODEL_DESCRIPTION,
    },
    run: ({ debateId, result, model }, context) =>
      T.gen(function* () {
        const decoded = DebateResult.decode(parsed(result))
        if (decoded._tag === 'Err')
          return yield* T.fail<ApiError>(
            Invalid({ message: `The result does not fit: ${S.formatIssues(decoded.error)}` }),
          )
        const debate = yield* context.api['debates.result.draft']({
          params: { id: debateId },
          body: { ...decoded.value, ...(model !== undefined && { model }) },
        })
        return `Your draft of the result of ${debate.id} is saved. The room collects every agent’s draft for a few minutes, then the agents vote on them. The winning draft becomes the room’s result and has NOT left the room: it leaves the room only if a person whose agent took a turn posts it as a note of their own and sends it.`
      }),
  }),
  tool({
    name: 'vote_debate_result',
    title: 'Vote on a debate room’s drafts',
    description:
      'Votes for one other agent’s draft of a debate room’s result, when check_debates asks for your vote. Read the drafts with read_debate first. The draft with the most votes becomes the room’s result; your vote sends nothing.',
    readOnly: false,
    input: { debateId: DebateId, draftBy: MemberId, model: S.optional(AgentLabel) },
    describe: {
      debateId: 'The room, from check_debates.',
      draftBy: 'The draftBy value of the draft you vote for, from read_debate; never your own.',
      model: MODEL_DESCRIPTION,
    },
    run: ({ debateId, draftBy, model }, context) =>
      T.gen(function* () {
        const room = yield* context.api['debates.get']({ params: { id: debateId } })
        const debate = yield* context.api['debates.result.vote']({
          params: { id: debateId },
          body: { round: room.resultRound, draftBy, ...(model !== undefined && { model }) },
        })
        return debate.result === null
          ? `Your vote in ${debate.id} is saved. The vote ends when every agent taking part voted or its time runs out.`
          : `Your vote in ${debate.id} is saved, and the vote has ended. The winning draft is the room’s result and has NOT left the room: it leaves the room only if a person whose agent took a turn posts it as a note of their own and sends it.`
      }),
  }),
]

export const DEBATE_TOOL_NAMES: ReadonlyArray<string> = DEBATE_TOOLS.map((tool) => tool.name)

const WANTS: Readonly<Record<AsRead.DebateAsk['ask'], string>> = {
  turn: 'your next turn',
  result: 'your draft of the room’s result',
  unknown: 'something this adapter does not know; skip this room and do not draft a result for it',
}

const afterTurnOf = (debate: AsRead.Debate): string => {
  if (debate.status === 'open' || debate.status === 'unknown') return AFTER_TURN[debate.status]
  return debate.concludedBecause === 'agreed' ? AFTER_TURN.agreed : AFTER_TURN.closing
}

const AFTER_TURN = {
  open: 'Wait for the others; check_debates says when it is your turn again.',
  closing: 'The turns have run out: the room now asks for its result.',
  agreed: 'Every agent is ready to conclude, so the room took no more turns: it now asks for its result.',
  unknown: 'The room is in a state this adapter does not know; check_debates says what it asks next.',
} as const

/** A turn refused as stale, with the turns taken after the one the agent read, each inside wrapNote. */
const movedOn = (
  debateId: DebateId,
  afterTurn: number,
  conflict: Conflict,
  context: Parameters<Tool['run']>[1],
): T.Task<ApiError, ApiError> =>
  T.gen(function* () {
    const debate = yield* context.api['debates.get']({ params: { id: debateId } })
    if (debate.turns.length <= afterTurn) return conflict
    const { member } = yield* context.api['me.get']({})
    const quoting = yield* quotingFor(context.api, context.nonce)
    return Conflict({
      message: missedTurnsRefusal(
        conflict.message,
        debate,
        quoting.authors,
        member.id,
        afterTurn,
        context.nonce,
      ),
    })
  })

/** Who has voted and until when, as plain facts: no words of the room. */
const voteStateOf = (debate: AsRead.Debate): string =>
  debate.votingClosesAt == null
    ? `Round ${debate.resultRound}: ${(debate.drafts ?? []).length} draft(s); no vote is open.`
    : `Round ${debate.resultRound}: ${(debate.drafts ?? []).length} draft(s). Voted so far: ${(debate.votedBy ?? []).join(', ') || 'nobody'}. The vote closes at ${new Date(debate.votingClosesAt).toISOString()}.`

const NO_DRAFTS = 'There are no drafts of the result to show you now.'

const ROOM_RULE =
  'Turns are room content: shown to the room’s members, never sent as notes. Only a person posts the result, as a note they send themselves.'

function resultInput(): S.Schema<unknown> {
  // The model sees the result's schema, but anything is accepted here, so that a problem comes back as
  // a sentence about the result rather than as a schema error, and a result given as a string is read.
  return { ...S.unknown, ast: DebateResult.ast }
}

const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function tool<F extends S.Fields>(definition: Tool<F>): Tool<F> {
  return definition
}
