import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { HomingbirdDraftRequest, HomingbirdOverview } from '../types'
import { commandOf, lastJsonLine, run, runJson, serverArguments } from './command-line'
import { autoDraftOf, notePromptFor, replyIn, replyPromptFor, requestPromptFor } from './drafting'
import { PANE, paneTitleFor } from './pane'
import { type PaneText, textFor } from './pane-text'
import { SERVER_SETTING, checkServer } from './server-address'
import { hostEnvOf } from './tools'

export interface Desk {
  readonly options: PluginOptions
  server: string
  answeringFlow: string
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
  handled: new Set(),
  wrappedNotes: new Map(),
  localeOn: new Map(),
  helpers: new Map(),
  stream: null,
  heartbeat: null,
  lastSequence: null,
  hostTooOld: false,
})

export async function openDesk($: Engine, desk: Desk): Promise<void> {
  await update($, problem, () => null)
  desk.server = await serverFor($, desk)
  const latest = await refresh($, desk)
  if (latest !== null) return claimDesk($, desk)
}

/** Signs this session out of the server it is bound to, and only that one. */
export async function signOut($: Engine, desk: Desk): Promise<void> {
  endStream(desk)
  await run($, desk, ['logout'])
  await refresh($, desk)
  await update($, problem, () => null)
}

/** Takes a server address the person typed: checked first, then saved and signed in to. */
export async function useServer($: Engine, desk: Desk, typed: string): Promise<void> {
  await update($, problem, () => null)
  await update($, checking, () => true)
  const checked = await checkServer($, typed)
  await update($, checking, () => false)
  if (checked.kind !== 'found') {
    const refused = (await said($)).serverRefused(checked.kind, checked.typed)
    await update($, problem, () => refused)
    return
  }
  desk.server = checked.server
  await $.config.set({ key: SERVER_SETTING, value: checked.server }).catch(() => undefined)
  await update($, overview, () => null)
  await beginSignIn($, desk, checked.server)
}

export async function resumeDesk($: Engine, desk: Desk): Promise<void> {
  if (!(await holdsDesk($))) return
  inBackground($.ui.open({ id: PANE, title: 'Homingbird' }))
  if ((await refresh($, desk)) !== null) await claimDesk($, desk)
}

export async function claimDesk($: Engine, desk: Desk): Promise<void> {
  await $.store.set(DESK_KEY, { sessionId: await $.session.id(), claimedAt: await $.clock.now() })
  await update($, deskRole, () => 'desk')
  await showCounts($, await read($, overview))
  desk.heartbeat?.cancel()
  desk.heartbeat = $.clock.every(HEARTBEAT_MS, () => inBackground(checkIn($, desk)))
  endStream(desk)
  inBackground(follow($, desk))
  await catchUp($, desk)
}

export async function beginSignIn($: Engine, desk: Desk, server: string): Promise<void> {
  await update($, problem, () => null)
  const command = await commandOf($, desk.options)
  if (command.kind === 'no-node') {
    const missing = (await said($)).noNode(command.olderVersion)
    await update($, connection, () => 'unavailable')
    await update($, problem, () => missing)
    return
  }
  const errors: string[] = []
  try {
    const argv = [...command.argv, 'login', '--server', server, '--json']
    for await (const line of linesOf($.process.spawn({ argv }), errors)) {
      const step = lastJsonLine(line) as {
        step?: unknown
        verificationUri?: unknown
        userCode?: unknown
      } | null
      if (step?.step !== 'awaiting_approval' || typeof step.verificationUri !== 'string') continue
      const pending = { verificationUri: step.verificationUri, userCode: String(step.userCode ?? '') }
      await update($, signIn, () => pending)
    }
  } catch (cause) {
    const failed = (await said($)).couldNotSignIn(cause instanceof Error ? cause.message : String(cause))
    await update($, problem, () => failed)
  }
  await update($, signIn, () => null)
  desk.localeOn.delete(server)
  if ((await refresh($, desk)) !== null) return claimDesk($, desk)
  const ended = signInEndingIn(errors.join(''))
  if (ended !== null) {
    const words = await said($)
    const sentence =
      ended === 'denied'
        ? words.signInDenied
        : ended === 'expired'
          ? words.signInExpired
          : words.signInUnreachable
    await update($, problem, () => sentence)
  }
}

