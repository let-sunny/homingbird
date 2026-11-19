import { Task as T, isOk } from '@homingbird/kernel'
import { DEBATES_OFF_TEXT } from '../debate-runner.ts'
import type { CliEnv } from '../environment.ts'
import type { CliFailure } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { calling, openSession } from '../session.ts'

/**
 * What debate rooms ask of this agent, without any room content: which room, and whether it wants a turn
 * or the result. `homingbird run` answers them; the mod shows them as a notice.
 */
export const debates: T.Task<Outcome, CliFailure, CliEnv> = T.gen(function* () {
  const session = yield* openSession
  const listed = yield* T.result(session.api['debates.waiting']({}))
  if (!isOk(listed) && listed.error._tag === 'NotFound')
    return outcome({ debates: [], turnedOff: true }, DEBATES_OFF_TEXT)
  const { asks } = yield* calling(isOk(listed) ? T.succeed(listed.value) : T.fail(listed.error))
  const shown = asks.map((ask) => ({
    id: ask.debate.id,
    wants: ask.ask,
    turnsTaken: ask.debate.turns.length,
    resultRound: ask.debate.resultRound,
    closesAt: ask.debate.deadlineAt,
  }))
  if (shown.length === 0) return outcome({ debates: [] }, 'No debate room is waiting on this agent.')
  return outcome(
    { debates: shown },
    shown
      .map(
        (one) =>
          `[${one.id}] wants ${one.wants === 'turn' ? 'your next turn' : 'its result'}; ${one.turnsTaken} turn(s) taken`,
      )
      .concat('`homingbird run` answers debate rooms; the people approve the result in the web client.')
      .join('\n'),
  )
})
