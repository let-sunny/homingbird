import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { HomingbirdDraftRequest, HomingbirdOverview } from '../types'
import { type Ran, commandOf, lastJsonLine, run, runJson, serverArguments } from './command-line'
import { autoDraftOf, notePromptFor, quietReplyIn, replyPromptFor, requestPromptFor } from './drafting'
import { describeCause, forked, host, hostOr, inBackground, rescued } from './effects'
import { Stream, T } from './kernel.mjs'
import { PANE, draftsWaitingIn, notesAwaitingDraftIn, paneTitleFor } from './pane'
import { type PaneText, textFor } from './pane-text'
import { SERVER_SETTING, checkServer } from './server-address'
import { hostEnvOf } from './tools'

export interface Desk {
  readonly options: PluginOptions
  server: string
  answeringFlow: string
  memberId: string | null
  readonly handled: Set<string>
  readonly wrappedNotes: Map<string, string>
  readonly helpers: Map<string, string>
  readonly localeOn: Map<string, string | null>
  stream: AsyncGenerator<unknown, unknown> | null
  heartbeat: { readonly cancel: () => void } | null
  lastSequence: number | null
  hostTooOld: boolean
}

export const makeDesk = (options: PluginOptions): Desk => ({
  options,
  server: String(options.server ?? '').trim(),
  answeringFlow: '',
  memberId: null,
  handled: new Set(),
  wrappedNotes: new Map(),
  localeOn: new Map(),
  helpers: new Map(),
  stream: null,
  heartbeat: null,
  lastSequence: null,
  hostTooOld: false,
})

export function openDesk($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    yield* host(() => update($, problem, () => null))
    desk.server = yield* serverFor($, desk)
    const latest = yield* refresh($, desk)
    if (latest !== null) yield* claimDesk($, desk)
  })
}

/** Signs this session out of the server it is bound to, and only that one. */
export function signOut($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    endStream(desk)
    yield* run($, desk, ['logout'])
    yield* refresh($, desk)
    yield* host(() => update($, problem, () => null))
  })
}

/** Takes a server address the person typed: checked first, then saved and signed in to. */
export function useServer($: Engine, desk: Desk, typed: string): T.Task<void, unknown> {
  return T.gen(function* () {
    yield* host(() => update($, problem, () => null))
    yield* host(() => update($, checking, () => true))
    const checked = yield* checkServer($, typed)
    yield* host(() => update($, checking, () => false))
    if (checked.kind !== 'found') {
      const refused = (yield* said($)).serverRefused(checked.kind, checked.typed)
      yield* host(() => update($, problem, () => refused))
      return
    }
    desk.server = checked.server
    yield* hostOr(() => $.config.set({ key: SERVER_SETTING, value: checked.server }), undefined)
    yield* host(() => update($, overview, () => null))
    yield* beginSignIn($, desk, checked.server)
  })
}

export function resumeDesk($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    if (!(yield* holdsDesk($))) return
    yield* forked(host(() => $.ui.open({ id: PANE, title: 'Homingbird' })))
    if ((yield* refresh($, desk)) !== null) yield* claimDesk($, desk)
  })
}

export function claimDesk($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    const sessionId = yield* host(() => $.session.id())
    const claimedAt = yield* host(() => $.clock.now())
    yield* host(() => $.store.set(DESK_KEY, { sessionId, claimedAt }))
    yield* host(() => update($, deskRole, () => 'desk'))
    yield* showCounts($, yield* host(() => read($, overview)))
    desk.heartbeat?.cancel()
    desk.heartbeat = $.clock.every(HEARTBEAT_MS, () => inBackground(checkIn($, desk)))
    endStream(desk)
    yield* forked(follow($, desk))
    yield* catchUp($, desk)
  })
}

