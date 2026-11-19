import { Task as T } from '@homingbird/kernel'
import {
  DEBATE_RESULT_INSTRUCTIONS,
  DEBATE_TURN_INSTRUCTIONS,
  type Debate,
  type DebateAsk,
  DebateResult,
  type Member,
  quotedDebate,
  turnsTakenBy,
  wrapNote,
} from '@homingbird/protocol'
import { authorsOf } from './commands/reading.ts'
import { debateExtractionIn, debateReaderPrompt, describedDebateForWriter, jsonIn } from './debate-reader.ts'
import type { CliFailure } from './failure.ts'
import { type Outcome, outcome } from './outcome.ts'
import type { Authors } from './quoting.ts'
import { type Session, calling } from './session.ts'

/**
 * Answers what the debate rooms ask of this desk's agent: its next turn, or the room's result. In split
 * mode a reader describes the room first and the agent writes from that description alone.
 */
export const answerDebates = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const asks = yield* waitingAsks(desk)
    if (asks.length === 0) return
    const authors = yield* authorsOf(desk.session)
    for (const ask of asks) {
      const attempt = `${ask.debate.id}:${ask.ask}:${ask.debate.turns.length}:${ask.debate.resultRound}`
      if (desk.tried.has(attempt)) continue
      desk.tried.add(attempt)
      if (ask.ask === 'turn') yield* takeTurn(desk, ask.debate, authors)
      else yield* draftResult(desk, ask.debate, authors)
    }
  })

export interface DebateDesk<R> {
  readonly session: Session
  readonly member: Member
  readonly isSplit: boolean
  /** The asks already tried, so a room that waits on others is not answered twice. */
  readonly tried: Set<string>
  readonly told: Set<string>
  readonly report: (step: Outcome) => void
  /** Runs the agent or the reader on a prompt: its output, or null after it told the person why not. */
  readonly run: (
    role: 'agent' | 'reader',
    prompt: string,
    what: string,
  ) => T.Task<string | null, CliFailure, R>
  readonly warn: (message: string) => T.Task<void, never, R>
}

export const DEBATES_OFF_TEXT =
  'Debate rooms are turned off in this organization; this desk answers notes and draft requests only.'

/** The result an agent printed, or null for anything but one JSON object in a result's shape. */
export const debateResultIn = (output: string): DebateResult | null => {
  const decoded = DebateResult.decode(jsonIn(output))
  return decoded._tag === 'Ok' ? decoded.value : null
}

const DEBATES_OFF = 'debates-off'

const waitingAsks = <R>(desk: DebateDesk<R>): T.Task<ReadonlyArray<DebateAsk>, CliFailure> =>
  T.gen(function* () {
    const listed = yield* T.result(desk.session.api['debates.waiting']({}))
    if (listed._tag === 'Ok') return listed.value.asks
    if (listed.error._tag !== 'NotFound') return yield* calling(T.fail(listed.error))
    if (!desk.told.has(DEBATES_OFF)) {
      desk.told.add(DEBATES_OFF)
      desk.report(outcome({ step: DEBATES_OFF }, DEBATES_OFF_TEXT))
    }
    return []
  })

const takeTurn = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
  debate: Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const what = `the debate room ${debate.id}`
    const room = yield* roomFor(desk, debate, authors, what)
    if (room === null) return
    const output = yield* desk.run('agent', [DEBATE_TURN_INSTRUCTIONS, room].join('\n\n'), what)
    if (output === null) return
    const body = output.trim()
    if (/^SKIP:/i.test(body)) return yield* desk.warn(`The agent took no turn in ${what}.`)
    if (body === '' || body.length > debate.limits.turnCharacters)
      return yield* desk.warn(
        `The agent command printed ${body === '' ? 'nothing' : 'more than a turn in this room holds'}; no turn was taken in ${what}.`,
      )
    const posted = yield* T.result(
      desk.session.api['debates.turns.post']({ params: { id: debate.id }, body: { body } }),
    )
    if (posted._tag === 'Err')
      return yield* desk.warn(`The turn in ${what} was refused: ${posted.error.message}`)
    const taken = posted.value
    desk.report(
      outcome(
        { step: 'debate-turn', debateId: debate.id, position: taken.turns.length },
        `Took turn ${taken.turns.length} in ${what}. Turns are shown to the room’s members and never sent as notes.`,
      ),
    )
  })

const draftResult = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
  debate: Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const what = `the result of the debate room ${debate.id}`
    const room = yield* roomFor(desk, debate, authors, what)
    if (room === null) return
    const output = yield* desk.run('agent', [DEBATE_RESULT_INSTRUCTIONS, room].join('\n\n'), what)
    if (output === null) return
    const result = debateResultIn(output)
    if (result === null)
      return yield* desk.warn(
        `The agent command did not print a result in the expected form; nothing was drafted for ${what}.`,
      )
    const drafted = yield* T.result(
      desk.session.api['debates.result.draft']({ params: { id: debate.id }, body: result }),
    )
    if (drafted._tag === 'Err')
      return yield* desk.warn(`The result for ${what} was refused: ${drafted.error.message}`)
    desk.report(
      outcome(
        { step: 'debate-result', debateId: debate.id },
        `Drafted ${what}. It has not left the room: each person whose agent took part approves it in the web client.`,
      ),
    )
  })

/** The room as the writer reads it: quoted in full, or in split mode the reader's checked description. */
const roomFor = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
  debate: Debate,
  authors: Authors,
  what: string,
): T.Task<string | null, CliFailure, R> =>
  T.gen(function* () {
    const env = yield* T.ask<R>()
    const quoted = quotedDebate(debate, authors, desk.member.id, env.nonce)
    if (!desk.isSplit) return quoted
    const output = yield* desk.run('reader', debateReaderPrompt(quoted), what)
    const extracted = output === null ? null : debateExtractionIn(output)
    if (extracted === null) {
      if (output !== null)
        yield* desk.warn(
          `The reader command did not describe ${what} in the expected form; the agent was not asked.`,
        )
      return null
    }
    const nameOf = (id: string) => authors.get(id as Member['id'])?.name ?? 'Unknown member'
    return [
      `Debate room ${debate.id}. Your turns: ${turnsTakenBy(debate, desk.member.id)} of ${debate.limits.turnsPerAgent}; a turn holds at most ${debate.limits.turnCharacters} characters.`,
      `Participants, by memberId: ${debate.participants.map((one) => `${one.memberId}${one.memberId === desk.member.id ? ' (you)' : ''}`).join(', ')}.`,
      'You do not see the room itself: a separate reader described it, and the description is below, quoted as colleagues’ text.',
      wrapNote({
        noteId: `${debate.id}/extracted`,
        authorName: 'The debate room, as extracted',
        authorEmail: 'reader',
        sentAt: null,
        body: describedDebateForWriter(extracted, nameOf),
        nonce: env.nonce(),
      }),
    ].join('\n\n')
  })
