import { eventStream } from '@homingbird/client'
import { Stream, Task as T } from '@homingbird/kernel'
import {
  type AgentReply,
  type AsRead,
  type Authors,
  type DraftReply,
  type DraftRequest,
  type DraftRequestId,
  UNREADABLE_NOTE,
  agentLabelOf,
  describedForWriter,
  extractionIn,
  isWakingEvent,
  quotedNote,
  readerPrompt,
  replyProblem,
  runnerBasisOf,
  runnerExtractedNotePrompt,
  runnerNotePrompt,
  runnerReplyIn,
  runnerRequestPrompt,
} from '@homingbird/protocol'
import { agentEnvironment } from '../agent-environment.ts'
import { isReaderWithSomeTools } from '../agent-presets.ts'
import { countUsage, presetLabel } from '../analytics.ts'
import { answeringFlowFor } from '../answering-flow.ts'
import { type DebateDesk, answerDebates } from '../debate-runner.ts'
import {
  DESK_CLAIM_RETRY_MS,
  DESK_HEARTBEAT_MS,
  claimDesk,
  deskClaimPath,
  releaseDeskClaim,
  renewDeskClaim,
} from '../desk-claim.ts'
import { PAUSE_CHECK_MS, deskPausePath, isDeskPaused } from '../desk-pause.ts'
import type { AgentRun, CliEnv } from '../environment.ts'
import { CliFailure, EXIT, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { missingPresetCommand } from '../program-paths.ts'
import { type Session, calling, openSession, requireReadable } from '../session.ts'
import { authorsOf } from './reading.ts'
import { REQUESTS_OFF_TEXT, originalOf } from './requests.ts'

export const run = (
  settings: RunnerSettings,
  report: (step: Outcome) => void,
): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const missing = yield* missingCommandOf(settings)
    if (missing !== null) return yield* T.fail(failed(missing))
    const session = yield* openSession
    yield* runDesk(session, { ...settings, countsUsage: true }, report)
  })

/** Says which preset command is not on this PATH, before any note waits on it; null when all are. */
export const missingCommandOf = (settings: RunnerSettings): T.Task<string | null, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const commands = [settings.agent, ...(settings.split === null ? [] : [settings.split.reader])]
    const missing = yield* missingPresetCommand(commands, env.variables.PATH)
    if (missing === null) return null
    return `The ${missing === settings.agent ? 'agent' : 'reader'} command ${notFound(missing)}.`
  })

export interface RunnerSettings {
  readonly agent: string
  readonly timeoutSeconds: number
  /** Split mode: a reader turns each note into a few checked fields, and the agent drafts from those. */
  readonly split: SplitMode | null
  /** Run by the background service: the log it writes never holds a reason an agent gave, which can quote a note. */
  readonly isService?: boolean
  /** `homingbird run` counts that a desk started, when the server asks for anonymous usage counts. */
  readonly countsUsage?: boolean
}

export interface SplitMode {
  readonly reader: string
  readonly requireToollessReader: boolean
}

/** What a desk runner needs from its host: `homingbird run`, or `homingbird-mcp --run-agent`. */
export type DeskEnv = Pick<
  CliEnv,
  'clock' | 'fetch' | 'files' | 'output' | 'variables' | 'homeDirectory' | 'nonce' | 'stopped' | 'launcher'
> &
  Partial<Pick<CliEnv, 'credentialsFile'>>

/**
 * Answers the member's waiting notes and draft requests with the agent command, then each one that
 * arrives, until interrupted. It first claims the member's desk on this computer and waits while
 * another runner holds it.
 */
