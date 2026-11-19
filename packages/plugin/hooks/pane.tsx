import { atom, read } from 'claude-code'
import type { EngineInterface, RenderElement, ResolveInput } from 'claude-code'

import type {
  HomingbirdAwaiting,
  HomingbirdConnection,
  HomingbirdConversation,
  HomingbirdDraft,
  HomingbirdDraftRequest,
  HomingbirdOverview,
} from '../types'
import { wrappedBodyOf } from './drafting'
import { host } from './effects'
import { T } from './kernel.mjs'
import { type PaneText, textFor } from './pane-text'
import { PIP, PIP_COLUMNS, PIP_PIXELS, PIP_ROWS, type PipState } from './pip'
import { freshStartReasonOf, sessionHealthOf } from './session-health'

export function renderPane($: EngineInterface, e: ResolveInput, actions: PaneActions): T.Task<RenderElement> {
  return T.gen(function* () {
    const { Box, Text } = $.ui.resolve(e)
    const state = yield* host(() => read($, connection))
    const role = yield* host(() => read($, desk))
    const latest = yield* host(() => read($, overview))
    const trouble = yield* host(() => read($, problem))
    const pending = yield* host(() => read($, signIn))
    const open = yield* host(() => read($, requests))
    const text = yield* textFor($, latest)
    const health = role === 'desk' ? yield* sessionHealthOf($) : null
    const freshStart = freshStartReasonOf(health)
    const waiting = draftsWaitingIn(latest)
    const rows =
      latest === null
        ? yield* signInRows($, e, text, actions)
        : yield* overviewRows($, e, text, latest, open, actions)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {pip($, e, pipStateFor(state, latest, pending !== null))}
          <Box flexDirection="column">
            <Text bold>Homingbird{waiting > 0 ? ` · ${text.waiting(waiting)}` : ''}</Text>
            <Text dimColor>{text.connection[state]}</Text>
          </Box>
        </Box>
        {actions.isHostTooOld() && <Text color="warning">{text.hostTooOld}</Text>}
        {role === 'desk' && <Text color="warning">{text.keepOpen}</Text>}
        {health !== null && (
          <Text dimColor>{text.sessionFigures(health.ageMinutes, health.contextPercent)}</Text>
        )}
        {freshStart !== null && <Text color="warning">{text.freshSession(freshStart)}</Text>}
        {role === 'moved' && movedRows($, e, text, actions)}
        {trouble !== null && <Text color="error">{trouble}</Text>}
        {rows}
      </Box>
    )
  })
}

export interface PaneActions {
  readonly server: () => string
  readonly signIn: (server: string) => void
  readonly useServer: (typed: string) => void
  readonly becomeDesk: () => void
  readonly signOut: () => void
  /** True when this Claude Code is too old for the tools and the desk; the pane still works. */
  readonly isHostTooOld: () => boolean
}

export const paneTitleFor = (waiting: number): string =>
  waiting > 0 ? `Homingbird (${waiting})` : 'Homingbird'

/** The one count of waiting drafts that the title, the heading and the status line all show. */
export const draftsWaitingIn = (latest: HomingbirdOverview | null): number => latest?.drafts.length ?? 0

/** The notes waiting for a reply that no draft answers yet; a drafted one is listed with the drafts. */
export const notesAwaitingDraftIn = (latest: HomingbirdOverview | null): HomingbirdAwaiting[] => {
  const drafted = new Set(latest?.drafts.map((draft) => draft.inReplyTo) ?? [])
  return (latest?.awaiting ?? []).filter((waiting) => !drafted.has(waiting.noteId))
}

export const PANE = 'homingbird'

function pip($: EngineInterface, e: ResolveInput, state: PipState): RenderElement | null {
  if (e.surface === 'terminal') {
    const { Image } = $.ui.resolve(e)
    return (
      <Image key="pip" source={{ png: PIP[state].png }} columns={PIP_COLUMNS} rows={PIP_ROWS} alt="Pip" />
    )
  }
  const { Svg } = $.ui.resolve(e as ResolveInput & { surface: 'desktop' })
  return <Svg source={PIP[state].svg} alt="Pip" width={PIP_PIXELS} height={PIP_PIXELS} />
}

const pipStateFor = (
  state: HomingbirdConnection,
  latest: HomingbirdOverview | null,
  isSigningIn: boolean,
): PipState => {
  if (isSigningIn || state === 'signed-out') return 'signIn'
  if (state === 'starting' || state === 'reconnecting') return 'connecting'
  if (latest === null || state === 'unavailable' || state === 'idle') return 'offline'
  if (draftsWaitingIn(latest) > 0) return 'awaitingApproval'
  if (notesAwaitingDraftIn(latest).length > 0) return 'newNote'
  return 'idle'
}

function movedRows($: EngineInterface, e: ResolveInput, text: PaneText, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text>{text.moved}</Text>
      <Button key="become-desk" label={text.becomeDesk} onPress={() => actions.becomeDesk()} />
    </Box>
  )
}

function signInRows(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  actions: PaneActions,
): T.Task<RenderElement> {
  return T.gen(function* () {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const pending = yield* host(() => read($, signIn))
    const server = actions.server()
    if (pending === null && server === '') return yield* firstRunRows($, e, text, actions)
    if (pending !== null)
      return (
        <Box flexDirection="column">
          <Text>{text.waitingForApproval}</Text>
          <Text>{text.confirmSignIn}</Text>
          <Link href={pending.verificationUri}>{text.openSignInPage}</Link>
          <Text dimColor>{text.signInCode(pending.userCode)}</Text>
        </Box>
      )
    const failed = (yield* host(() => read($, problem))) !== null
    return (
      <Box flexDirection="column">
        <Text>{text.signInPrompt}</Text>
        <Box flexDirection="row" gap={1}>
          <Button
            key="sign-in"
            label={failed ? text.tryAgain : text.signInTo(hostOf(server))}
            variant="primary"
            onPress={() => actions.signIn(server)}
          />
          <Link href={server}>{text.openWeb}</Link>
        </Box>
        <Text dimColor>{text.changeServer}</Text>
      </Box>
    )
  })
}

