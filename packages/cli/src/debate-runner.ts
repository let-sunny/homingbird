import { type HasClock, type Result, Task as T } from '@homingbird/kernel'
import {
  type ApiError,
  type AsRead,
  type Authors,
  type CalendarOutcome,
  ballotReaderPrompt,
  calendarReportIn,
  debateExtractionIn,
  debateReaderPrompt,
  debateResultIn,
  debateResultPrompt,
  debateTurnPrompt,
  debateTurnRetryPrompt,
  debateVotePrompt,
  extractedRoom,
  freeSlotsIn,
  freeSlotsPrompt,
  isScheduled,
  isStaleTurnRefusal,
  meetingPrompt,
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
 * writes, or votes, from that description alone. A scheduling room wakes the agent too, to read its
 * person's calendar with its own tool and to send, accept, decline or cancel the meeting there; an agent
 * that cannot leaves it to its person, as a desk without a calendar does.
 */
export const answerDebates = <R extends DeskServices>(desk: DebateDesk<R>): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const { asks, ballots, meetings } = yield* waitingAsks(desk)
    if (asks.length + ballots.length + meetings.length === 0) return
    const authors = yield* authorsOf(desk.session)
    for (const ask of asks) {
      const attempt = `${ask.debate.id}:${ask.ask}:${ask.debate.turns.length}:${ask.debate.resultRound}`
      if (desk.tried.has(attempt)) continue
      desk.tried.add(attempt)
      if (ask.ask === 'turn') yield* takeTurn(desk, ask.debate, authors)
      else if (ask.ask === 'result') yield* draftResult(desk, ask.debate, authors)
      else if (ask.ask === 'slots') yield* shareFreeSlots(desk, ask.debate, authors)
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
    for (const meeting of meetings) {
      const attempt = `${meeting.debate.id}:${meeting.ask}`
      if (desk.tried.has(attempt)) continue
      desk.tried.add(attempt)
      yield* useCalendar(desk, meeting, authors)
    }
  })

export interface DebateDesk<R> {
  readonly session: Session
  readonly member: AsRead.Member
  readonly isSplit: boolean
  /** The IANA time zone of this computer, where the person's working hours are. */
  readonly timeZone: string
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

type DeskServices = HasClock & { readonly nonce: () => string }

const DEBATES_OFF = 'debates-off'

const unknownAskText = (debateId: string): string =>
  `Skipped debate room ${debateId}: it asks for something this command line does not know. Upgrade the command line to answer it.`

interface Waiting {
  readonly asks: ReadonlyArray<AsRead.DebateAsk>
  readonly ballots: ReadonlyArray<AsRead.Debate>
  readonly meetings: ReadonlyArray<AsRead.MeetingAsk>
}

const waitingAsks = <R>(desk: DebateDesk<R>): T.Task<Waiting, CliFailure> =>
  T.gen(function* () {
    const listed = yield* T.result(desk.session.api['debates.waiting']({}))
    if (listed._tag === 'Ok')
      return {
        asks: listed.value.asks,
        ballots: listed.value.ballots ?? [],
        meetings: listed.value.meetings ?? [],
      }
    if (listed.error._tag !== 'NotFound') return yield* calling(T.fail(listed.error))
    if (!desk.told.has(DEBATES_OFF)) {
      desk.told.add(DEBATES_OFF)
      desk.report(outcome({ step: DEBATES_OFF }, DEBATES_OFF_TEXT))
    }
    return { asks: [], ballots: [], meetings: [] }
  })

const takeTurn = <R extends DeskServices>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const what = `the debate room ${debate.id}`
    const room = yield* roomFor(desk, debate, authors, what)
    if (room === null) return
    const first = yield* writeAndPostTurn(desk, debate, debateTurnPrompt(room), what)
    const posted =
      first?._tag === 'Err' && isStaleTurnRefusal(first.error)
        ? yield* retryTurn(desk, debate, authors, what)
        : first
    if (posted === null) return
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

/**
 * The agent reads its person's calendar with its own tool and prints their free times, which the desk
 * shares; when it cannot, or prints anything else, the person is asked to choose their times themself.
 */
const shareFreeSlots = <R extends DeskServices>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const env = yield* T.ask<R>()
    if (!isScheduled(debate)) return yield* declineCalendar(desk, debate)
    const what = `the scheduling room ${debate.id}`
    const prompt = freeSlotsPrompt({
      debate,
      viewerId: desk.member.id,
      authors,
      timeZone: desk.timeZone,
      now: env.clock.now(),
      nonce: env.nonce,
    })
    const output = yield* desk.run('agent', prompt, what)
    const answer = output === null ? null : freeSlotsIn(output, debate.schedule.window)
    if (answer === null || 'cannotReadCalendar' in answer) {
      if (output !== null && answer === null)
        yield* desk.warn(`The agent command did not print free times in the expected form for ${what}.`)
      return yield* declineCalendar(desk, debate)
    }
    const posted = yield* T.result(
      desk.session.api['debates.slots.post']({ params: { id: debate.id }, body: { slots: answer.slots } }),
    )
    if (posted._tag === 'Err')
      return yield* desk.warn(`The free times for ${what} were refused: ${posted.error.message}`)
    desk.report(
      outcome(
        { step: 'debate-slots', debateId: debate.id, shared: answer.slots.length },
        `Shared ${answer.slots.length} free time(s) from your calendar in ${what}. Only free and busy times leave this computer; the others see only the time the room finds.`,
      ),
    )
  })

/**
 * The agent does what the settled meeting asks in its person's calendar and prints what it did, which the
 * desk reports; when it cannot, or prints anything else, the desk reports failed and the person does it.
 */