export const runDesk = (
  session: Session,
  settings: RunnerSettings,
  report: (step: Outcome) => void,
): T.Task<void, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const { agent, timeoutSeconds, split } = settings
    if (split !== null && split.reader === agent) {
      if (split.requireToollessReader)
        return yield* T.fail(CliFailure({ message: SAME_READER_REFUSED, exitCode: EXIT.usage }))
      yield* warn(SAME_READER_WARNING)
    } else if (split !== null && isReaderWithSomeTools(split.reader)) {
      if (split.requireToollessReader)
        return yield* T.fail(CliFailure({ message: MINIMAL_READER_REFUSED, exitCode: EXIT.usage }))
      yield* warn(MINIMAL_READER_WARNING)
    }
    yield* requireReadable(session.api)
    const { member } = yield* calling(session.api['me.get']({}))
    if (settings.countsUsage === true)
      yield* countUsage(session.api, 'desk_started', { agentPreset: presetLabel(agent) })
    const claim = deskClaimPath(env, session.credential.serverUrl, member.id)
    const holder = env.nonce()
    yield* waitForDesk(claim, holder, member, report)
    yield* T.ensuring(releaseDeskClaim(claim, holder))(
      T.race([
        answering({
          session,
          member,
          agent,
          split,
          isService: settings.isService === true,
          pause: deskPausePath(env, session.credential.serverUrl, member.id),
          timeoutMs: timeoutSeconds * 1000,
          report,
          tried: new Set(),
          triedDebates: new Set(),
          told: new Set(),
        }),
        keptUntilLost(claim, holder),
      ]),
    )
  })

const answering = (runner: Runner): T.Task<void, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const { session, member, agent } = runner
    const { cursor } = yield* calling(session.api['events.poll']({ query: {} }))
    runner.report(
      outcome(
        { step: 'online', member: { id: member.id, name: member.name, email: member.email }, agent },
        `Answering notes and draft requests for ${member.name} with: ${agent}\nEvery draft waits for approval in the web client.${runner.isService ? '' : ' Press Ctrl-C to stop.'}`,
      ),
    )
    const stopping = new AbortController()
    const events = eventStream(
      {
        serverUrl: session.credential.serverUrl,
        fetch: env.fetch,
        token: () => session.credential.token,
        clock: env.clock,
        after: cursor,
        onUnreadable: env.output.problem,
        resyncOnConnect: true,
      },
      AbortSignal.any([stopping.signal, env.stopped]),
    )
    yield* T.ensuring(T.sync(() => stopping.abort()))(
      Stream.forEach((event: AsRead.StreamEvent) =>
        isWakingEvent(event.body, member.id) ? answerWaitingOrStop(runner) : T.unit,
      )(events),
    )
  })

/** Only a failure stops the desk; a defect in one round leaves it listening, as the next event retries. */
const answerWaitingOrStop = (runner: Runner): T.Task<void, CliFailure, DeskEnv> =>
  T.flatMap((exit: T.Exit<void, CliFailure>) =>
    exit._tag === 'Err' && exit.error._tag === 'Fail' ? T.fail(exit.error.error) : T.unit,
  )(T.exit(answerWaiting(runner)))

const waitForDesk = (
  claim: string,
  holder: string,
  member: AsRead.Member,
  report: (step: Outcome) => void,
): T.Task<void, never, DeskEnv> =>
  T.gen(function* () {
    let told = false
    while (!(yield* claimDesk(claim, holder))) {
      if (!told)
        report(
          outcome(
            { step: 'waiting', member: { id: member.id, name: member.name, email: member.email } },
            `Another desk on this computer is answering for ${member.name}. This one waits and takes over when that one stops.`,
          ),
        )
      told = true
      yield* T.sleep(DESK_CLAIM_RETRY_MS)
    }
  })

const keptUntilLost = (claim: string, holder: string): T.Task<never, CliFailure, DeskEnv> =>
  T.gen(function* () {
    for (;;) {
      yield* T.sleep(DESK_HEARTBEAT_MS)
      if (!(yield* renewDeskClaim(claim, holder)))
        return yield* T.fail(failed('Another desk on this computer took over; this one stopped answering.'))
    }
  })

export const SAME_READER_WARNING =
  'Split mode: the reader is the same command as the agent, so it has the same tools. Give --reader a command that runs the agent without tools; see the guide.'

export const MINIMAL_READER_WARNING =
  'Split mode: this preset reader runs with minimal tools, not none: the agent offers no way to turn every tool off.'

export const MINIMAL_READER_REFUSED =
  'Split mode with --require-toolless-reader: this preset reader runs with minimal tools, not none. Give --reader a command that runs without tools.'