export function beginSignIn($: Engine, desk: Desk, server: string): T.Task<void, unknown> {
  return T.gen(function* () {
    yield* host(() => update($, problem, () => null))
    const command = yield* commandOf($, desk.options)
    if (command.kind === 'no-node') {
      const missing = (yield* said($)).noNode(command.olderVersion)
      yield* host(() => update($, connection, () => 'unavailable'))
      yield* host(() => update($, problem, () => missing))
      return
    }
    const errors: string[] = []
    const argv = [...command.argv, 'login', '--server', server, '--json']
    const signedIn = Stream.forEach((line: string) => {
      const step = lastJsonLine(line) as {
        step?: unknown
        verificationUri?: unknown
        userCode?: unknown
      } | null
      if (step?.step !== 'awaiting_approval' || typeof step.verificationUri !== 'string') return T.unit
      const pending = { verificationUri: step.verificationUri, userCode: String(step.userCode ?? '') }
      return host(() => update($, signIn, () => pending))
    })(linesOf($.process.spawn({ argv, env: { HOMINGBIRD_CLIENT_KIND: 'plugin' } }), errors))
    const failure = yield* rescued(T.as(null)(signedIn), (cause) => cause)
    if (failure !== null) {
      const failed = (yield* said($)).couldNotSignIn(describeCause(failure))
      yield* host(() => update($, problem, () => failed))
    }
    yield* host(() => update($, signIn, () => null))
    desk.localeOn.delete(server)
    if ((yield* refresh($, desk)) !== null) return yield* claimDesk($, desk)
    const ended = signInEndingIn(errors.join(''))
    if (ended !== null) {
      const words = yield* said($)
      const sentence =
        ended === 'denied'
          ? words.signInDenied
          : ended === 'expired'
            ? words.signInExpired
            : words.signInUnreachable
      yield* host(() => update($, problem, () => sentence))
    }
  })
}

/**
 * The one server this session is bound to: the configured or typed address, else HOMINGBIRD_SERVER,
 * else the server it found itself signed in to. Every command it runs names this server.
 */
export function serverFor($: Engine, desk: Desk): T.Task<string> {
  return T.gen(function* () {
    if (desk.server !== '') return desk.server
    const fromEnvironment = ((yield* host(() => $.env.get('HOMINGBIRD_SERVER'))) ?? '')
      .trim()
      .replace(/\/+$/, '')
    if (fromEnvironment !== '') return fromEnvironment
    return yield* knownServer($)
  })
}

export function refresh($: Engine, desk: Desk): T.Task<HomingbirdOverview | null, unknown> {
  return T.gen(function* () {
    const ran = yield* runJson($, desk, ['overview'])
    if (ran.kind === 'no-node') return yield* settle($, (yield* said($)).noNode(ran.olderVersion), true)
    if (ran.kind === 'unavailable') return yield* settle($, ran.message, true)
    if (ran.kind !== 'ok' && ran.kind !== 'signed-out') return yield* settle($, ran.message, false)
    const listed = ran.kind === 'ok' ? overviewIn(ran.value) : null
    desk.answeringFlow = answeringFlowIn(ran.kind === 'ok' ? ran.value : null)
    desk.memberId = memberIdIn(ran.kind === 'ok' ? ran.value : null)
    const latest = listed === null ? null : { ...listed, locale: yield* localeOn($, desk, listed.server) }
    if (latest !== null && desk.server === '') desk.server = latest.server
    const before = yield* host(() => read($, overview))
    yield* host(() => update($, overview, () => latest))
    yield* host(() => update($, problem, () => null))
    if (
      before !== null &&
      !isSameIdentity(before, latest) &&
      (yield* host(() => read($, deskRole))) === 'desk'
    )
      yield* stopDesk($, desk, (yield* said($)).deskStopped(before, latest))
    if (latest === null) yield* host(() => update($, connection, () => 'signed-out'))
    else {
      const state = yield* host(() => read($, connection))
      if (state === 'signed-out' || state === 'unavailable')
        yield* host(() => update($, connection, () => (desk.stream === null ? 'reconnecting' : 'live')))
    }
    yield* showCounts($, latest)
    return latest
  })
}

