import { atom, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { HomingbirdOverview } from '../types'
import { commandOf, lastJsonLine, run, runJson } from './command-line'
import { autoDraftOf, replyIn, replyPromptFor, turnPromptFor } from './drafting'
import { forbiddenReason } from './guard'
import { PANE, renderPane } from './pane'
import { NOTE_TOOLS, wireNameOf } from './tools'

export const register: Register = (on, options) => {
  const context: Context = { options, isFollowing: false, handled: new Set<string>() }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'homingbird', description: 'Open the Homingbird pane' })
    for (const tool of NOTE_TOOLS) await $.tool.register(tool.spec)
    const started = await next(e)
    void $.ui.open({ id: PANE, title: 'Homingbird' })
    void connect($, context)
    $.clock.every(POLL_MS, () => void (context.isFollowing ? refresh($, context) : connect($, context)))
    return started
  })

  on('command.run', { command: 'homingbird' }, async ($) => {
    await $.ui.open({ id: PANE, title: 'Homingbird', focus: true })
    void refresh($, context)
    return { text: 'Homingbird pane opened.' }
  })

  on('tool.call', ($, e, next) => {
    const reason = forbiddenReason(String(e.tool), e)
    return reason === null ? next(e) : { deny: reason }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'homingbird: its guard failed, so the call was refused.' }))

  on('tool.run', { tool: /^mcp__homingbird__/ }, async ($, e, next) => {
    const tool = NOTE_TOOLS.find((one) => wireNameOf(one) === String(e.tool))
    if (tool === undefined) return next(e)
    const ran = await run($, options, tool.argumentsFor(e as unknown as Record<string, unknown>))
    const latest = await refresh($, context)
    if (ran.kind === 'ok' && tool.spec.name.startsWith('draft_') && latest !== null) $.ui.toast(DRAFT_WAITING)
    return ran.kind === 'ok'
      ? { result: ran.text }
      : { result: ran.kind === 'signed-out' ? SIGNED_OUT : ran.message, isError: true }
  }).catch(() => ({ result: 'homingbird: the tool failed before it could answer.', isError: true }))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    renderPane($, e, {
      defaultServer: String(options.server ?? ''),
      connect: (server) => startSignIn($, context, server),
      approve: (draftId, editedBody) =>
        decide($, context, editedBody === null ? ['approve', draftId] : ['approve', draftId, '--body', editedBody]),
      discard: (draftId) => decide($, context, ['discard', draftId]),
    }),
  )
}

type Engine = EngineInterface

const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null)
const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'starting')
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
const editing = atom({ plugin: 'homingbird', key: 'editing' } as const, null)
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)

interface Context {
  readonly options: PluginOptions
  isFollowing: boolean
  readonly handled: Set<string>
}

const refresh = async ($: Engine, context: Context): Promise<HomingbirdOverview | null> => {
  const ran = await runJson($, context.options, ['overview'])
  if (ran.kind === 'unavailable') return settle($, context, 'unavailable', ran.message)
  if (ran.kind === 'failed') return settle($, context, context.isFollowing ? 'live' : 'polling', ran.message)
  const latest = ran.kind === 'ok' ? overviewIn(ran.value) : null
  await update($, overview, () => latest)
  await update($, problem, () => null)
  await update($, connection, () => (latest === null ? 'signed-out' : context.isFollowing ? 'live' : 'polling'))
  $.ui.status(latest !== null && latest.drafts.length > 0 ? waitingLabel(latest.drafts.length) : undefined)
  return latest
}

const settle = async ($: Engine, context: Context, state: 'unavailable' | 'live' | 'polling', message: string): Promise<null> => {
  await update($, connection, () => state)
  await update($, problem, () => message)
  return null
}

const connect = async ($: Engine, context: Context): Promise<void> => {
  const latest = await refresh($, context)
  if (latest === null) return
  for (const waiting of latest.awaiting) void draftReply($, context, waiting.noteId, waiting.wrapped)
  void follow($, context)
}

