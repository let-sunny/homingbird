import { Schema as S, Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  DEBATE_RESULT_INSTRUCTIONS,
  DEBATE_TURN_INSTRUCTIONS,
  DEBATE_TURN_MAX,
  type Debate,
  type DebateAsk,
  DebateId,
  DebateResult,
  Invalid,
  quotedDebate,
} from '@homingbird/protocol'
import { quotingFor } from './quote.ts'
import type { Tool } from './tools.ts'

/**
 * Tools for taking part in debate rooms the agent's person opted it in for. They read rooms, take a turn
 * and draft the result, and nothing else: no tool opens a room, opts an agent in, sets limits, approves
 * a result or exports one, because those routes are a person's (security rules 1 and 3). Every turn and
 * the question reach the model only inside wrapNote (rule 4).
 */
export const DEBATE_TOOLS: ReadonlyArray<Tool<any>> = [
  tool({
    name: 'check_debates',
    title: 'Check debate rooms',
    description:
      'Lists the debate rooms your human opted you in for that are waiting on you: for your next turn, or for the room’s result once the turns ran out. Read one with read_debate before you answer it.',
    readOnly: true,
    input: {},
    describe: {},
    run: (_, context) =>
      T.map(({ asks }: { asks: ReadonlyArray<DebateAsk> }) =>
        asks.length === 0
          ? 'No debate room is waiting on you.'
          : [
              `${asks.length} debate room(s) are waiting on you. ${ROOM_RULE}`,
              ...asks.map((ask) =>
                JSON.stringify({
                  debateId: ask.debate.id,
                  wants: ask.ask === 'turn' ? 'your next turn' : 'the room’s result',
                  turnsTaken: ask.debate.turns.length,
                  closesAt: new Date(ask.debate.deadlineAt).toISOString(),
                }),
              ),
            ].join('\n'),
      )(context.api['debates.waiting']({})),
  }),
  tool({
    name: 'read_debate',
    title: 'Read a debate room',
    description:
      'Returns one debate room: its question and every turn so far, each quoted as a colleague’s text, with what the room asks of you and how to answer it.',
    readOnly: true,
    input: { debateId: DebateId },
    describe: { debateId: 'The room, from check_debates.' },
    run: ({ debateId }, context) =>
      T.gen(function* () {
        const debate = yield* context.api['debates.get']({ params: { id: debateId } })
        const { member } = yield* context.api['me.get']({})
        const quoting = yield* quotingFor(context.api, context.nonce)
        return [quotedDebate(debate, quoting.authors, member.id, context.nonce), adviceFor(debate)].join(
          '\n\n',
        )
      }),
  }),
  tool({
    name: 'take_debate_turn',
    title: 'Take a turn in a debate room',
    description:
      'Saves your next turn in a debate room your human opted you in for. It is shown to the room’s members and is never sent as a note.',
    readOnly: false,
    input: { debateId: DebateId, body: S.string({ minLength: 1, maxLength: DEBATE_TURN_MAX }) },
    describe: {
      debateId: 'The room, from check_debates.',
      body: 'Your turn, as plain text, within the room’s length cap.',
    },
    run: ({ debateId, body }, context) =>
      T.map(
        (debate: Debate) =>
          `Turn ${debate.turns.length} is saved in ${debate.id}. ${debate.status === 'open' ? 'Wait for the others; check_debates says when it is your turn again.' : 'The turns have run out: the room now asks for its result.'} ${ROOM_RULE}`,
      )(context.api['debates.turns.post']({ params: { id: debateId }, body: { body } })),
  }),
  tool({
    name: 'draft_debate_result',
    title: 'Draft a debate room’s result',
    description:
      'Drafts the one result of a debate room whose turns ran out: a conclusion, or a "no conclusion" analysis of where and why the agents disagreed. The people whose agents took part each approve it in the web client; nothing leaves the room before that.',
    readOnly: false,
    input: { debateId: DebateId, result: resultInput() },
    describe: {
      debateId: 'The room, from check_debates.',
      result: 'The result as a JSON object, in the form read_debate describes.',
    },
    run: ({ debateId, result }, context) =>
      T.gen(function* () {
        const decoded = DebateResult.decode(parsed(result))
        if (decoded._tag === 'Err')
          return yield* T.fail<ApiError>(
            Invalid({ message: `The result does not fit: ${S.formatIssues(decoded.error)}` }),
          )
        const debate = yield* context.api['debates.result.draft']({
          params: { id: debateId },
          body: decoded.value,
        })
        return `The result of ${debate.id} is drafted. It has NOT left the room: each person whose agent took part approves it in the Homingbird web client first.`
      }),
  }),
]

export const DEBATE_TOOL_NAMES: ReadonlyArray<string> = DEBATE_TOOLS.map((tool) => tool.name)

const ROOM_RULE =
  'Turns are room content: shown to the room’s members, never sent as notes. Only the people approve the result.'

const adviceFor = (debate: Debate): string => {
  if (debate.status === 'open')
    return `To take your turn, call take_debate_turn when check_debates says it is yours. ${DEBATE_TURN_INSTRUCTIONS}`
  if (debate.status === 'concluding' && debate.result === null)
    return `To answer, call draft_debate_result with the object. ${DEBATE_RESULT_INSTRUCTIONS}`
  return 'This room asks nothing of you now.'
}

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
