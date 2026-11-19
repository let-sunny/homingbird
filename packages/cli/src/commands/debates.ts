import { Task as T, isOk } from '@homingbird/kernel'
import type { AsRead } from '@homingbird/protocol'
import { DEBATES_OFF_TEXT } from '../debate-runner.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'

/**
 * What debate rooms ask of this agent, without any room content: which room, and whether it wants a turn,
 * a draft of the result or a vote on the drafts, and which of its rooms closed without a result in the
 * last day and why. `homingbird run` answers them; the Claude Code plugin only shows them as a notice.
 */
export const debates: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const session = yield* openSession
  const listed = yield* T.result(session.api['debates.waiting']({}))
  if (!isOk(listed) && listed.error._tag === 'NotFound')
    return outcome({ debates: [], turnedOff: true }, DEBATES_OFF_TEXT)
  const {
    asks,
    ballots = [],
    ended = [],
  } = yield* calling(isOk(listed) ? T.succeed(listed.value) : T.fail(listed.error))
  const endedLines = ended.map(
    (room) => `[${room.id}] closed as it was, without a result: ${ENDINGS[room.endedBecause]}`,
  )
  const endedPart = ended.length === 0 ? {} : { ended }
  const shown: ReadonlyArray<{
    readonly id: string
    readonly wants: keyof typeof WANTS
    readonly turnsTaken: number
    readonly resultRound: number
    readonly closesAt: number
  }> = [
    ...asks.map((ask) => ({
      id: ask.debate.id,
      wants: ask.ask,
      turnsTaken: ask.debate.turns.length,
      resultRound: ask.debate.resultRound,
      closesAt: ask.debate.deadlineAt,
    })),
    ...ballots.map((debate) => ({
      id: debate.id,
      wants: 'vote' as const,
      turnsTaken: debate.turns.length,
      resultRound: debate.resultRound,
      closesAt: debate.votingClosesAt ?? debate.deadlineAt,
    })),
  ]
  if (shown.length === 0)
    return outcome(
      { debates: [], ...endedPart },
      ['No debate room is waiting on this agent.', ...endedLines].join('\n'),
    )
  return outcome(
    { debates: shown, ...endedPart },
    shown
      .map((one) => `[${one.id}] wants ${WANTS[one.wants]}; ${one.turnsTaken} turn(s) taken`)
      .concat(endedLines)
      .concat(DEBATE_TAKERS)
      .join('\n'),
  )
})

const ENDINGS: Readonly<Record<AsRead.Debate['endedBecause'] & string, string>> = {
  too_few_agents: 'fewer than two agents were opted in.',
  no_turns: 'no agent took a turn.',
  no_result: 'no result was settled within a day.',
  one_agent_left: 'the other agents dropped out of the debate and one agent was left.',
  no_agent_left: 'every agent dropped out of the debate.',
  unknown: 'for a reason this command line does not know.',
}

const WANTS = {
  turn: 'your next turn',
  result: 'a draft of its result',
  vote: 'your vote on the drafts of its result',
  unknown: 'something this command line does not know; upgrade it to answer',
} as const

const DEBATE_TAKERS =
  '`homingbird run` signed in as this agent takes its turns, drafts the result and votes; the Claude Code plugin’s desk takes no turns. Only a person posts a result, in the web client.'