const follow = async ($: Engine, context: Context): Promise<void> => {
  if (context.isFollowing) return
  context.isFollowing = true
  await update($, connection, () => 'live')
  try {
    let unread = ''
    for await (const chunk of $.process.spawn({ argv: [...commandOf(context.options), 'stream', '--json'] })) {
      if (chunk.stream !== 'stdout') continue
      const lines = (unread + chunk.text).split('\n')
      unread = lines.pop() ?? ''
      for (const line of lines) await arrived($, context, line)
    }
  } catch {
    await update($, problem, () => 'The live stream stopped; checking every half minute instead.')
  }
  context.isFollowing = false
  await update($, connection, () => 'polling')
}

const arrived = async ($: Engine, context: Context, line: string): Promise<void> => {
  const parsed = lastJsonLine(line) as { event?: { body?: { type?: string; note?: { id?: string } } }; wrapped?: string } | null
  const noteId = parsed?.event?.body?.note?.id
  if (parsed?.event?.body?.type === 'note.sent' && typeof parsed.wrapped === 'string' && typeof noteId === 'string')
    void draftReply($, context, noteId, parsed.wrapped)
  await refresh($, context)
}

const draftReply = async ($: Engine, context: Context, noteId: string, wrappedNote: string): Promise<void> => {
  const mode = autoDraftOf(context.options.autoDraft)
  if (mode === 'off' || context.handled.has(noteId)) return
  context.handled.add(noteId)
  await run($, context.options, ['pickup', noteId])
  if (mode === 'turn') return void (await $.prompt.submit({ text: turnPromptFor(noteId, wrappedNote) }))
  const reply = replyIn(await suggestReply($, replyPromptFor(wrappedNote)))
  if (reply === null) return
  const drafted = await run($, context.options, ['draft', '--reply', noteId, '--', reply])
  if (drafted.kind !== 'ok') return
  await refresh($, context)
  $.ui.toast(DRAFT_WAITING)
}

const suggestReply = async ($: Engine, prompt: string): Promise<string> => {
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered) return forked.text
  if (forked.reason !== 'nothing-to-fork') return ''
  const fresh = await $.model.complete({ model: await $.session.model(), prompt })
  return fresh.isAnswered ? fresh.text : ''
}

const startSignIn = async ($: Engine, context: Context, server: string): Promise<void> => {
  await update($, problem, () => null)
  try {
    let unread = ''
    const argv = [...commandOf(context.options), 'login', '--server', server, '--approve-button', '--json']
    for await (const chunk of $.process.spawn({ argv })) {
      if (chunk.stream === 'stderr') await update($, problem, () => chunk.text.trim().split('\n')[0] ?? null)
      if (chunk.stream !== 'stdout') continue
      const lines = (unread + chunk.text).split('\n')
      unread = lines.pop() ?? ''
      for (const line of lines) {
        const step = lastJsonLine(line) as { step?: string; verificationUri?: string; userCode?: string } | null
        if (step?.step === 'awaiting_approval' && step.verificationUri && step.userCode)
          await update($, signIn, () => ({ verificationUri: step.verificationUri!, userCode: step.userCode! }))
      }
    }
  } catch (cause) {
    await update($, problem, () => `Could not start signing in: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  await update($, signIn, () => null)
  await connect($, context)
}

const decide = async ($: Engine, context: Context, args: ReadonlyArray<string>): Promise<void> => {
  const ran = await runJson($, context.options, args)
  await update($, editing, () => null)
  if (ran.kind === 'failed' || ran.kind === 'unavailable') await update($, problem, () => ran.message)
  if (ran.kind === 'signed-out') await update($, problem, () => NO_APPROVE_BUTTON)
  await refresh($, context)
}

const POLL_MS = 30_000
const DRAFT_WAITING = 'Homingbird: a reply draft is waiting for your approval.'
const SIGNED_OUT = 'Homingbird is not connected. Ask the person to press Connect in the Homingbird pane.'
const NO_APPROVE_BUTTON = 'This device has no approve button. Approve in the Homingbird web client.'

const waitingLabel = (count: number): string =>
  `Homingbird: ${count} ${count === 1 ? 'draft' : 'drafts'} waiting for approval`

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