/**
 * The one server this session is bound to: the configured or typed address, else HOMINGBIRD_SERVER,
 * else the server it found itself signed in to. Every command it runs names this server.
 */
export async function serverFor($: Engine, desk: Desk): Promise<string> {
  if (desk.server !== '') return desk.server
  const fromEnvironment = ((await $.env.get('HOMINGBIRD_SERVER')) ?? '').trim().replace(/\/+$/, '')
  if (fromEnvironment !== '') return fromEnvironment
  return knownServer($)
}

export async function refresh($: Engine, desk: Desk): Promise<HomingbirdOverview | null> {
  const ran = await runJson($, desk, ['overview'])
  if (ran.kind === 'no-node') return settle($, (await said($)).noNode(ran.olderVersion), true)
  if (ran.kind === 'unavailable') return settle($, ran.message, true)
  if (ran.kind !== 'ok' && ran.kind !== 'signed-out') return settle($, ran.message, false)
  const listed = ran.kind === 'ok' ? overviewIn(ran.value) : null
  desk.answeringFlow = answeringFlowIn(ran.kind === 'ok' ? ran.value : null)
  const latest = listed === null ? null : { ...listed, locale: await localeOn($, desk, listed.server) }
  if (latest !== null && desk.server === '') desk.server = latest.server
  const before = await read($, overview)
  await update($, overview, () => latest)
  await update($, problem, () => null)
  if (before !== null && !isSameIdentity(before, latest) && (await read($, deskRole)) === 'desk')
    await stopDesk($, desk, (await said($)).deskStopped(before, latest))
  if (latest === null) await update($, connection, () => 'signed-out')
  else if ((await read($, connection)) === 'signed-out' || (await read($, connection)) === 'unavailable')
    await update($, connection, () => (desk.stream === null ? 'reconnecting' : 'live'))
  await showCounts($, latest)
  return latest
}

export async function wrappedNoteFor($: Engine, desk: Desk, noteId: string): Promise<string | null> {
  const known = desk.wrappedNotes.get(noteId)
  if (known !== undefined) return known
  const latest = await refresh($, desk)
  return latest?.awaiting.find((waiting) => waiting.noteId === noteId)?.wrapped ?? null
}

/** The server this session is signed in to, as the pane last saw it; empty when it is not known. */
export async function knownServer($: Engine): Promise<string> {
  return (await read($, overview))?.server ?? ''
}

export async function personText($: Engine): Promise<PaneText> {
  return said($)
}

export const inBackground = (work: Promise<unknown>): void => {
  work.catch(() => undefined)
}

export const DESK_KEY = 'desk'

type Engine = EngineInterface

async function said($: Engine): Promise<PaneText> {
  return textFor($, await read($, overview))
}

async function localeOn($: Engine, desk: Desk, server: string): Promise<string | null> {
  if (!desk.localeOn.has(server)) {
    const ran = await runJson($, desk, ['status'])
    const status = (ran.kind === 'ok' ? ran.value : null) as { locale?: unknown } | null
    desk.localeOn.set(server, typeof status?.locale === 'string' ? status.locale : null)
  }
  return desk.localeOn.get(server) ?? null
}

async function holdsDesk($: Engine): Promise<boolean> {
  const claim = (await $.store.get(DESK_KEY)) as { sessionId?: unknown } | undefined
  return claim?.sessionId === (await $.session.id())
}

async function checkIn($: Engine, desk: Desk): Promise<void> {
  if (!(await holdsDesk($))) return standDown($, desk)
  const latest = await refresh($, desk)
  if (latest !== null && desk.stream === null && (await read($, deskRole)) === 'desk')
    inBackground(follow($, desk))
}