export const SAME_READER_REFUSED =
  'Split mode with --require-toolless-reader needs a --reader command different from --agent, one that runs without tools.'

interface Runner {
  readonly session: Session
  readonly member: AsRead.Member
  readonly agent: string
  readonly split: SplitMode | null
  readonly isService: boolean
  readonly pause: string
  readonly timeoutMs: number
  readonly report: (step: Outcome) => void
  readonly tried: Set<DraftRequestId>
  readonly triedDebates: Set<string>
  /** Notices said once per run, such as draft requests being switched off. */
  readonly told: Set<string>
}

const STOPPING: ReadonlyArray<number> = [EXIT.signedOut]

const answerWaiting = (runner: Runner): T.Task<void, CliFailure, DeskEnv> =>
  T.gen(function* () {
    for (;;) {
      yield* untilResumed(runner)
      const looked = yield* T.result(answerEach(runner))
      if (looked._tag === 'Err') {
        if (STOPPING.includes(looked.error.exitCode)) return yield* T.fail(looked.error)
        return yield* warn(`Could not look for work just now: ${looked.error.message}`)
      }
      if (looked.value === 'answered') return
    }
  })

/** Answers what waits, one by one, until done or until the desk is paused before the next one. */
const answerEach = (runner: Runner): T.Task<'answered' | 'paused', CliFailure, DeskEnv> =>
  T.gen(function* () {
    const { items } = yield* calling(runner.session.api['inbox.list']({ query: { fresh: '1' } }))
    for (const item of items) {
      if (yield* isDeskPaused(runner.pause)) return 'paused'
      yield* answerNote(runner, item)
    }
    const requests = yield* waitingRequests(runner)
    for (const request of requests.filter((each) => !runner.tried.has(each.id))) {
      if (yield* isDeskPaused(runner.pause)) return 'paused'
      runner.tried.add(request.id)
      yield* answerRequest(runner, request)
    }
    if (yield* isDeskPaused(runner.pause)) return 'paused'
    yield* answerDebates(debateDeskOf(runner))
    return 'answered'
  })

/** The draft requests waiting for this desk; none, said once, while the organization has them switched off. */
const waitingRequests = (runner: Runner): T.Task<ReadonlyArray<DraftRequest>, CliFailure> =>
  T.gen(function* () {
    const listed = yield* T.result(runner.session.api['draftRequests.list']({}))
    if (listed._tag === 'Ok') return listed.value.requests
    if (listed.error._tag !== 'NotFound') return yield* calling(T.fail(listed.error))
    if (!runner.told.has(REQUESTS_OFF)) {
      runner.told.add(REQUESTS_OFF)
      runner.report(outcome({ step: REQUESTS_OFF }, REQUESTS_OFF_TEXT))
    }
    return []
  })

const REQUESTS_OFF = 'draft-requests-off'

const debateDeskOf = (runner: Runner): DebateDesk<DeskEnv> => ({
  session: runner.session,
  member: runner.member,
  isSplit: runner.split !== null,
  tried: runner.triedDebates,
  told: runner.told,
  report: runner.report,
  run: (role, prompt, what) =>
    outputOf(runner, role === 'agent' ? runner.agent : runner.split!.reader, role, prompt, what),
  warn,
})

const untilResumed = (runner: Runner): T.Task<void, never, DeskEnv> =>
  T.gen(function* () {
    if (!(yield* isDeskPaused(runner.pause))) return
    runner.report(
      outcome(
        { step: 'paused' },
        'Paused: arriving notes wait until `homingbird desk resume` on this computer.',
      ),
    )
    while (yield* isDeskPaused(runner.pause)) yield* T.sleep(PAUSE_CHECK_MS)
    runner.report(outcome({ step: 'resumed' }, 'Resumed: answering the notes that waited.'))
  })