export function wrappedNoteFor($: Engine, desk: Desk, noteId: string): T.Task<string | null, unknown> {
  return T.gen(function* () {
    const known = desk.wrappedNotes.get(noteId)
    if (known !== undefined) return known
    const latest = yield* refresh($, desk)
    return latest?.awaiting.find((waiting) => waiting.noteId === noteId)?.wrapped ?? null
  })
}

/** The server this session is signed in to, as the pane last saw it; empty when it is not known. */
export function knownServer($: Engine): T.Task<string> {
  return T.map((latest: HomingbirdOverview | null) => latest?.server ?? '')(host(() => read($, overview)))
}

export function personText($: Engine): T.Task<PaneText> {
  return said($)
}

export const DESK_KEY = 'desk'

type Engine = EngineInterface

function said($: Engine): T.Task<PaneText> {
  return T.flatMap((latest: HomingbirdOverview | null) => textFor($, latest))(host(() => read($, overview)))
}

function localeOn($: Engine, desk: Desk, server: string): T.Task<string | null> {
  return T.gen(function* () {
    if (!desk.localeOn.has(server)) {
      const ran = yield* runJson($, desk, ['status'])
      const status = (ran.kind === 'ok' ? ran.value : null) as { locale?: unknown } | null
      desk.localeOn.set(server, typeof status?.locale === 'string' ? status.locale : null)
    }
    return desk.localeOn.get(server) ?? null
  })
}

function holdsDesk($: Engine): T.Task<boolean> {
  return T.gen(function* () {
    const claim = (yield* host(() => $.store.get(DESK_KEY))) as { sessionId?: unknown } | undefined
    return claim?.sessionId === (yield* host(() => $.session.id()))
  })
}

function checkIn($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    if (!(yield* holdsDesk($))) return yield* standDown($, desk)
    const latest = yield* refresh($, desk)
    if (latest !== null && desk.stream === null && (yield* host(() => read($, deskRole))) === 'desk')
      yield* forked(follow($, desk))
  })
}

function stopDesk($: Engine, desk: Desk, reason: string): T.Task<void> {
  return T.gen(function* () {
    desk.heartbeat?.cancel()
    desk.heartbeat = null
    endStream(desk)
    yield* host(() => update($, deskRole, () => 'not-desk'))
    yield* host(() => update($, connection, () => 'idle'))
    yield* host(() => update($, problem, () => reason))
    $.ui.status(undefined)
  })
}

const isSameIdentity = (before: HomingbirdOverview, after: HomingbirdOverview | null): boolean =>
  after !== null && after.server === before.server && after.memberName === before.memberName

function standDown($: Engine, desk: Desk): T.Task<void> {
  return T.gen(function* () {
    desk.heartbeat?.cancel()
    desk.heartbeat = null
    endStream(desk)
    yield* host(() => update($, deskRole, () => 'moved'))
    yield* host(() => update($, connection, () => 'idle'))
    $.ui.status(undefined)
  })
}

/** Ends the live stream, which may still hold a credential that was signed out. */
function endStream(desk: Desk): void {
  const stream = desk.stream
  desk.stream = null
  if (stream !== null) inBackground(host(() => stream.return(undefined)))
}

function follow($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    const command = yield* commandOf($, desk.options)
    if (desk.stream !== null || command.kind === 'no-node') return
    const after = desk.lastSequence === null ? [] : ['--after', String(desk.lastSequence)]
    const stream = $.process.spawn({
      argv: [...command.argv, ...serverArguments(desk.server), 'stream', '--json', ...after],
    })
    desk.stream = stream
    yield* host(() => update($, connection, () => 'live'))
    const followed = Stream.forEach((line: string) => arrived($, desk, line))(
      Stream.takeWhile((_: string) => desk.stream === stream)(linesOf(stream)),
    )
    const failure = yield* rescued(T.as(null)(followed), (cause) => cause ?? 'stopped')
    if (failure !== null) {
      const stopped = (yield* said($)).streamStopped
      yield* host(() => update($, problem, () => stopped))
    }
    if (desk.stream !== stream) return
    desk.stream = null
    if ((yield* host(() => read($, deskRole))) === 'desk')
      yield* host(() => update($, connection, () => 'reconnecting'))
  })
}

