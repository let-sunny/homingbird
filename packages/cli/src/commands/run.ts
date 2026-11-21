import { eventStream } from '@homingbird/client'
import { Result, Stream, Task as T } from '@homingbird/kernel'
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
  isFeatureOffered,
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
import { type Unavailability, isUsageLimitNotice, unavailabilityIn } from '../agent-availability.ts'
import { agentEnvironment } from '../agent-environment.ts'
import { firstErrorLine, isManagedMcpRefusal } from '../agent-errors.ts'
import { agentSearchPath, withAgentInstallDirectories } from '../agent-install-directories.ts'
import {
  type Launch,
  type Launches,
  isAttachingMcp,
  launchesAsGiven,
  preparedLaunches,
} from '../agent-launch.ts'
import type { AttachedServer } from '../agent-presets.ts'
import { isReaderWithSomeTools } from '../agent-presets.ts'
import { countUsage, presetLabel } from '../analytics.ts'
import { answeringFlowFor } from '../answering-flow.ts'
import { antigravityInput, antigravityOutput } from '../antigravity.ts'
import { credentialPathFor } from '../credentials.ts'
import { type DebateDesk, answerDebates } from '../debate-runner.ts'
import {
  ANSWERS_AGAIN,
  type DeskAvailability,
  isNewlyUnavailable,
  isRetryDue,
  mayTryNow,
  unavailableAfterFailure,
  unavailableLine,
} from '../desk-availability.ts'
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
import { CLI_VERSION } from '../version.ts'
import { authorsOf } from './reading.ts'
import { REQUESTS_OFF_TEXT, originalOf } from './requests.ts'

export const run = (
  settings: RunnerSettings,
  report: (step: Outcome) => void,
): T.Task<void, CliFailure, CliEnv> =>
  withAgentDirectories(
    T.gen(function* () {
      const missing = yield* missingCommandOf(settings)
      if (missing !== null) return yield* T.fail(failed(missing))
      const session = yield* openSession
      const env = yield* T.ask<CliEnv>()
      const attached = isAttachingMcp(settings, env.platform) ? yield* attachedServer(session) : null
      const launches = yield* preparedLaunches(settings, attached)
      yield* runDesk(session, { ...settings, launches, countsUsage: true }, report)
    }),
  )

/**
 * The Homingbird MCP server for one agent run, started by the agent with the runner's own credential
 * file named in its environment, never the token: the `@homingbird/mcp` installed beside this command
 * line, run by the same Node, or else that release through npx.
 */
export const attachedServer = (session: Session): T.Task<AttachedServer, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const serverUrl = session.credential.serverUrl
    const environment = {
      HOMINGBIRD_CREDENTIALS_FILE: env.credentialsFile ?? credentialPathFor(env, serverUrl),
    }
    const installed = yield* installedMcpServer
    const npx = ['npx', '-y', `@homingbird/mcp@${CLI_VERSION}`, '--server', serverUrl]
    const [command, ...args] =
      installed !== null
        ? [...installed, '--server', serverUrl]
        : env.platform === 'win32'
          ? ['cmd', '/c', ...npx]
          : npx
    const unsafe = [command!, ...args, ...Object.values(environment)].find((value) => CMD_SPECIAL.test(value))
    if (env.platform === 'win32' && unsafe !== undefined)
      return yield* T.fail(
        failed(
          `--attach-mcp cannot pass ${unsafe} to cmd.exe on Windows, which reads % & ^ | < > in it. Use a server address and credentials file path without them.`,
        ),
      )
    return { command: command!, args, environment }
  })

/** The MCP adapter's bundle where npm installs it next to this command line's own package. */
const installedMcpServer: T.Task<string[] | null, never, CliEnv> = T.gen(function* () {
  const env = yield* T.ask<CliEnv>()
  const [node, script] = env.program
  if (node === undefined || script === undefined) return null
  const bundle = script.replace(/[\\/]cli[\\/]dist[\\/][^\\/]+$/, (found) =>
    found.replace(/cli([\\/])dist\1[^\\/]+$/, 'mcp$1dist$1homingbird-mcp.mjs'),
  )
  if (bundle === script || !(yield* env.files.exists(bundle))) return null
  return [node, bundle]
})