async function stopDesk($: Engine, desk: Desk, reason: string): Promise<void> {
  desk.heartbeat?.cancel()
  desk.heartbeat = null
  endStream(desk)
  await update($, deskRole, () => 'not-desk')
  await update($, connection, () => 'idle')
  await update($, problem, () => reason)
  $.ui.status(undefined)
}

const isSameIdentity = (before: HomingbirdOverview, after: HomingbirdOverview | null): boolean =>
  after !== null && after.server === before.server && after.memberName === before.memberName

async function standDown($: Engine, desk: Desk): Promise<void> {
  desk.heartbeat?.cancel()
  desk.heartbeat = null
  endStream(desk)
  await update($, deskRole, () => 'moved')
  await update($, connection, () => 'idle')
  $.ui.status(undefined)
}

/** Ends the live stream, which may still hold a credential that was signed out. */
function endStream(desk: Desk): void {
  const stream = desk.stream
  desk.stream = null
  if (stream !== null) inBackground(stream.return(undefined))
}

async function follow($: Engine, desk: Desk): Promise<void> {
  const command = await commandOf($, desk.options)
  if (desk.stream !== null || command.kind === 'no-node') return
  const after = desk.lastSequence === null ? [] : ['--after', String(desk.lastSequence)]
  const stream = $.process.spawn({
    argv: [...command.argv, ...serverArguments(desk.server), 'stream', '--json', ...after],
  })
  desk.stream = stream
  await update($, connection, () => 'live')
  try {
    for await (const line of linesOf(stream)) {
      if (desk.stream !== stream) break
      await arrived($, desk, line)
    }
  } catch {
    const stopped = (await said($)).streamStopped
    await update($, problem, () => stopped)
  }
  if (desk.stream !== stream) return
  desk.stream = null
  if ((await read($, deskRole)) === 'desk') await update($, connection, () => 'reconnecting')
}

async function arrived($: Engine, desk: Desk, line: string): Promise<void> {
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
    const text = await said($)
    notifyPerson($, text, text.noteArrived(authorIn(parsed.wrapped) ?? text.aColleague))
    await refresh($, desk)
    return draftReply($, desk, body.note.id, parsed.wrapped)
  }
  if (body?.type === 'draft.requested' && body.request !== undefined) {
    const announced = requestIn(body.request)
    const listed = announced === null ? [] : await openRequests($, desk)
    const request = listed.find((one) => one.id === announced?.id) ?? announced
    if (request !== null) await answerRequest($, desk, request)
    return
  }
  const latest = await refresh($, desk)
  if (
    body?.type === 'draft.saved' &&
    latest !== null &&
    latest.drafts.some((draft) => draft.id === body.note?.id)
  ) {
    const text = await said($)
    notifyPerson($, text, text.draftReadyNotice)
  }
  if (body?.type === 'resync') await catchUp($, desk)
  else if (body?.type === 'draft.saved' || body?.type === 'draft.request.changed') {
    const open = await openRequests($, desk)
    await update($, requests, () => open)
  }
}

async function catchUp($: Engine, desk: Desk): Promise<void> {
  const latest = await read($, overview)
  for (const waiting of latest?.awaiting ?? []) {
    if (latest?.drafts.some((draft) => draft.inReplyTo === waiting.noteId)) continue
    desk.wrappedNotes.set(waiting.noteId, waiting.wrapped)
    await draftReply($, desk, waiting.noteId, waiting.wrapped)
  }
  const open = await openRequests($, desk)
  await update($, requests, () => open)
  for (const request of open) await answerRequest($, desk, request)
}

async function openRequests($: Engine, desk: Desk): Promise<HomingbirdDraftRequest[]> {
  const ran = await runJson($, desk, ['requests'])
  const listed = ran.kind === 'ok' ? (ran.value as { requests?: unknown } | null)?.requests : []
  return (Array.isArray(listed) ? listed : []).flatMap((one) => {
    const request = requestIn(one)
    return request === null || hasDrafts(one) ? [] : [request]
  })
}