function arrived($: Engine, desk: Desk, line: string): T.Task<void, unknown> {
  return T.gen(function* () {
    const parsed = lastJsonLine(line) as StreamLine | null
    const event = parsed?.event
    if (typeof event?.seq === 'number') desk.lastSequence = event.seq
    const body = event?.body
    if (
      body?.type === 'note.sent' &&
      typeof parsed?.wrapped === 'string' &&
      typeof body.note?.id === 'string'
    ) {
      desk.wrappedNotes.set(body.note.id, parsed.wrapped)
      const text = yield* said($)
      notifyPerson($, text, text.noteArrived(authorIn(parsed.wrapped) ?? text.aColleague))
      yield* refresh($, desk)
      return yield* draftReply($, desk, body.note.id, parsed.wrapped)
    }
    if (body?.type === 'debate.changed') {
      const taking = Array.isArray(body.participantIds) && body.participantIds.includes(desk.memberId)
      if (taking) yield* noticeDebates($, desk)
      return
    }
    if (body?.type === 'draft.requested' && body.request !== undefined) {
      const announced = requestIn(body.request)
      const listed = announced === null ? [] : yield* openRequests($, desk)
      const request = listed.find((one) => one.id === announced?.id) ?? announced
      if (request !== null) yield* answerRequest($, desk, request)
      return
    }
    const latest = yield* refresh($, desk)
    if (
      body?.type === 'draft.saved' &&
      latest !== null &&
      latest.drafts.some((draft) => draft.id === body.note?.id)
    ) {
      const text = yield* said($)
      notifyPerson($, text, text.draftReadyNotice)
    }
    if (body?.type === 'resync') yield* catchUp($, desk)
    else if (body?.type === 'draft.saved' || body?.type === 'draft.request.changed') {
      const open = yield* openRequests($, desk)
      yield* host(() => update($, requests, () => open))
    }
  })
}

/**
 * Tells the person once when a debate room waits on their agent. The desk takes no turn itself: the
 * runner does, and the person follows the room, and may post its result, in the web client.
 */
function noticeDebates($: Engine, desk: Desk): T.Task<void> {
  return T.gen(function* () {
    const ran = yield* runJson($, desk, ['debates'])
    const listed = ran.kind === 'ok' ? (ran.value as { debates?: unknown } | null)?.debates : []
    for (const one of Array.isArray(listed) ? listed : []) {
      const ask = one as { id?: unknown; wants?: unknown; turnsTaken?: unknown; resultRound?: unknown }
      if (
        typeof ask.id !== 'string' ||
        (ask.wants !== 'turn' && ask.wants !== 'result' && ask.wants !== 'vote')
      )
        continue
      const key = `debate:${ask.id}:${ask.wants}:${String(ask.turnsTaken)}:${String(ask.resultRound)}`
      if (desk.handled.has(key)) continue
      desk.handled.add(key)
      const text = yield* said($)
      notifyPerson($, text, text.debateWaiting(ask.wants), text.debateToast(ask.wants))
    }
  })
}

function catchUp($: Engine, desk: Desk): T.Task<void, unknown> {
  return T.gen(function* () {
    const latest = yield* host(() => read($, overview))
    for (const waiting of notesAwaitingDraftIn(latest)) {
      desk.wrappedNotes.set(waiting.noteId, waiting.wrapped)
      yield* draftReply($, desk, waiting.noteId, waiting.wrapped)
    }
    const open = yield* openRequests($, desk)
    yield* host(() => update($, requests, () => open))
    for (const request of open) yield* answerRequest($, desk, request)
  })
}

function openRequests($: Engine, desk: Desk): T.Task<HomingbirdDraftRequest[]> {
  return T.map((ran: Ran) => {
    const listed = ran.kind === 'ok' ? (ran.value as { requests?: unknown } | null)?.requests : []
    return (Array.isArray(listed) ? listed : []).flatMap((one) => {
      const request = requestIn(one)
      return request === null || hasDrafts(one) ? [] : [request]
    })
  })(runJson($, desk, ['requests']))
}