const CMD_SPECIAL = /[%&^|<>]/

/** Runs a runner with the agents' Windows install directories on its PATH; elsewhere as it is. */
export const withAgentDirectories = <A, E>(task: T.Task<A, E, CliEnv>): T.Task<A, E, CliEnv> =>
  T.flatMap((env: CliEnv) =>
    T.provide({ variables: withAgentInstallDirectories(env.variables, env.platform) })(task),
  )(T.ask<CliEnv>())

/** Says which preset command is not on this PATH, before any note waits on it; null when all are. */
export const missingCommandOf = (settings: RunnerSettings): T.Task<string | null, never, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const commands = [settings.agent, ...(settings.split === null ? [] : [settings.split.reader])]
    const missing = yield* missingPresetCommand(commands, agentSearchPath(env.variables, env.platform))
    if (missing === null) return null
    return `The ${missing === settings.agent ? 'agent' : 'reader'} command ${notFound(missing, env.platform)}.`
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
  /** The commands as prepared from their presets; without them, the agent and reader run as given. */
  readonly launches?: Launches
  /** Give the agent command, never the reader, the Homingbird MCP server for its run. */
  readonly attachMcp?: boolean
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
  Partial<Pick<CliEnv, 'credentialsFile' | 'platform'>>

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
    const info = yield* T.result(session.api['server.info']({}))
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
          launches: settings.launches ?? launchesAsGiven(settings, env.platform ?? 'linux'),
          credentialsFile: env.credentialsFile ?? '',
          platform: env.platform ?? 'linux',
          isService: settings.isService === true,
          pause: deskPausePath(env, session.credential.serverUrl, member.id),
          timeoutMs: timeoutSeconds * 1000,
          report,
          tried: new Set(),
          triedDebates: new Set(),
          told: new Set(),
          failuresInRow: 0,
          availability: null,
          reportsAvailability: info._tag === 'Ok' && isFeatureOffered(info.value, 'deskAvailability'),
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
    const ticks = Stream.interval(env.clock, RETRY_CHECK_MS, AbortSignal.any([stopping.signal, env.stopped]))
    yield* T.ensuring(T.sync(() => stopping.abort()))(
      Stream.forEach((event: AsRead.StreamEvent | number) =>
        typeof event === 'number'
          ? retriedWhenDue(runner)
          : isWakingEvent(event.body, member.id)
            ? T.flatMap(() => answerWaitingOrStop(runner))(
                event.body.type === 'resync' ? reported(runner) : T.unit,
              )
            : T.unit,
      )(Stream.merge<AsRead.StreamEvent | number>(events, ticks)),
    )
  })

/**
 * At the time the agent said it could answer again, the desk tries the waiting notes once. With none
 * waiting it takes the agent at its word, so colleagues are not told it cannot answer past that time.
 */
const retriedWhenDue = (runner: Runner): T.Task<void, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const before = runner.availability
    if (!isRetryDue(before, env.clock.now())) return
    yield* answerWaitingOrStop(runner)
    if (runner.availability !== null && runner.availability === before) yield* answersAgain(runner)
  })