const answerNote = (runner: Runner, item: AsRead.InboxItem): T.Task<void, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const { note, author } = item
    yield* calling(runner.session.api['notes.pickup']({ params: { id: note.id } }))
    const authors = new Map([[author.id, author]])
    const flow = yield* answeringFlowFor(runner.session.api, note.conversationId)
    const what = `the note ${note.id}`
    const extracted = runner.split === null ? null : yield* extractedFrom(runner, note, authors, what)
    if (runner.split !== null && extracted === null) {
      yield* calling(
        runner.session.api['notes.release']({ params: { id: note.id }, body: { reason: UNREADABLE_NOTE } }),
      )
      return runner.report(skipped(note.id, UNREADABLE_NOTE))
    }
    const prompt =
      extracted === null
        ? runnerNotePrompt(runner.member, flow, quotedNote(note, { authors, nonce: env.nonce }))
        : runnerExtractedNotePrompt(runner.member, flow, extracted)
    const reply = yield* draftedBy(runner, prompt, what)
    if (reply === null) return
    if (reply.kind === 'skip') {
      yield* calling(
        runner.session.api['notes.release']({
          params: { id: note.id },
          body: reply.reason === '' ? {} : { reason: reply.reason },
        }),
      )
      return runner.report(skipped(note.id, runner.isService ? '' : reply.reason))
    }
    const draft = yield* calling(
      runner.session.api['drafts.create']({
        body: {
          body: reply.body,
          inReplyTo: note.id,
          ...runnerBasisOf(reply, runner.split !== null),
          ...labelsOf(runner, reply),
        },
      }),
    )
    runner.report(drafted(draft, { inReplyTo: note.id }, `in reply to ${note.id}`))
  })

const answerRequest = (runner: Runner, request: DraftRequest): T.Task<void, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const authors = request.inReplyTo === null ? new Map() : yield* authorsOf(runner.session)
    const original =
      runner.split === null
        ? yield* originalOf(runner.session, request, authors)
        : yield* extractedOriginalOf(runner, request, authors)
    if (original === UNREADABLE)
      return yield* warn(
        `The note the draft request ${request.id} answers could not be read safely; nothing was drafted.`,
      )
    const prompt = runnerRequestPrompt(
      runner.member,
      yield* answeringFlowFor(runner.session.api, request.conversationId),
      request.instruction,
      original,
      runner.split !== null,
    )
    const reply = yield* draftedBy(runner, prompt, `the draft request ${request.id}`)
    if (reply === null) return
    if (reply.kind === 'skip')
      return yield* warn(
        `The agent did not draft for the draft request ${request.id}${runner.isService ? '.' : `: ${reply.reason}`}`,
      )
    const draft = yield* calling(
      runner.session.api['drafts.create']({
        body: {
          body: reply.body,
          requestId: request.id,
          ...runnerBasisOf(reply, runner.split !== null),
          ...labelsOf(runner, reply),
        },
      }),
    )
    runner.report(drafted(draft, { requestId: request.id }, `for the draft request ${request.id}`))
  })

/** The program that wrote a runner's drafts: the agent command's first word, through `homingbird run`. */
export const runnerClient = (agent: string): string =>
  agentLabelOf(`${programOf(agent.trim().split(/\s+/))} via homingbird run`) ?? 'homingbird run'

/** The program an agent command starts, past launchers and variable settings such as `env`, `npx` or `A=1`. */
const programOf = (words: ReadonlyArray<string>): string => {
  const [first = '', second = '', ...rest] = words
  if (first === 'pnpm' && second === 'dlx') return programOf(withoutOptions(rest))
  if (LAUNCHERS.has(first)) return programOf(withoutOptions([second, ...rest]))
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) return programOf([second, ...rest])
  return first.split('/').at(-1) || 'agent'
}

const withoutOptions = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const start = words.findIndex((word) => !word.startsWith('-'))
  return start === -1 ? [] : words.slice(start)
}

const LAUNCHERS = new Set(['env', 'npx', 'bunx'])

const draftedBy = (
  runner: Runner,
  prompt: string,
  what: string,
): T.Task<AgentReply | null, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const output = yield* outputOf(runner, runner.agent, 'agent', prompt, what)
    if (output === null) return null
    const reply = runnerReplyIn(output)
    const problem = replyProblem(reply)
    if (problem === null) return reply
    return yield* T.as(null)(warn(`The agent command ${problem}; nothing was drafted for ${what}.`))
  })