const useCalendar = <R extends DeskServices>(
  desk: DebateDesk<R>,
  meeting: AsRead.MeetingAsk,
  authors: Authors,
): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const env = yield* T.ask<R>()
    const { debate, ask } = meeting
    if (ask === 'unknown')
      return desk.report(outcome({ step: 'debate-skipped', debateId: debate.id }, unknownAskText(debate.id)))
    const what = `the meeting of the scheduling room ${debate.id}`
    const prompt = meetingPrompt({ meeting, authors, timeZone: desk.timeZone, nonce: env.nonce })
    const output = yield* desk.run('agent', prompt, what)
    const report = output === null ? null : calendarReportIn(output, ask)
    if (report === null || report.outcome === 'failed') {
      if (output !== null && report === null)
        yield* desk.warn(`The agent command did not print what it did in the expected form for ${what}.`)
      return yield* reportNoCalendar(desk, meeting)
    }
    const reported = yield* T.result(
      desk.session.api['debates.calendar.report']({ params: { id: debate.id }, body: report }),
    )
    if (reported._tag === 'Err')
      return yield* desk.warn(`The report on ${what} was refused: ${reported.error.message}`)
    desk.report(
      outcome(
        { step: 'debate-meeting', debateId: debate.id, ask, outcome: report.outcome },
        `${CALENDAR_DONE[report.outcome]} for ${what}.`,
      ),
    )
  })

/** The agent cannot read a calendar: the desk says so, and the person is asked to choose their times. */
const declineCalendar = <R>(desk: DebateDesk<R>, debate: AsRead.Debate): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const what = `the scheduling room ${debate.id}`
    const posted = yield* T.result(
      desk.session.api['debates.slots.post']({
        params: { id: debate.id },
        body: { slots: [], cannotReadCalendar: true },
      }),
    )
    if (posted._tag === 'Err')
      return yield* desk.warn(
        `Saying the calendar cannot be read in ${what} was refused: ${posted.error.message}`,
      )
    desk.report(
      outcome(
        { step: 'debate-slots', debateId: debate.id },
        `Your agent could not read a calendar, so ${what} asks your person to choose their free times in the web client.`,
      ),
    )
  })

/**
 * The agent could not use a calendar, so the desk reports `failed`: the server then leaves adding to the
 * person, and counts a person it could not take out as out and tells them to remove the meeting by hand.
 */
const reportNoCalendar = <R>(desk: DebateDesk<R>, meeting: AsRead.MeetingAsk): T.Task<void, CliFailure, R> =>
  T.gen(function* () {
    const { debate, ask } = meeting
    const what = `the scheduling room ${debate.id}`
    const reported = yield* T.result(
      desk.session.api['debates.calendar.report']({ params: { id: debate.id }, body: { outcome: 'failed' } }),
    )
    if (reported._tag === 'Err')
      return yield* desk.warn(
        `Saying the calendar cannot be used in ${what} was refused: ${reported.error.message}`,
      )
    desk.report(
      outcome(
        { step: 'debate-meeting', debateId: debate.id, ask },
        `Your agent could not use a calendar, so ${what} asks your person to ${ask === 'send_invite' || ask === 'accept_invite' ? 'put the meeting in their calendar' : 'take the meeting out of their calendar'} by hand.`,
      ),
    )
  })

type Posted = Result.Result<AsRead.Debate, ApiError>

/**
 * Asks the agent for its turn and posts it after the last turn it was shown, so a turn written while
 * others spoke is refused rather than saved blind; null when the agent gave no turn to post.
 */
const writeAndPostTurn = <R extends DeskServices>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  prompt: string,
  what: string,
): T.Task<Posted | null, CliFailure, R> =>
  T.gen(function* () {
    const output = yield* desk.run('agent', prompt, what)
    if (output === null) return null
    const { answer: body, model, ready } = statedTurnIn(output)
    if (/^SKIP:/i.test(body)) {
      yield* desk.warn(`The agent took no turn in ${what}.`)
      return null
    }
    if (body === '' || body.length > debate.limits.turnCharacters) {
      yield* desk.warn(
        `The agent command printed ${body === '' ? 'nothing' : 'more than a turn in this room holds'}; no turn was taken in ${what}.`,
      )
      return null
    }
    return yield* T.result(
      desk.session.api['debates.turns.post']({
        params: { id: debate.id },
        body: { body, afterTurn: debate.turns.length, ...modelOf(model), ...(ready && { ready }) },
      }),
    )
  })

/** Once, after a stale refusal: the room again with the turns the agent missed, and its turn rewritten. */
const retryTurn = <R extends DeskServices>(
  desk: DebateDesk<R>,
  debate: AsRead.Debate,
  authors: Authors,
  what: string,
): T.Task<Posted | null, CliFailure, R> =>
  T.gen(function* () {
    const moved = yield* calling(desk.session.api['debates.get']({ params: { id: debate.id } }))
    const room = yield* roomFor(desk, moved, authors, what)
    if (room === null) return null
    const prompt = debateTurnRetryPrompt(room, debate.turns.length, moved.turns.length)
    return yield* writeAndPostTurn(desk, moved, prompt, what)
  })

const draftResult = <R extends DeskServices>(
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

const vote = <R extends DeskServices>(
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
const roomFor = <R extends DeskServices>(
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

const CALENDAR_DONE: Readonly<Record<Exclude<CalendarOutcome, 'failed'>, string>> = {
  sent: 'Sent the invitation from your calendar',
  accepted: 'Accepted the invitation in your calendar',
  conflict: 'Did not accept the invitation, as your calendar is busy then; you are asked on a card',
  declined: 'Declined the invitation in your calendar',
  cancelled: 'Cancelled the invitation in your calendar',
}