const RETRY_CHECK_MS = 60_000

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
  launches: Launches
  readonly credentialsFile: string
  readonly platform: string
  readonly isService: boolean
  readonly pause: string
  readonly timeoutMs: number
  readonly report: (step: Outcome) => void
  readonly tried: Set<DraftRequestId>
  readonly triedDebates: Set<string>
  /** Notices said once per run, such as draft requests being switched off. */
  readonly told: Set<string>
  /** Agent runs that failed since the last one that answered. */
  failuresInRow: number
  /** Why the agent cannot answer now, and when it was last tried; null while it can. */
  availability: DeskAvailability | null
  /** The server takes `me.desk.unavailable`, so colleagues see when this agent cannot answer. */
  readonly reportsAvailability: boolean
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
    const env = yield* T.ask<DeskEnv>()
    const { items } = yield* calling(runner.session.api['inbox.list']({ query: { fresh: '1' } }))
    for (const item of items) {
      if (!mayTryNow(runner.availability, env.clock.now())) break
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
  run: (role, prompt, what) => answeredBy(runner, role, prompt, what),
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
    if (extracted !== null && extracted._tag === 'Err') {
      if (extracted.error !== UNREADABLE_NOTE)
        return yield* releasedAfterFailure(runner, note.id, extracted.error)
      yield* calling(
        runner.session.api['notes.release']({ params: { id: note.id }, body: { reason: UNREADABLE_NOTE } }),
      )
      return runner.report(skipped(note.id, UNREADABLE_NOTE))
    }
    const prompt =
      extracted === null
        ? runnerNotePrompt(runner.member, flow, quotedNote(note, { authors, nonce: env.nonce }))
        : runnerExtractedNotePrompt(runner.member, flow, extracted.value)
    const answered = yield* draftedBy(runner, prompt, what)
    if (answered._tag === 'Err') return yield* releasedAfterFailure(runner, note.id, answered.error)
    const reply = answered.value
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
    const answered = yield* draftedBy(runner, prompt, `the draft request ${request.id}`)
    if (answered._tag === 'Err') return
    const reply = answered.value
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

/** The agent's usable reply, or the reason the person sees after the runner told why it has none. */
const draftedBy = (
  runner: Runner,
  prompt: string,
  what: string,
): T.Task<Result.Result<AgentReply, string>, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const output = yield* outputOf(runner, 'agent', prompt)
    const reply = output._tag === 'Ok' ? runnerReplyIn(output.value) : null
    const problem = reply === null ? null : replyProblem(reply)
    if (output._tag === 'Err' || problem !== null) {
      const failure = output._tag === 'Err' ? output.error : outputFailure('agent', problem!)
      return Result.err(yield* toldFailure(runner, failure, what))
    }
    yield* answersAgain(runner)
    return Result.ok(reply!)
  })

/** A debate turn's output, or null after the runner told why there is none. */
const answeredBy = (
  runner: Runner,
  role: 'agent' | 'reader',
  prompt: string,
  what: string,
): T.Task<string | null, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const output = yield* outputOf(runner, role, prompt)
    if (output._tag === 'Err') return yield* T.as(null)(toldFailure(runner, output.error, what))
    if (role === 'agent') yield* answersAgain(runner)
    return output.value
  })

/**
 * A failed run ends like a skip, with a reason the person sees that never holds the command's output.
 * The note stays picked up, so it is not tried again until the person asks for a draft.
 */
const releasedAfterFailure = (
  runner: Runner,
  noteId: AsRead.Note['id'],
  reason: string,
): T.Task<void, CliFailure, DeskEnv> =>
  T.asUnit(calling(runner.session.api['notes.release']({ params: { id: noteId }, body: { reason } })))

/**
 * Says why a run failed, until the agent seems unable to answer: then it says that once, tells the
 * server so colleagues see it, and the desk stops picking up notes until it is time to try again.
 */
const toldFailure = (runner: Runner, failure: RunFailure, what: string): T.Task<string, never, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    runner.failuresInRow += 1
    const before = runner.availability
    const after = unavailableAfterFailure(
      before,
      failure.unavailability,
      runner.failuresInRow,
      env.clock.now(),
    )
    runner.availability = after
    const isNew = after !== null && isNewlyUnavailable(before, after)
    if (before === null && !isNew) yield* warn(`${failure.detail}; nothing was drafted for ${what}.`)
    if (after === null || !isNew) return failure.reason
    if (before === null) yield* warn(unavailableLine(after, timeOfDay))
    yield* reported(runner)
    return failure.reason
  })