/** The reader's checked description of a note, wrapped like the note itself would be; null when it gave none. */
const extractedFrom = (
  runner: Runner,
  note: AsRead.Note,
  authors: Authors,
  what: string,
): T.Task<string | null, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const prompt = readerPrompt(quotedNote(note, { authors, nonce: env.nonce }))
    const output = yield* outputOf(runner, runner.split!.reader, 'reader', prompt, what)
    const extracted = output === null ? null : extractionIn(output)
    if (extracted === null) {
      if (output !== null)
        yield* warn(`The reader command did not describe ${what} in the expected form; nothing was drafted.`)
      return null
    }
    return quotedNote({ ...note, body: describedForWriter(extracted) }, { authors, nonce: env.nonce })
  })

const UNREADABLE = Symbol('unreadable')

const extractedOriginalOf = (
  runner: Runner,
  request: DraftRequest,
  authors: Authors,
): T.Task<string | null | typeof UNREADABLE, CliFailure, DeskEnv> =>
  T.gen(function* () {
    if (request.inReplyTo === null) return null
    const note = yield* T.result(runner.session.api['notes.get']({ params: { id: request.inReplyTo } }))
    if (note._tag === 'Err') return `(The note ${request.inReplyTo} could not be loaded.)`
    return (yield* extractedFrom(runner, note.value, authors, `the note ${note.value.id}`)) ?? UNREADABLE
  })

const outputOf = (
  runner: Runner,
  command: string,
  role: 'agent' | 'reader',
  prompt: string,
  what: string,
): T.Task<string | null, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const environment = agentEnvironment(env.variables, [
      runner.session.credential.token,
      env.credentialsFile ?? '',
    ])
    const finished = yield* T.result(
      T.timeout(runner.timeoutMs)(
        T.tryPromise(
          (signal: AbortSignal) => env.launcher.runAgent(command, prompt, environment, signal),
          (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
        ),
      ),
    )
    const reason =
      finished._tag === 'Ok'
        ? exitProblem(finished.value, command)
        : finished.error._tag === 'TimeoutError'
          ? `did not finish within ${runner.timeoutMs / 1000} seconds`
          : `could not be started (${finished.error.message})`
    if (reason === null && finished._tag === 'Ok') return finished.value.output
    return yield* T.as(null)(warn(`The ${role} command ${reason}; nothing was drafted for ${what}.`))
  })

const exitProblem = (finished: AgentRun, command: string): string | null => {
  if (finished.exitCode === 0) return null
  if (finished.exitCode === SHELL_COMMAND_NOT_FOUND) return notFound(command)
  return `exited with code ${finished.exitCode ?? 'unknown'}`
}

/** What the shell answers when the command's program is not on the PATH, as POSIX specifies. */
const SHELL_COMMAND_NOT_FOUND = 127

const notFound = (command: string): string => {
  const program = command.trim().split(/\s+/)[0] ?? command
  return `could not be found: "${program}" is not on the PATH this runs with; give its absolute path, such as /usr/local/bin/${program.replace(/^.*\//, '')}, or set PATH`
}

const labelsOf = (runner: Runner, reply: DraftReply) => ({
  client: runnerClient(runner.agent),
  ...(reply.model != null && { model: reply.model }),
})

const skipped = (noteId: string, reason: string): Outcome =>
  outcome(
    { step: 'skipped', noteId, reason },
    `Gave ${noteId} back without a draft.${reason === '' ? '' : ` Your person sees why: ${reason}`}`,
  )

const warn = (message: string): T.Task<void, never, DeskEnv> =>
  T.flatMap((env: DeskEnv) => T.sync(() => env.output.problem(message)))(T.ask<DeskEnv>())

const drafted = (draft: AsRead.Note, answering: Readonly<Record<string, string>>, what: string): Outcome =>
  outcome(
    { step: 'drafted', draftId: draft.id, conversationId: draft.conversationId, ...answering },
    `Drafted ${draft.id} ${what}. It has not been sent: it waits for approval.`,
  )
