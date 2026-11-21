import { type AsRead, type MemberId, UNKNOWN } from '@homingbird/protocol'
import { isFillerTurn, positionMoveOf } from '../debate-turns.ts'
import { formats, listOf, strings } from '../strings.ts'
import { excerpt } from '../thread.ts'
import { type CitedText, type Credit, type RoomPeople, creditShown, isShownAlone } from './debate-result.ts'

/**
 * What each agent brought to a settled result, told apart from the others: the turns it took, a credit
 * only where not every agent got it, a change of position only with the turns it moved between, and the
 * next steps of its that the result kept. A credit every agent got is said once, for the room.
 */
export const creditModel = (
  debate: Pick<AsRead.Debate, 'turns' | 'result'>,
  people: Required<RoomPeople>,
): CreditModel | null => {
  const result = debate.result?.result ?? null
  if (result === null || result.kind === UNKNOWN) return null
  const { nameOf, viewerId, cite } = people
  const contributed = result.contributions.map((contribution) => contribution.memberId)
  const proposersOnly = result.nextSteps
    .map((step) => step.proposedBy)
    .filter((memberId, index, all) => !contributed.includes(memberId) && all.indexOf(memberId) === index)
  const shared = sharedCredits(result.contributions)
  return {
    shared:
      shared.length === 0
        ? null
        : strings.debates.sharedCredits({
            credits: listOf(shared.map((credit) => creditShown(credit).text)),
          }),
    rows: [...contributed, ...proposersOnly].map((memberId) => {
      const contribution = result.contributions.find((one) => one.memberId === memberId)
      const own = debate.turns.filter((turn) => turn.memberId === memberId)
      const fillers = own.filter((turn) => isFillerTurn(turn.body)).length
      const move = positionMoveOf(debate.turns, memberId)
      return {
        memberId,
        name: memberId === viewerId ? strings.debates.mine.agent : nameOf(memberId),
        summary: contribution === undefined ? null : cite(contribution.summary),
        credits: (contribution?.credits ?? [])
          .filter((credit) => isShownAlone(credit) && !shared.includes(credit))
          .map(creditShown),
        turns: cite(
          own.length === 0
            ? strings.debates.noTurnTaken
            : strings.debates.turnsTook({
                count: own.length,
                positions: formats.names.format(own.map((turn) => String(turn.position))),
              }),
        ),
        filler: fillers === 0 ? null : strings.debates.fillerCount({ count: fillers }),
        positionChange:
          move === null
            ? null
            : {
                text: cite(
                  strings.debates.positionChange({ from: move.from.position, to: move.to.position }),
                ),
                from: turnQuoted(move.from),
                to: turnQuoted(move.to),
              },
        keptSteps: result.nextSteps
          .filter((step) => step.proposedBy === memberId)
          .map((step) => cite(step.step)),
      }
    }),
  }
}

export interface CreditModel {
  /** The credits every agent got, said once for the room instead of on every agent. */
  readonly shared: string | null
  readonly rows: ReadonlyArray<CreditRow>
}

/** One agent's part in a settled result. */
export interface CreditRow {
  readonly memberId: MemberId
  readonly name: string
  readonly summary: CitedText | null
  readonly credits: ReadonlyArray<{ readonly text: string; readonly hint: string }>
  /** Which turns it took, each a link. */
  readonly turns: CitedText
  /** How many of them added nothing new. */
  readonly filler: string | null
  readonly positionChange: {
    readonly text: CitedText
    readonly from: QuotedTurn
    readonly to: QuotedTurn
  } | null
  readonly keptSteps: ReadonlyArray<CitedText>
}

/** A turn named by its number, with the start of what it said. */
export interface QuotedTurn {
  readonly label: string
  readonly excerpt: string
}

export const turnQuoted = (turn: Pick<AsRead.Debate['turns'][number], 'position' | 'body'>): QuotedTurn => ({
  label: strings.debates.turnLabel({ position: turn.position }),
  excerpt: excerpt(turn.body, EXCERPT_LENGTH),
})

const sharedCredits = (
  contributions: ReadonlyArray<{ readonly credits: ReadonlyArray<Credit> }>,
): ReadonlyArray<Credit> =>
  contributions.length < 2
    ? []
    : contributions[0]!.credits.filter(
        (credit) => isShownAlone(credit) && contributions.every((one) => one.credits.includes(credit)),
      )

const EXCERPT_LENGTH = 160
