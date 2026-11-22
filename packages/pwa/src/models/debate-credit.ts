import { type AsRead, type MemberId, UNKNOWN, creditKindOf, creditTurnOf } from '@homingbird/protocol'
import { isFillerTurn, positionMoveOf } from '../debate-turns.ts'
import { formats, listOf, strings } from '../strings.ts'
import { excerpt } from '../thread.ts'
import {
  type CitedText,
  type Credit,
  type CreditBadge,
  type RoomPeople,
  creditShown,
  isShownAlone,
} from './debate-result.ts'

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
      const move = positionMoveIn(debate, memberId)
      return {
        memberId,
        name: memberId === viewerId ? strings.debates.mine.agent : nameOf(memberId),
        summary: contribution === undefined ? null : cite(contribution.summary),
        credits: (contribution?.credits ?? [])
          .filter((credit) => isShownAlone(credit) && !shared.includes(creditKindOf(credit)))
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

/**
 * Where an agent changed position: the turn its credit names, from its own turn before; without credits
 * that name turns, as its own turns say so in words.
 */
export const positionMoveIn = <Turn extends AsRead.Debate['turns'][number]>(
  debate: { readonly turns: ReadonlyArray<Turn>; readonly result: AsRead.Debate['result'] },
  memberId: MemberId,
): { readonly from: Turn; readonly to: Turn } | null => {
  const credited = creditedChanges(debate)
  if (credited === null) return positionMoveOf(debate.turns, memberId)
  const to = debate.turns.find((turn) => turn.memberId === memberId && credited.includes(turn.position))
  if (to === undefined) return null
  const from = debate.turns.filter((turn) => turn.memberId === memberId && turn.position < to.position).at(-1)
  return from === undefined ? null : { from, to }
}

/**
 * The turns a settled result credits with a change of position, or null when its credits name no turns
 * and the room can tell only from the words of the turns.
 */
export const creditedChanges = (debate: {
  readonly result: AsRead.Debate['result']
}): ReadonlyArray<number> | null => {
  const result = debate.result?.result ?? null
  if (result === null || result.kind === UNKNOWN) return null
  const credits = result.contributions.flatMap((contribution) => contribution.credits)
  if (credits.every((credit) => creditTurnOf(credit) === null)) return null
  return credits.flatMap((credit) => {
    const turn = creditTurnOf(credit)
    return turn !== null && creditKindOf(credit) === 'position_changed' ? [turn] : []
  })
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
  readonly credits: ReadonlyArray<CreditBadge>
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
): ReadonlyArray<Extract<Credit, string>> =>
  contributions.length < 2
    ? []
    : [...new Set(contributions[0]!.credits.filter(isShownAlone).map(creditKindOf))].filter((kind) =>
        contributions.every((one) => one.credits.some((credit) => creditKindOf(credit) === kind)),
      )

const EXCERPT_LENGTH = 160
