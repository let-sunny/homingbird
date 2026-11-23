import type { AsRead, MemberId } from '@homingbird/protocol'
import { changesPosition, isFillerTurn } from '../debate-turns.ts'
import { strings } from '../strings.ts'
import type { CitedText } from './debate-result.ts'
import type { AuthorModel } from './note-item.ts'
import { type TimeShown, timeShown } from './time.ts'

/**
 * Every turn of a flock, numbered, in order. A turn that adds nothing is shown quieter, and a run of them
 * is folded behind one line; the run holding a turn the person jumped to opens on it.
 */
export const turnListModel = (
  turns: ReadonlyArray<AsRead.Debate['turns'][number]>,
  input: TurnListInput,
): ReadonlyArray<TurnGroup> => {
  const shown = turns.map((turn, index): Turn => {
    const opening = turns.findIndex((other) => other.memberId === turn.memberId) === index
    const filler = isFillerTurn(turn.body)
    return {
      position: turn.position,
      label: strings.debates.turnLabel({ position: turn.position }),
      mine: turn.memberId === input.viewerId,
      author: input.agentOf(turn.agentName, turn.memberId),
      details: input.details(turn),
      time: timeShown(turn.at, input.now),
      body: input.cite(turn.body),
      filler: filler ? strings.debates.fillerMark : null,
      changedPosition: (
        input.changedPositions === null
          ? !opening && !filler && changesPosition(turn.body)
          : input.changedPositions.includes(turn.position)
      )
        ? strings.debates.changedPositionMark
        : null,
      focused: turn.position === input.focus,
    }
  })
  return runsOf(shown).flatMap(
    (run): ReadonlyArray<TurnGroup> =>
      run.length < QUIET_RUN || run[0]!.filler === null
        ? run.map((turn) => ({ kind: 'turn', turn }))
        : [
            {
              kind: 'quiet',
              label: strings.debates.quietTurns({
                count: run.length,
                first: run[0]!.position,
                last: run[run.length - 1]!.position,
              }),
              open: run.some((turn) => turn.focused),
              turns: run,
            },
          ],
  )
}

export interface TurnListInput {
  readonly viewerId: MemberId
  readonly now: number
  /** The turns the result credits with a change of position; null to tell from the turns' words. */
  readonly changedPositions: ReadonlyArray<number> | null
  /** The turn the person jumped to, or null. */
  readonly focus: number | null
  readonly agentOf: (agent: string, memberId: MemberId) => string
  readonly details: (turn: AsRead.Debate['turns'][number]) => AuthorModel
  readonly cite: (text: string) => CitedText
}

export type TurnGroup =
  | { readonly kind: 'turn'; readonly turn: Turn }
  | {
      readonly kind: 'quiet'
      readonly label: string
      readonly open: boolean
      readonly turns: ReadonlyArray<Turn>
    }

export interface Turn {
  readonly position: number
  readonly label: string
  readonly mine: boolean
  readonly author: string
  readonly details: AuthorModel
  readonly time: TimeShown
  readonly body: CitedText
  /** Set on a turn that adds nothing new, which is shown quieter. */
  readonly filler: string | null
  /** Set on a turn in which its agent says it changed position. */
  readonly changedPosition: string | null
  /** Whether this is the turn the person jumped to. */
  readonly focused: boolean
}

/** How many turns in a row that add nothing are folded behind one line instead of shown quieter. */
const QUIET_RUN = 2

/** Turns split where they change between adding something and adding nothing. */
const runsOf = (turns: ReadonlyArray<Turn>): ReadonlyArray<ReadonlyArray<Turn>> =>
  turns
    .flatMap((turn, index) =>
      index === 0 || (turns[index - 1]!.filler === null) !== (turn.filler === null) ? [index] : [],
    )
    .map((start, index, starts) => turns.slice(start, starts[index + 1]))