function firstRunRows(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  actions: PaneActions,
): T.Task<RenderElement> {
  return T.gen(function* () {
    const { Box, Text, Input } = $.ui.resolve(e)
    const isChecking = yield* host(() => read($, checkingServer))
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{text.serverHeading}</Text>
        <Text>{text.serverHelp}</Text>
        <Text dimColor>{text.serverUsuallySet}</Text>
        <Input
          key="server"
          label={text.serverUrl}
          placeholder="https://homingbird.example.com"
          submitLabel={text.useServer}
          autoFocus
          onSubmit={(typed) => actions.useServer(typed)}
        />
        {isChecking ? (
          <Text dimColor>{text.checkingServer}</Text>
        ) : (
          <Text dimColor>{text.serverByCommand}</Text>
        )}
      </Box>
    )
  })
}

function overviewRows(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  latest: HomingbirdOverview,
  open: ReadonlyArray<HomingbirdDraftRequest>,
  actions: PaneActions,
): T.Task<RenderElement> {
  return T.sync(() => {
    const { Box, Text, Link, Button } = $.ui.resolve(e)
    const undrafted = notesAwaitingDraftIn(latest)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{text.memberOn(latest.memberName, latest.server)}</Text>
          <Link href={latest.server}>{text.openWeb}</Link>
          <Button key="sign-out" label={text.signOut} onPress={() => actions.signOut()} />
        </Box>
        <Box flexDirection="column">
          <Text bold>{text.draftsWaiting}</Text>
          <Text dimColor>{text.approveInWebClient}</Text>
          {latest.drafts.length === 0 && <Text dimColor>{text.none}</Text>}
          {latest.drafts.map((draft) => draftRow($, e, text, latest, draft))}
        </Box>
        <Box flexDirection="column">
          <Text bold>{text.notesWaiting}</Text>
          {undrafted.length === 0 && open.length === 0 && <Text dimColor>{text.none}</Text>}
          {undrafted.map((waiting) => (
            <Box key={`waiting:${waiting.noteId}`} flexDirection="row" gap={1}>
              <Text dimColor>{text.drafting} ·</Text>
              <Text wrap="truncate-end">
                {waiting.from.name}: {firstLine(wrappedBodyOf(waiting.wrapped))}
              </Text>
            </Box>
          ))}
          {open.map((request) => (
            <Box key={`request:${request.id}`}>
              <Text wrap="truncate-end" dimColor>
                {request.instruction === ''
                  ? text.askedForDraft
                  : text.askedForDraftWith(firstLine(request.instruction))}
              </Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text bold>{text.conversations}</Text>
          {latest.conversations.length === 0 && <Text dimColor>{text.noneYet}</Text>}
          {latest.conversations.map((conversation) => (
            <Box key={`conversation:${conversation.id}`}>
              <Text wrap="truncate-end">
                {conversationName(conversation)}
                {conversation.unreadCount > 0 ? ` · ${text.unread(conversation.unreadCount)}` : ''}
              </Text>
            </Box>
          ))}
        </Box>
        <Text dimColor>{text.changeServer}</Text>
      </Box>
    )
  })
}

function draftRow(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  latest: HomingbirdOverview,
  draft: HomingbirdDraft,
): RenderElement {
  const { Box, Text, Link } = $.ui.resolve(e)
  const answered = latest.awaiting.find((waiting) => waiting.noteId === draft.inReplyTo)
  return (
    <Box key={`draft:${draft.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
      <Text dimColor>{draftHeading(text, draft)}</Text>
      {answered !== undefined && (
        <Text dimColor wrap="truncate-end">
          {text.inReplyTo(answered.from.name, firstLine(wrappedBodyOf(answered.wrapped)))}
        </Text>
      )}
      <Text>{draft.body}</Text>
      <Box flexDirection="row" gap={1}>
        <Text color="warning">{text.awaitingYourApproval}</Text>
        <Link href={conversationUrl(latest.server, draft.conversationId)}>{text.openInWebClient}</Link>
      </Box>
    </Box>
  )
}

const hostOf = (server: string): string => server.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

const conversationUrl = (server: string, conversationId: string): string =>
  `${server.replace(/\/+$/, '')}/#/c/${encodeURIComponent(conversationId)}`

const draftHeading = (text: PaneText, draft: HomingbirdDraft): string => {
  if (draft.agentName === null) return draft.inReplyTo === null ? text.newNote : text.reply
  return draft.inReplyTo === null ? text.newNoteBy(draft.agentName) : text.replyBy(draft.agentName)
}

const conversationName = (conversation: HomingbirdConversation): string => {
  if (conversation.kind !== 'channel') return conversation.with
  const name = conversation.title ?? conversation.with
  return name.startsWith('#') ? name : `#${name}`
}

const firstLine = (text: string): string => text.split('\n')[0] ?? ''

const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'idle')
const desk = atom({ plugin: 'homingbird', key: 'desk' } as const, 'not-desk')
const checkingServer = atom({ plugin: 'homingbird', key: 'checkingServer' } as const, false)
const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null, { shape: 'overview-3' })
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)
const requests = atom({ plugin: 'homingbird', key: 'requests' } as const, [], { shape: 'requests-2' })
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