/** Tells the server the agent cannot answer, and again when the stream reconnects, since the server forgets it then. */
const reported = (runner: Runner): T.Task<void, never, DeskEnv> =>
  T.gen(function* () {
    const state = runner.availability
    if (state === null || !runner.reportsAvailability) return
    yield* T.result(
      runner.session.api['me.desk.unavailable']({
        body: { kind: state.kind, ...(state.until !== null && { until: state.until }) },
      }),
    )
  })

/** A run answered: the agent can again, so the desk says so once, to the person and the server. */
const answersAgain = (runner: Runner): T.Task<void, never, DeskEnv> =>
  T.gen(function* () {
    runner.failuresInRow = 0
    if (runner.availability === null) return
    runner.availability = null
    runner.report(outcome({ step: 'answering-again' }, ANSWERS_AGAIN))
    if (runner.reportsAvailability) yield* T.result(runner.session.api['me.desk.available']({ body: {} }))
  })

const timeOfDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** The reader's checked description of a note, wrapped like the note itself would be; null when it gave none. */
const extractedFrom = (
  runner: Runner,
  note: AsRead.Note,
  authors: Authors,
  what: string,
): T.Task<Result.Result<string, string>, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const prompt = readerPrompt(quotedNote(note, { authors, nonce: env.nonce }))
    const output = yield* outputOf(runner, 'reader', prompt)
    if (output._tag === 'Err') return Result.err(yield* toldFailure(runner, output.error, what))
    const extracted = extractionIn(output.value)
    if (extracted === null) {
      yield* warn(`The reader command did not describe ${what} in the expected form; nothing was drafted.`)
      return Result.err(UNREADABLE_NOTE)
    }
    return Result.ok(
      quotedNote({ ...note, body: describedForWriter(extracted) }, { authors, nonce: env.nonce }),
    )
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
    const extracted = yield* extractedFrom(runner, note.value, authors, `the note ${note.value.id}`)
    return extracted._tag === 'Ok' ? extracted.value : UNREADABLE
  })

/** What a command printed, or why it failed: in detail for the terminal, and in short for the person. */
const outputOf = (
  runner: Runner,
  role: 'agent' | 'reader',
  prompt: string,
): T.Task<Result.Result<string, RunFailure>, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const launch = role === 'agent' ? runner.launches.agent : runner.launches.reader!
    const finished = yield* T.result(
      T.timeout(runner.timeoutMs)(
        T.gen(function* () {
          const first = yield* launched(runner, launch, prompt)
          const fallback = launch.withoutStrictMcp
          if (fallback === null || !isManagedMcpRefusal(first)) return first
          yield* warn(role === 'reader' ? MANAGED_MCP_WARNING : MANAGED_MCP_AGENT_WARNING)
          runner.launches = { ...runner.launches, [role]: fallback }
          return yield* launched(runner, fallback, prompt)
        }),
      ),
    )
    if (finished._tag === 'Err') {
      const timedOut = finished.error._tag === 'TimeoutError'
      const said = timedOut
        ? `did not finish within ${runner.timeoutMs / 1000} seconds`
        : 'could not be started'
      const detail = timedOut ? said : `${said} (${finished.error.message})`
      return Result.err({
        detail: `The ${role} command ${detail}`,
        reason: `the ${role} command ${said}`,
        unavailability: null,
      })
    }
    const env = yield* T.ask<DeskEnv>()
    const run = finished.value
    const failed = exitFailure(role, run, launch.command, secretsOf(runner), runner.platform, env.clock.now())
    if (failed !== null) return Result.err(failed)
    if (isUsageLimitNotice(run.output))
      return Result.err({
        detail: `The ${role} command printed a usage-limit notice instead of an answer`,
        reason: `the ${role} command reached its usage limit`,
        unavailability: unavailabilityIn(run, env.clock.now()),
      })
    if (launch.format === 'text') return Result.ok(run.output)
    const denied = firstErrorLine(run, secretsOf(runner))
    if (denied !== null)
      yield* warn(`The ${role} command finished but reported, perhaps a tool it was denied: ${denied}`)
    const reply = antigravityOutput(run.output)
    return reply._tag === 'Ok' ? reply : Result.err(outputFailure(role, reply.error))
  })