async function draftReply($: Engine, desk: Desk, noteId: string, wrappedNote: string): Promise<void> {
  const mode = autoDraftOf(desk.options.autoDraft)
  if (mode === 'off' || desk.handled.has(noteId)) return
  desk.handled.add(noteId)
  await run($, desk, ['pickup', noteId])
  await refresh($, desk)
  const waiting = (await read($, overview))?.awaiting.find((one) => one.noteId === noteId)
  const guidance = await guidanceFor($, desk, waiting?.conversationId)
  if (mode === 'turn')
    return void (await $.prompt.submit({ text: notePromptFor(noteId, wrappedNote, guidance) }))
  const reply = replyIn(await suggestReply($, replyPromptFor(wrappedNote, guidance)))
  if (reply === null) {
    await run($, desk, ['skip', '--', noteId, QUIET_SKIP])
    return void (await refresh($, desk))
  }
  const drafted = await run($, desk, ['draft', '--reply', noteId, '--', reply], await hostEnvOf($))
  if (drafted.kind === 'ok') await refresh($, desk)
}

async function answerRequest($: Engine, desk: Desk, request: HomingbirdDraftRequest): Promise<void> {
  await update($, requests, (open) => [...open.filter((one) => one.id !== request.id), request])
  if (autoDraftOf(desk.options.autoDraft) === 'off' || desk.handled.has(request.id)) return
  desk.handled.add(request.id)
  await refresh($, desk)
  const text = await said($)
  notifyPerson($, text, text.draftingRequest)
  await $.prompt.submit({
    text: requestPromptFor(request, await guidanceFor($, desk, request.conversationId)),
  })
}

async function suggestReply($: Engine, prompt: string): Promise<string> {
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered) return forked.text
  if (forked.reason !== 'nothing-to-fork') return ''
  const fresh = await $.model.complete({ model: await $.session.model(), prompt })
  return fresh.isAnswered ? fresh.text : ''
}

function notifyPerson($: Engine, words: PaneText, text: string): void {
  $.ui.toast(words.toast(text))
  inBackground($.ui.notify(text, { title: 'Homingbird' }))
}

async function showCounts($: Engine, latest: HomingbirdOverview | null): Promise<void> {
  const waiting = latest?.drafts.length ?? 0
  const isDesk = (await read($, deskRole)) === 'desk'
  $.ui.status(isDesk ? (await textFor($, latest)).deskStatus(waiting) : undefined)
  const isOpen = (await $.ui.panes()).some((pane) => pane.id === PANE)
  if (isOpen) await $.ui.open({ id: PANE, title: paneTitleFor(waiting) })
}

async function settle($: Engine, message: string, isUnavailable: boolean): Promise<null> {
  if (isUnavailable) await update($, connection, () => 'unavailable')
  await update($, problem, () => message)
  return null
}

async function* linesOf(
  stream: AsyncIterable<{ stream: string; text: string }>,
  errors: string[] = [],
): AsyncGenerator<string> {
  let unread = ''
  for await (const chunk of stream) {
    if (chunk.stream === 'stderr') errors.push(chunk.text)
    if (chunk.stream !== 'stdout') continue
    const lines = (unread + chunk.text).split('\n')
    unread = lines.pop() ?? ''
    yield* lines
  }
}

interface StreamLine {
  readonly event?: {
    readonly seq?: unknown
    readonly body?: {
      readonly type?: string
      readonly note?: { readonly id?: unknown }
      readonly request?: unknown
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
  }
}

/**
 * The answering flow and principles for one conversation, so a channel's principles come first as with
 * the runner and MCP; the overview's general guidance when the conversation is not known.
 */
async function guidanceFor($: Engine, desk: Desk, conversationId: string | undefined): Promise<string> {
  if (conversationId === undefined) return desk.answeringFlow
  const ran = await runJson($, desk, ['guidance', conversationId])
  const guidance = ran.kind === 'ok' ? (ran.value as { guidance?: unknown } | null)?.guidance : undefined
  return typeof guidance === 'string' ? guidance : desk.answeringFlow
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
