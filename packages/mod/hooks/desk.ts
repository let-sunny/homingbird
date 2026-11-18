import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions } from 'claude-code'

import type { HomingbirdDraftRequest, HomingbirdOverview } from '../types'
import { commandOf, lastJsonLine, run, runJson } from './command-line'
import { autoDraftOf, notePromptFor, replyIn, replyPromptFor, requestPromptFor } from './drafting'
import { PANE, paneTitleFor } from './pane'

export interface Desk {
  readonly options: PluginOptions
  readonly handled: Set<string>
  readonly wrappedNotes: Map<string, string>
  readonly helpers: Map<string, string>
  stream: AsyncGenerator<unknown, unknown> | null
  heartbeat: { readonly cancel: () => void } | null
  lastSequence: number | null
}

export const makeDesk = (options: PluginOptions): Desk => ({
  options,
  handled: new Set(),
  wrappedNotes: new Map(),
  helpers: new Map(),
  stream: null,
  heartbeat: null,
  lastSequence: null,
})

export async function openDesk($: Engine, desk: Desk): Promise<void> {
  await update($, problem, () => null)
  const latest = await refresh($, desk)
  if (latest !== null) return claimDesk($, desk)
  const server = String(desk.options.server ?? '').trim()
  if ((await read($, connection)) === 'signed-out' && server !== '')
    inBackground(beginSignIn($, desk, server))
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
  inBackground(follow($, desk))
  await catchUp($, desk)
}

