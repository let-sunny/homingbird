import { Task as T } from '@homingbird/kernel'
import {
  type AsRead,
  type Authors,
  ballotReaderPrompt,
  debateExtractionIn,
  debateReaderPrompt,
  debateResultIn,
  debateResultPrompt,
  debateTurnPrompt,
  debateVotePrompt,
  extractedRoom,
  quotedDebate,
  quotedDrafts,
  statedModelIn,
  statedTurnIn,
  voteIn,
} from '@homingbird/protocol'
import { authorsOf } from './commands/reading.ts'
import type { CliFailure } from './failure.ts'
import { type Outcome, outcome } from './outcome.ts'
import { type Session, calling } from './session.ts'

/**
 * Answers what the debate rooms ask of this desk's agent: its next turn, its draft of the room's result,
 * or its vote on the other agents' drafts. In split mode a reader describes the room first and the agent
 * writes, or votes, from that description alone.
 */
export const answerDebates = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const { asks, ballots } = yield* waitingAsks(desk)
    if (asks.length + ballots.length === 0) return
    const authors = yield* authorsOf(desk.session)
    for (const ask of asks) {
      const attempt = `${ask.debate.id}:${ask.ask}:${ask.debate.turns.length}:${ask.debate.resultRound}`
      if (desk.tried.has(attempt)) continue
      desk.tried.add(attempt)
      if (ask.ask === 'turn') yield* takeTurn(desk, ask.debate, authors)
      else if (ask.ask === 'result') yield* draftResult(desk, ask.debate, authors)
      else
        desk.report(
          outcome({ step: 'debate-skipped', debateId: ask.debate.id }, unknownAskText(ask.debate.id)),
        )
    }
    for (const debate of ballots) {
      const attempt = `${debate.id}:vote:${debate.resultRound}`
      if (desk.tried.has(attempt)) continue
      desk.tried.add(attempt)
      yield* vote(desk, debate, authors)
    }
  })

export interface DebateDesk<R> {
  readonly session: Session
  readonly member: AsRead.Member
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

const DEBATES_OFF = 'debates-off'

const unknownAskText = (debateId: string): string =>
  `Skipped debate room ${debateId}: it asks for something this command line does not know. Upgrade the command line to answer it.`

interface Waiting {
  readonly asks: ReadonlyArray<AsRead.DebateAsk>
  readonly ballots: ReadonlyArray<AsRead.Debate>
}

const waitingAsks = <R>(desk: DebateDesk<R>): T.Task<Waiting, CliFailure> =>
  T.gen(function* () {
    const listed = yield* T.result(desk.session.api['debates.waiting']({}))
    if (listed._tag === 'Ok') return { asks: listed.value.asks, ballots: listed.value.ballots ?? [] }
    if (listed.error._tag !== 'NotFound') return yield* calling(T.fail(listed.error))
    if (!desk.told.has(DEBATES_OFF)) {
      desk.told.add(DEBATES_OFF)
      desk.report(outcome({ step: DEBATES_OFF }, DEBATES_OFF_TEXT))
    }
    return { asks: [], ballots: [] }
  })

const takeTurn = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const what = `the debate room ${debate.id}`
    const room = yield* roomFor(desk, debate, authors, what)
    if (room === null) return
    const output = yield* desk.run('agent', debateTurnPrompt(room), what)
    if (output === null) return
    const { answer: body, model, ready } = statedTurnIn(output)
    if (/^SKIP:/i.test(body)) return yield* desk.warn(`The agent took no turn in ${what}.`)
    if (body === '' || body.length > debate.limits.turnCharacters)
      return yield* desk.warn(
        `The agent command printed ${body === '' ? 'nothing' : 'more than a turn in this room holds'}; no turn was taken in ${what}.`,
      )
    const posted = yield* T.result(
      desk.session.api['debates.turns.post']({
        params: { id: debate.id },
        body: { body, ...modelOf(model), ...(ready && { ready }) },
      }),
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
  debate: AsRead.Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const what = `the result of the debate room ${debate.id}`
    const room = yield* roomFor(desk, debate, authors, what)
    if (room === null) return
    const output = yield* desk.run('agent', debateResultPrompt(room), what)
    if (output === null) return
    const { answer, model } = statedModelIn(output)
    const result = debateResultIn(answer)
    if (result === null)
      return yield* desk.warn(
        `The agent command did not print a result in the expected form; nothing was drafted for ${what}.`,
      )
    const drafted = yield* T.result(
      desk.session.api['debates.result.draft']({
        params: { id: debate.id },
        body: { ...result, ...modelOf(model) },
      }),
    )
    if (drafted._tag === 'Err')
      return yield* desk.warn(`The result for ${what} was refused: ${drafted.error.message}`)
    desk.report(
      outcome(
        { step: 'debate-result', debateId: debate.id },
        `Drafted ${what}. The agents vote on the drafts; the winner has not left the room: a person whose agent took a turn may post it as a note they send themselves.`,
      ),
    )
  })

const vote = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const env = yield* T.ask<R>()
    const what = `the vote on the drafts of the debate room ${debate.id}`
    const choices = (debate.drafts ?? [])
      .map((draft) => draft.draftedBy)
      .filter((id) => id !== desk.member.id)
    const drafts = quotedDrafts(debate, authors, desk.member.id, env.nonce)
    const room = yield* roomFor(desk, debate, authors, what, drafts)
    if (room === null) return
    const output = yield* desk.run('agent', debateVotePrompt(room, desk.isSplit ? null : drafts), what)
    if (output === null) return
    const { answer, model } = statedModelIn(output)
    const draftBy = voteIn(answer, choices)
    if (draftBy === null)
      return yield* desk.warn(
        `The agent command did not print one of the drafts it may vote for; no vote was cast in ${what}.`,
      )
    const cast = yield* T.result(
      desk.session.api['debates.result.vote']({
        params: { id: debate.id },
        body: { round: debate.resultRound, draftBy, ...modelOf(model) },
      }),
    )
    if (cast._tag === 'Err') return yield* desk.warn(`The vote in ${what} was refused: ${cast.error.message}`)
    desk.report(
      outcome(
        { step: 'debate-vote', debateId: debate.id, draftBy },
        `Voted in ${what}. The winning draft becomes the room’s result; only a person can post it, as a note they send themselves.`,
      ),
    )
  })

/** The model the agent stated, for a request body; nothing when it stated none. */
const modelOf = (model: string | null): { model?: string } => (model === null ? {} : { model })

/** The room as the writer reads it: quoted in full, or in split mode the reader's checked description. */
const roomFor = <R extends { readonly nonce: () => string }>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  authors: Authors,
  what: string,
  drafts: string | null = null,
): T.Task<string | null, CliFailure, R> =>
  T.gen(function* () {
    const env = yield* T.ask<R>()
    const quoted = quotedDebate(debate, authors, desk.member.id, env.nonce)
    if (!desk.isSplit) return quoted
    const prompt = drafts === null ? debateReaderPrompt(quoted) : ballotReaderPrompt(quoted, drafts)
    const output = yield* desk.run('reader', prompt, what)
    const extracted = output === null ? null : debateExtractionIn(output)
    if (extracted === null) {
      if (output !== null)
        yield* desk.warn(
          `The reader command did not describe ${what} in the expected form; the agent was not asked.`,
        )
      return null
    }
    return extractedRoom(debate, desk.member.id, extracted, authors, env.nonce)
  })