function draftReply($: Engine, desk: Desk, noteId: string, wrappedNote: string): T.Task<void, unknown> {
  return T.gen(function* () {
    const mode = autoDraftOf(desk.options.autoDraft)
    if (mode === 'off' || desk.handled.has(noteId)) return
    desk.handled.add(noteId)
    yield* run($, desk, ['pickup', noteId])
    yield* refresh($, desk)
    const waiting = (yield* host(() => read($, overview)))?.awaiting.find((one) => one.noteId === noteId)
    const guidance = yield* guidanceFor($, desk, waiting?.conversationId)
    if (mode === 'turn') {
      yield* host(() => $.prompt.submit({ text: notePromptFor(noteId, wrappedNote, guidance) }))
      return
    }
    const reply = quietReplyIn(yield* suggestReply($, replyPromptFor(wrappedNote, guidance)))
    if (reply === null) {
      yield* run($, desk, ['skip', '--', noteId, QUIET_SKIP])
      yield* refresh($, desk)
      return
    }
    const drafted = yield* run($, desk, ['draft', '--reply', noteId, '--', reply], yield* hostEnvOf($))
    if (drafted.kind === 'ok') yield* refresh($, desk)
  })
}

function answerRequest($: Engine, desk: Desk, request: HomingbirdDraftRequest): T.Task<void, unknown> {
  return T.gen(function* () {
    yield* host(() =>
      update($, requests, (open) => [...open.filter((one) => one.id !== request.id), request]),
    )
    if (autoDraftOf(desk.options.autoDraft) === 'off' || desk.handled.has(request.id)) return
    desk.handled.add(request.id)
    yield* refresh($, desk)
    const text = yield* said($)
    notifyPerson($, text, text.draftingRequest)
    const guidance = yield* guidanceFor($, desk, request.conversationId)
    yield* host(() => $.prompt.submit({ text: requestPromptFor(request, guidance) }))
  })
}

function suggestReply($: Engine, prompt: string): T.Task<string> {
  return T.gen(function* () {
    const forked = yield* host(() => $.model.fork({ prompt }))
    if (forked.isAnswered) return forked.text
    if (forked.reason !== 'nothing-to-fork') return ''
    const model = yield* host(() => $.session.model())
    const fresh = yield* host(() => $.model.complete({ model, prompt }))
    return fresh.isAnswered ? fresh.text : ''
  })
}

/** A toast in the session and a notification; a toast shares a line with the pane, so it can be shorter. */
function notifyPerson($: Engine, words: PaneText, text: string, toast: string = text): void {
  $.ui.toast(words.toast(toast))
  inBackground(host(() => $.ui.notify(text, { title: 'Homingbird' })))
}

function showCounts($: Engine, latest: HomingbirdOverview | null): T.Task<void> {
  return T.gen(function* () {
    const waiting = draftsWaitingIn(latest)
    const isDesk = (yield* host(() => read($, deskRole))) === 'desk'
    $.ui.status(isDesk ? (yield* textFor($, latest)).deskStatus(waiting) : undefined)
    const isOpen = (yield* host(() => $.ui.panes())).some((pane) => pane.id === PANE)
    if (isOpen) yield* host(() => $.ui.open({ id: PANE, title: paneTitleFor(waiting) }))
  })
}

function settle($: Engine, message: string, isUnavailable: boolean): T.Task<null> {
  return T.gen(function* () {
    if (isUnavailable) yield* host(() => update($, connection, () => 'unavailable'))
    yield* host(() => update($, problem, () => message))
    return null
  })
}

/** The host's output chunks as whole lines of standard output; standard error is kept in `errors`. */
const linesOf = (
  stream: AsyncIterable<{ stream: string; text: string }>,
  errors: string[] = [],
): Stream.Stream<string> => ({
  [Symbol.asyncIterator]: () => {
    let unread = ''
    return Stream.flatMap((chunk: { stream: string; text: string }): string[] => {
      if (chunk.stream === 'stderr') errors.push(chunk.text)
      if (chunk.stream !== 'stdout') return []
      const lines = (unread + chunk.text).split('\n')
      unread = lines.pop() ?? ''
      return lines
    })(stream)[Symbol.asyncIterator]()
  },
})

