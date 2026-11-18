import { eventStream } from '@homingbird/client'
import { Task as T } from '@homingbird/kernel'
import {
  type DraftRequest,
  type DraftRequestId,
  type InboxItem,
  type Member,
  type MemberId,
  type Note,
  NoteBody,
  type StreamEvent,
} from '@homingbird/protocol'
import type { AgentRun, CliEnv } from '../environment.ts'
import { type CliFailure, EXIT, failed } from '../failure.ts'
import { type Outcome, outcome } from '../outcome.ts'
import { quoteForModel } from '../quoting.ts'
import { agentEnvironment, requireNoApprovalCredential } from '../runner-guard.ts'
import { type Session, calling, openSession } from '../session.ts'
import { authorsOf } from './reading.ts'
import { originalOf } from './requests.ts'

export const run = (
  agent: string,
  timeoutSeconds: number,
  report: (step: Outcome) => void,
): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    yield* requireNoApprovalCredential
    const session = yield* openSession('agent')
    const { member } = yield* calling(session.api['me.get']({}))
    const { cursor } = yield* calling(session.api['events.poll']({ query: {} }))
    const runner: Runner = {
      session,
      member,
      agent,
      timeoutMs: timeoutSeconds * 1000,
      report,
      tried: new Set(),
    }
    report(
      outcome(
        { step: 'online', member: { id: member.id, name: member.name, email: member.email }, agent },
        `Answering notes and draft requests for ${member.name} with: ${agent}\nEvery draft waits for approval in the web client. Press Ctrl-C to stop.`,
      ),
    )
    yield* answerWaiting(runner)
    const events = eventStream(
      {
        serverUrl: session.credential.serverUrl,
        fetch: env.fetch,
        token: () => session.credential.token,
        clock: env.clock,
        after: cursor,
      },
      env.stopped,
    )
    const stopped = yield* T.promise(async (signal) => {
      for await (const event of events) {
        if (!isWaking(event, member.id)) continue
        const exit = await T.run(answerWaiting(runner), env, signal)
        if (exit._tag === 'Err' && exit.error._tag === 'Fail') return exit.error.error
      }
      return null
    })
    if (stopped !== null) return yield* T.fail(stopped)
  })

export const RUNNER_INSTRUCTIONS = [
  'You are drafting a note in Homingbird, a messenger in which a person approves every note before it is sent.',
  'Write only the text of the note on standard output: no preamble, no explanation, no quotation marks around it.',
  'Your text is saved as a draft for your person to review; nothing is sent until they approve it.',
  'Do not run commands, change files or contact anyone to do this: only write the text.',
].join(' ')

interface Runner {
  readonly session: Session
  readonly member: Member
  readonly agent: string
  readonly timeoutMs: number
  readonly report: (step: Outcome) => void
  readonly tried: Set<DraftRequestId>
}

const STOPPING: ReadonlyArray<number> = [EXIT.signedOut, EXIT.unsafe]

const WAKING: ReadonlyArray<StreamEvent['body']['type']> = ['note.sent', 'draft.requested', 'resync']

const isWaking = (event: StreamEvent, viewerId: MemberId): boolean =>
  WAKING.includes(event.body.type) &&
  !(event.body.type === 'note.sent' && event.body.note.authorId === viewerId)

const answerWaiting = (runner: Runner): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const looked = yield* T.result(
      T.gen(function* () {
        const { items } = yield* calling(runner.session.api['inbox.list']({ query: { fresh: '1' } }))
        for (const item of items) yield* answerNote(runner, item)
        const { requests } = yield* calling(runner.session.api['draftRequests.list']({}))
        for (const request of requests.filter((each) => !runner.tried.has(each.id))) {
          runner.tried.add(request.id)
          yield* answerRequest(runner, request)
        }
      }),
    )
    if (looked._tag === 'Ok') return
    if (STOPPING.includes(looked.error.exitCode)) return yield* T.fail(looked.error)
    yield* warn(`Could not look for work just now: ${looked.error.message}`)
  })

