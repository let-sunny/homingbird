/**
 * How a reader tells debate turns apart from their words alone: a turn that only says the flock is ready,
 * a turn in which its agent says it changed position, and the turn numbers a text cites, as agents cite
 * them in English or Korean. A citation of one turn is linked whole; in a list, each number is.
 */
export const citedTurns = (text: string, lastPosition: number): ReadonlyArray<CitedPart> =>
  joinedText(
    text.split(CITATION).flatMap((piece, index): ReadonlyArray<CitedPart> => {
      if (index % 2 === 0) return [{ kind: 'text', text: piece }]
      const numbers = piece.match(/\d+/g)!.map(Number)
      const isTurn = (position: number) => position >= 1 && position <= lastPosition
      if (numbers.length === 1)
        return isTurn(numbers[0]!)
          ? [{ kind: 'turn', text: piece, position: numbers[0]! }]
          : [{ kind: 'text', text: piece }]
      return piece
        .split(/(\d+)/)
        .map((part, at) =>
          at % 2 === 1 && isTurn(Number(part))
            ? { kind: 'turn', text: part, position: Number(part) }
            : { kind: 'text', text: part },
        )
    }),
  )

/** A turn that adds nothing: short, and saying so, as agents do while they wait for the flock to close. */
export const isFillerTurn = (body: string): boolean =>
  body.trim().length <= FILLER_MAX_CHARACTERS && FILLER.some((pattern) => pattern.test(body))

/** A turn in which its agent says, in so many words, that it moved from where it stood. */
export const changesPosition = (body: string): boolean =>
  POSITION_CHANGE.some((pattern) => pattern.test(body))

/**
 * Where an agent changed position, as its own turns say: the first turn after its opening in which it says
 * so, and its turn just before. An opening turn changes nothing: the agent had read no one yet.
 */
export const positionMoveOf = <Turn extends TurnLike>(
  turns: ReadonlyArray<Turn>,
  memberId: string,
): { readonly from: Turn; readonly to: Turn } | null => {
  const own = turns.filter((turn) => turn.memberId === memberId)
  const at = own.findIndex((turn, index) => index > 0 && changesPosition(turn.body))
  return at === -1 ? null : { from: own[at - 1]!, to: own[at]! }
}

export interface TurnLike {
  readonly memberId: string
  readonly body: string
}

export type CitedPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'turn'; readonly text: string; readonly position: number }

/** "turn 4", "turns 4, 6 and 9", "Turns 3-5", "턴 4", "차례 4", "4번째 턴", "2, 5번 차례". */
const CITATION =
  /(\b[Tt]urns?\s+\d{1,3}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|to)\s+|\s*[&–-]\s*)\d{1,3})*\b|(?:턴|차례)\s*\d{1,3}|\d{1,3}(?:\s*,\s*\d{1,3})*\s*번(?:째)?\s*(?:턴|차례))/u

const FILLER_MAX_CHARACTERS = 320

const FILLER: ReadonlyArray<RegExp> = [
  /\bnothing (?:new|more|further) to add\b/i,
  /\bnothing new\b/i,
  /\bno new (?:information|facts?|points?|arguments?)\b/i,
  /\bnothing (?:further|else) from me\b/i,
  /\bready to (?:vote|draft|close)\b/i,
  /새로운 (?:내용|정보|것)(?:은|이)? 없/u,
  /덧붙일 (?:내용|것)(?:은|이)? 없/u,
  /추가할 (?:내용|것)(?:은|이)? 없/u,
]

const POSITION_CHANGE: ReadonlyArray<RegExp> = [
  /\b(?:moved|changed|changes|shifted) my (?:view|position|mind|recommendation)\b/i,
  /\b(?:this|that|it|turn \d+) (?:moved|moves|changed|changes) me\b/i,
  /\bI (?:now|no longer) (?:agree|support|back|think|recommend|hold|prefer)\b/i,
  /\bI (?:drop|withdraw|retract|give up|abandon) (?:my|the)\b/i,
  /\bI was wrong\b/i,
  /\brevis(?:e|ing) my (?:view|position|recommendation)\b/i,
  /(?:입장|생각|의견)을 (?:바꾸|바꿨|바꿉|수정하)/u,
  /철회(?:합|했|할)/u,
]

/** Neighbouring words joined into one, and empty ones dropped. */
const joinedText = (parts: ReadonlyArray<CitedPart>): ReadonlyArray<CitedPart> =>
  parts
    .filter((part) => part.text !== '')
    .reduce<ReadonlyArray<CitedPart>>((joined, part) => {
      const last = joined[joined.length - 1]
      return last?.kind === 'text' && part.kind === 'text'
        ? joined.slice(0, -1).concat({ kind: 'text', text: last.text + part.text })
        : joined.concat(part)
    }, [])