interface StreamLine {
  readonly event?: {
    readonly seq?: unknown
    readonly body?: {
      readonly type?: string
      readonly note?: { readonly id?: unknown }
      readonly request?: unknown
      readonly participantIds?: unknown
    }
  }
  readonly wrapped?: unknown
}

const requestIn = (value: unknown): HomingbirdDraftRequest | null => {
  const request = value as Partial<Record<keyof HomingbirdDraftRequest, unknown>> | null
  if (typeof request?.id !== 'string' || typeof request.conversationId !== 'string') return null
  return {
    id: request.id,
    conversationId: request.conversationId,
    inReplyTo: typeof request.inReplyTo === 'string' ? request.inReplyTo : null,
    instruction: typeof request.instruction === 'string' ? request.instruction : '',
    answers: typeof request.answers === 'string' ? request.answers : null,
  }
}

const hasDrafts = (value: unknown): boolean => {
  const draftIds = (value as { draftIds?: unknown } | null)?.draftIds
  return Array.isArray(draftIds) && draftIds.length > 0
}

const overviewIn = (value: unknown): HomingbirdOverview | null => {
  const data = value as
    | (Partial<HomingbirdOverview> & { signedIn?: boolean; member?: { name?: string } })
    | null
  if (data === null || data.signedIn !== true) return null
  return {
    server: String(data.server ?? ''),
    memberName: String(data.member?.name ?? ''),
    locale: null,
    conversations: data.conversations ?? [],
    awaiting: data.awaiting ?? [],
    drafts: data.drafts ?? [],
    reviewChannel: typeof data.reviewChannel === 'string' ? data.reviewChannel : null,
  }
}

/**
 * The answering flow and principles for one conversation, so a channel's principles come first as with
 * the runner and MCP; the overview's general guidance when the conversation is not known.
 */
function guidanceFor($: Engine, desk: Desk, conversationId: string | undefined): T.Task<string> {
  if (conversationId === undefined) return T.succeed(desk.answeringFlow)
  return T.map((ran: Ran) => {
    const guidance = ran.kind === 'ok' ? (ran.value as { guidance?: unknown } | null)?.guidance : undefined
    return typeof guidance === 'string' ? guidance : desk.answeringFlow
  })(runJson($, desk, ['guidance', conversationId]))
}

const memberIdIn = (value: unknown): string | null => {
  const id = (value as { member?: { id?: unknown } } | null)?.member?.id
  return typeof id === 'string' ? id : null
}

const answeringFlowIn = (value: unknown): string => {
  const flow = (value as { answeringFlow?: unknown } | null)?.answeringFlow
  return typeof flow === 'string' ? flow : ''
}

const authorIn = (wrappedNote: string): string | null => {
  const from = /^<colleague-note [^>]*from="([^"&]*)/.exec(wrappedNote)?.[1]?.trim()
  return from === undefined || from === '' ? null : from
}

const signInEndingIn = (stderr: string): 'denied' | 'expired' | 'unreachable' | null => {
  if (stderr.trim() === '') return null
  if (/denied/i.test(stderr)) return 'denied'
  if (/expired/i.test(stderr)) return 'expired'
  return 'unreachable'
}

const HEARTBEAT_MS = 30_000
const QUIET_SKIP =
  'Quiet drafting runs without tools, so this mode cannot read your knowledge sources, follow answering-flow steps that need tools, open linked documents or look anything up; ask for a draft from the web client, or set Desk drafting to turn.'

const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'idle')
const deskRole = atom({ plugin: 'homingbird', key: 'desk' } as const, 'not-desk')
const checking = atom({ plugin: 'homingbird', key: 'checkingServer' } as const, false)
const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null, { shape: 'overview-3' })
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)
const requests = atom({ plugin: 'homingbird', key: 'requests' } as const, [], { shape: 'requests-2' })
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