const answerNote = (runner: Runner, item: InboxItem): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    const { note, author } = item
    yield* calling(runner.session.api['notes.pickup']({ params: { id: note.id } }))
    const quoted = quoteForModel(note, new Map([[author.id, author]]), env.nonce())
    const body = yield* draftedBy(runner, notePrompt(runner.member, quoted), `the note ${note.id}`)
    if (body === null) return
    const draft = yield* calling(runner.session.api['drafts.create']({ body: { body, inReplyTo: note.id } }))
    runner.report(drafted(draft, { inReplyTo: note.id }, `in reply to ${note.id}`))
  })

const answerRequest = (runner: Runner, request: DraftRequest): T.Task<void, CliFailure, CliEnv> =>
  T.gen(function* () {
    const authors = request.inReplyTo === null ? new Map() : yield* authorsOf(runner.session)
    const original = yield* originalOf(runner.session, request, authors)
    const prompt = requestPrompt(runner.member, request.instruction, original)
    const body = yield* draftedBy(runner, prompt, `the draft request ${request.id}`)
    if (body === null) return
    const draft = yield* calling(
      runner.session.api['drafts.create']({ body: { body, requestId: request.id } }),
    )
    runner.report(drafted(draft, { requestId: request.id }, `for the draft request ${request.id}`))
  })

const draftedBy = (runner: Runner, prompt: string, what: string): T.Task<string | null, CliFailure, CliEnv> =>
  T.gen(function* () {
    const env = yield* T.ask<CliEnv>()
    yield* requireNoApprovalCredential
    const environment = agentEnvironment(env.variables, [runner.session.credential.token])
    const finished = yield* T.result(
      T.timeout(runner.timeoutMs)(
        T.tryPromise(
          (signal: AbortSignal) => env.launcher.runAgent(runner.agent, prompt, environment, signal),
          (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
        ),
      ),
    )
    if (finished._tag === 'Err') {
      const reason =
        finished.error._tag === 'TimeoutError'
          ? `did not finish within ${runner.timeoutMs / 1000} seconds`
          : `could not be started (${finished.error.message})`
      return yield* T.as(null)(warn(`The agent command ${reason}; nothing was drafted for ${what}.`))
    }
    const problem = problemWith(finished.value)
    if (problem === null) return finished.value.output.trim()
    return yield* T.as(null)(warn(`The agent command ${problem}; nothing was drafted for ${what}.`))
  })

const problemWith = (finished: AgentRun): string | null => {
  if (finished.exitCode !== 0) return `exited with code ${finished.exitCode ?? 'unknown'}`
  const body = finished.output.trim()
  if (body === '') return 'printed nothing'
  return NoteBody.decode(body)._tag === 'Ok' ? null : 'printed more than a note can hold'
}

const warn = (message: string): T.Task<void, never, CliEnv> =>
  T.flatMap((env: CliEnv) => T.sync(() => env.output.problem(message)))(T.ask<CliEnv>())

const drafted = (draft: Note, answering: Readonly<Record<string, string>>, what: string): Outcome =>
  outcome(
    { step: 'drafted', draftId: draft.id, conversationId: draft.conversationId, ...answering },
    `Drafted ${draft.id} ${what}. It has not been sent: it waits for approval.`,
  )

const notePrompt = (member: Member, quoted: string): string =>
  [
    RUNNER_INSTRUCTIONS,
    `A colleague sent ${member.name} the note below. Draft the reply ${member.name} would send, from what you know.`,
    quoted,
  ].join('\n\n')

const requestPrompt = (member: Member, instruction: string, original: string | null): string =>
  [
    RUNNER_INSTRUCTIONS,
    instruction.trim() === ''
      ? `${member.name}, your own person, asked you for this draft without an instruction: write the note that fits.`
      : `${member.name}, your own person, asked you for this draft. Their instruction:\n${instruction.trim()}`,
    ...(original === null ? [] : ['The draft answers this note from a colleague:', original]),
  ].join('\n\n')