export async function beginSignIn($: Engine, desk: Desk, server: string): Promise<void> {
  await update($, problem, () => null)
  try {
    for await (const line of linesOf($.process.spawn({ argv: loginArgv(desk, server) }))) {
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
    await update(
      $,
      problem,
      () => `Could not sign in: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  await update($, signIn, () => null)
  if ((await refresh($, desk)) !== null) await claimDesk($, desk)
}

export async function decide($: Engine, desk: Desk, args: ReadonlyArray<string>): Promise<void> {
  const ran = await runJson($, desk.options, args)
  await update($, editing, () => null)
  if (ran.kind === 'signed-out') await update($, problem, () => NO_APPROVE_BUTTON)
  else if (ran.kind !== 'ok') await update($, problem, () => ran.message)
  await refresh($, desk)
}

export async function refresh($: Engine, desk: Desk): Promise<HomingbirdOverview | null> {
  const ran = await runJson($, desk.options, ['overview'])
  if (ran.kind === 'unavailable') return settle($, ran.message, true)
  if (ran.kind !== 'ok' && ran.kind !== 'signed-out') return settle($, ran.message, false)
  const latest = ran.kind === 'ok' ? overviewIn(ran.value) : null
  await update($, overview, () => latest)
  await update($, problem, () => null)
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

export const inBackground = (work: Promise<unknown>): void => {
  work.catch(() => undefined)
}

export const DESK_KEY = 'desk'

type Engine = EngineInterface

async function holdsDesk($: Engine): Promise<boolean> {
  const claim = (await $.store.get(DESK_KEY)) as { sessionId?: unknown } | undefined
  return claim?.sessionId === (await $.session.id())
}

async function checkIn($: Engine, desk: Desk): Promise<void> {
  if (!(await holdsDesk($))) return standDown($, desk)
  await refresh($, desk)
  if (desk.stream === null) inBackground(follow($, desk))
}

async function standDown($: Engine, desk: Desk): Promise<void> {
  desk.heartbeat?.cancel()
  desk.heartbeat = null
  const stream = desk.stream
  desk.stream = null
  if (stream !== null) inBackground(stream.return(undefined))
  await update($, deskRole, () => 'moved')
  await update($, connection, () => 'idle')
  $.ui.status(undefined)
}

async function follow($: Engine, desk: Desk): Promise<void> {
  if (desk.stream !== null) return
  const after = desk.lastSequence === null ? [] : ['--after', String(desk.lastSequence)]
  const stream = $.process.spawn({ argv: [...commandOf(desk.options), 'stream', '--json', ...after] })
  desk.stream = stream
  await update($, connection, () => 'live')
  try {
    for await (const line of linesOf(stream)) {
      if (desk.stream !== stream) break
      await arrived($, desk, line)
    }
  } catch {
    await update($, problem, () => 'The live stream stopped. Reconnecting in half a minute.')
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
    notifyPerson($, `A note from ${authorIn(parsed.wrapped)} arrived. Drafting a reply.`)
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
  )
    notifyPerson($, 'A draft is ready for your approval in the Homingbird pane.')
  if (body?.type === 'resync') await catchUp($, desk)
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
  const ran = await runJson($, desk.options, ['requests'])
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
  await run($, desk.options, ['pickup', noteId])
  if (mode === 'turn') return void (await $.prompt.submit({ text: notePromptFor(noteId, wrappedNote) }))
  const reply = replyIn(await suggestReply($, replyPromptFor(wrappedNote)))
  if (reply === null) return
  const drafted = await run($, desk.options, ['draft', '--reply', noteId, '--', reply])
  if (drafted.kind === 'ok') await refresh($, desk)
}

async function answerRequest($: Engine, desk: Desk, request: HomingbirdDraftRequest): Promise<void> {
  await update($, requests, (open) => [...open.filter((one) => one.id !== request.id), request])
  if (autoDraftOf(desk.options.autoDraft) === 'off' || desk.handled.has(request.id)) return
  desk.handled.add(request.id)
  notifyPerson($, 'Drafting what you asked for.')
  await $.prompt.submit({ text: requestPromptFor(request) })
}

async function suggestReply($: Engine, prompt: string): Promise<string> {
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered) return forked.text
  if (forked.reason !== 'nothing-to-fork') return ''
  const fresh = await $.model.complete({ model: await $.session.model(), prompt })
  return fresh.isAnswered ? fresh.text : ''
}

function notifyPerson($: Engine, text: string): void {
  $.ui.toast(`Homingbird: ${text}`)
  inBackground($.ui.notify(text, { title: 'Homingbird' }))
}

async function showCounts($: Engine, latest: HomingbirdOverview | null): Promise<void> {
  const waiting = latest?.drafts.length ?? 0
  const isDesk = (await read($, deskRole)) === 'desk'
  $.ui.status(isDesk ? `Homingbird desk${waiting > 0 ? ` · ${waitingLabel(waiting)}` : ''}` : undefined)
  const isOpen = (await $.ui.panes()).some((pane) => pane.id === PANE)
  if (isOpen) await $.ui.open({ id: PANE, title: paneTitleFor(waiting) })
}

async function settle($: Engine, message: string, isUnavailable: boolean): Promise<null> {
  if (isUnavailable) await update($, connection, () => 'unavailable')
  await update($, problem, () => message)
  return null
}

const loginArgv = (desk: Desk, server: string): string[] => [
  ...commandOf(desk.options),
  'login',
  '--server',
  server,
  '--approve-button',
  '--json',
]

async function* linesOf(stream: AsyncIterable<{ stream: string; text: string }>): AsyncGenerator<string> {
  let unread = ''
  for await (const chunk of stream) {
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
    hasApproveButton: data.hasApproveButton === true,
    conversations: data.conversations ?? [],
    awaiting: data.awaiting ?? [],
    drafts: data.drafts ?? [],
  }
}

const authorIn = (wrappedNote: string): string => {
  const from = /^<colleague-note [^>]*from="([^"&]*)/.exec(wrappedNote)?.[1]?.trim()
  return from === undefined || from === '' ? 'a colleague' : from
}

const waitingLabel = (count: number): string =>
  `${count} ${count === 1 ? 'draft' : 'drafts'} waiting for approval`

const HEARTBEAT_MS = 30_000

const NO_APPROVE_BUTTON = 'This device has no approve button. Approve in the Homingbird web client.'

const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'idle')
const deskRole = atom({ plugin: 'homingbird', key: 'desk' } as const, 'not-desk')
const editing = atom({ plugin: 'homingbird', key: 'editing' } as const, null)
const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null, { shape: 'overview-2' })
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)
const requests = atom({ plugin: 'homingbird', key: 'requests' } as const, [], { shape: 'requests-2' })
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