/** A failed run: `detail` for the terminal, `reason` for the person, which never quotes what the command wrote. */
interface RunFailure {
  readonly detail: string
  readonly reason: string
  /** What the agent program said about being unable to answer at all, when it said it. */
  readonly unavailability: Unavailability | null
}

/** A failure the runner names itself, such as "printed nothing", which holds nothing the command wrote. */
const outputFailure = (role: 'agent' | 'reader', problem: string): RunFailure => ({
  detail: `The ${role} command ${problem}`,
  reason: `the ${role} command ${problem}`,
  unavailability: null,
})

export const MANAGED_MCP_AGENT_WARNING =
  'Claude Code refused --strict-mcp-config because your organization manages its MCP configuration: the agent now runs without the Homingbird MCP server.'

export const MANAGED_MCP_WARNING =
  'Claude Code refused --strict-mcp-config because your organization manages its MCP configuration: the reader now runs without it, with every MCP tool denied.'

const launched = (runner: Runner, launch: Launch, prompt: string): T.Task<AgentRun, CliFailure, DeskEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<DeskEnv>()
    const environment = {
      ...agentEnvironment(env.variables, secretsOf(runner)),
      ...launch.environment,
    }
    const input = launch.format === 'antigravity-stream' ? antigravityInput(prompt) : prompt
    return yield* T.tryPromise(
      (signal: AbortSignal) => env.launcher.runAgent(launch.command, input, environment, signal),
      (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
    )
  })

const secretsOf = (runner: Runner): ReadonlyArray<string> => [
  runner.session.credential.token,
  runner.credentialsFile,
]

const exitFailure = (
  role: 'agent' | 'reader',
  finished: AgentRun,
  command: string,
  secrets: ReadonlyArray<string>,
  platform: string,
  now: number,
): RunFailure | null => {
  if (finished.exitCode === 0) return null
  if (SHELL_COMMAND_NOT_FOUND.includes(finished.exitCode ?? 0))
    return {
      detail: `The ${role} command ${notFound(command, platform)}`,
      reason: `the ${role} command could not be found on the desk's computer`,
      unavailability: null,
    }
  const said = firstErrorLine(finished, secrets)
  const code = finished.exitCode ?? 'unknown'
  const unavailability = unavailabilityIn(finished, now)
  return {
    detail: `The ${role} command exited with code ${code}${said === null ? '' : ` (${said})`}`,
    reason:
      unavailability?.kind === 'usage_limit'
        ? `the ${role} command reached its usage limit`
        : unavailability?.kind === 'signed_out'
          ? `the ${role} command is signed out`
          : `the ${role} command failed (exit ${code}); it may be out of usage or signed out`,
    unavailability,
  }
}

/** What the shell answers when the command's program is not on the PATH: 127 as POSIX specifies, 9009 from cmd.exe. */
const SHELL_COMMAND_NOT_FOUND: ReadonlyArray<number> = [127, 9009]

const notFound = (command: string, platform: string): string => {
  const program = command.trim().split(/\s+/)[0] ?? command
  const name = program.replace(/^.*[\\/]/, '')
  const example =
    platform === 'win32' ? `C:\\Users\\you\\AppData\\Roaming\\npm\\${name}.cmd` : `/usr/local/bin/${name}`
  return `could not be found: "${program}" is not on the PATH this runs with; give its absolute path, such as ${example}, or set PATH`
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
