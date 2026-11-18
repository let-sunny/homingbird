import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, ResolveInput } from 'claude-code'

import type {
  HomingbirdConnection,
  HomingbirdConversation,
  HomingbirdDraft,
  HomingbirdDraftRequest,
  HomingbirdOverview,
} from '../types'
import { bodyOf } from './drafting'
import { type PaneText, textFor } from './pane-text'
import { PIP, PIP_COLUMNS, PIP_PIXELS, PIP_ROWS, type PipState } from './pip'

export async function renderPane(
  $: EngineInterface,
  e: ResolveInput,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text } = $.ui.resolve(e)
  const state = await read($, connection)
  const role = await read($, desk)
  const latest = await read($, overview)
  const trouble = await read($, problem)
  const pending = await read($, signIn)
  const open = await read($, requests)
  const text = await paneTextFor($, latest)
  const waiting = latest?.drafts.length ?? 0
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        {pip($, e, pipStateFor(state, latest, pending !== null))}
        <Box flexDirection="column">
          <Text bold>Homingbird{waiting > 0 ? ` · ${text.waiting(waiting)}` : ''}</Text>
          <Text dimColor>{text.connection[state]}</Text>
        </Box>
      </Box>
      {role === 'desk' && <Text color="warning">{text.keepOpen}</Text>}
      {role === 'moved' && movedRows($, e, text, actions)}
      {trouble !== null && <Text color="error">{trouble}</Text>}
      {latest === null
        ? await signInRows($, e, text, actions)
        : await overviewRows($, e, text, latest, open, actions)}
    </Box>
  )
}

export interface PaneActions {
  readonly defaultServer: string
  readonly signIn: (server: string) => void
  readonly becomeDesk: () => Promise<void>
  readonly approve: (draftId: string, editedBody: string | null) => Promise<void>
  readonly discard: (draftId: string) => Promise<void>
}

export const paneTitleFor = (waiting: number): string =>
  waiting > 0 ? `Homingbird (${waiting})` : 'Homingbird'

export const PANE = 'homingbird'

function paneTextFor($: EngineInterface, latest: HomingbirdOverview | null): Promise<PaneText> {
  return textFor($, latest)
}

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
  if (latest.drafts.length > 0) return 'awaitingApproval'
  if (latest.awaiting.length > 0) return 'newNote'
  return 'idle'
}

function movedRows($: EngineInterface, e: ResolveInput, text: PaneText, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text>{text.moved}</Text>
      <Button key="become-desk" label={text.becomeDesk} onPress={() => void actions.becomeDesk()} />
    </Box>
  )
}

async function signInRows(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
  const pending = await read($, signIn)
  if (pending !== null)
    return (
      <Box flexDirection="column">
        <Text>{text.confirmSignIn}</Text>
        <Link href={pending.verificationUri}>{text.openSignInPage}</Link>
        <Text dimColor>{text.signInCode(pending.userCode)}</Text>
      </Box>
    )
  return (
    <Box flexDirection="column">
      <Text>{text.signInPrompt}</Text>
      {actions.defaultServer === '' ? (
        <Input
          key="server"
          label={text.serverUrl}
          placeholder="https://homingbird.example.com"
          submitLabel={text.signIn}
          onSubmit={(server) => actions.signIn(server.trim())}
        />
      ) : (
        <Button
          key="sign-in"
          label={text.signIn}
          variant="primary"
          onPress={() => actions.signIn(actions.defaultServer)}
        />
      )}
    </Box>
  )
}

async function overviewRows(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  latest: HomingbirdOverview,
  open: ReadonlyArray<HomingbirdDraftRequest>,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text } = $.ui.resolve(e)
  const edited = await read($, editing)
  const drafted = new Set(latest.drafts.map((draft) => draft.inReplyTo))
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>{text.memberOn(latest.memberName, latest.server)}</Text>
      <Box flexDirection="column">
        <Text bold>{text.draftsWaiting}</Text>
        {!hasApproveButton(latest) && <Text dimColor>{text.approveInWebClient}</Text>}
        {latest.drafts.length === 0 && <Text dimColor>{text.none}</Text>}
        {latest.drafts.map((draft) => draftRow($, e, text, latest, draft, edited === draft.id, actions))}
      </Box>
      <Box flexDirection="column">
        <Text bold>{text.notesWaiting}</Text>
        {latest.awaiting.length === 0 && open.length === 0 && <Text dimColor>{text.none}</Text>}
        {latest.awaiting.map((waiting) => (
          <Box key={`waiting:${waiting.noteId}`}>
            <Text wrap="truncate-end">
              {waiting.from.name}: {firstLine(bodyOf(waiting.wrapped))}
              <Text dimColor> · {drafted.has(waiting.noteId) ? text.draftReady : text.drafting}</Text>
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
    </Box>
  )
}

function draftRow(
  $: EngineInterface,
  e: ResolveInput,
  text: PaneText,
  latest: HomingbirdOverview,
  draft: HomingbirdDraft,
  isEditing: boolean,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
  return (
    <Box key={`draft:${draft.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
      <Text dimColor>{draftHeading(text, draft)}</Text>
      {isEditing ? (
        <Input
          key={`edit:${draft.id}`}
          label={text.editThenSend}
          value={draft.body}
          rows={4}
          submitLabel={text.send}
          onSubmit={(body) => void actions.approve(draft.id, body)}
        />
      ) : (
        <Text>{draft.body}</Text>
      )}
      {hasApproveButton(latest) ? (
        <Box flexDirection="row" gap={1}>
          {!isEditing && (
            <Button
              key={`approve:${draft.id}`}
              label={text.approve}
              variant="primary"
              onPress={() => void actions.approve(draft.id, null)}
            />
          )}
          <Button
            key={`edit-toggle:${draft.id}`}
            label={isEditing ? text.cancel : text.edit}
            onPress={() => void update($, editing, () => (isEditing ? null : draft.id))}
          />
          <Button
            key={`discard:${draft.id}`}
            label={text.discard}
            onPress={() => void actions.discard(draft.id)}
          />
        </Box>
      ) : (
        <Link href={conversationUrl(latest.server, draft.conversationId)}>{text.openInWebClient}</Link>
      )}
    </Box>
  )
}

const hasApproveButton = (latest: HomingbirdOverview): boolean =>
  latest.hasApproveButton && latest.approveButtonAllowed === true

const conversationUrl = (server: string, conversationId: string): string =>
  `${server.replace(/\/+$/, '')}/#/c/${encodeURIComponent(conversationId)}`

const draftHeading = (text: PaneText, draft: HomingbirdDraft): string => {
  if (draft.agentName === null) return draft.inReplyTo === null ? text.newNote : text.reply
  return draft.inReplyTo === null ? text.newNoteBy(draft.agentName) : text.replyBy(draft.agentName)
}

const conversationName = (conversation: HomingbirdConversation): string => {
  if (conversation.kind !== 'topic') return conversation.with
  const name = conversation.title ?? conversation.with
  return name.startsWith('#') ? name : `#${name}`
}

const firstLine = (text: string): string => text.split('\n')[0] ?? ''

const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'idle')
const desk = atom({ plugin: 'homingbird', key: 'desk' } as const, 'not-desk')
const editing = atom({ plugin: 'homingbird', key: 'editing' } as const, null)
const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null, { shape: 'overview-2' })
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)
const requests = atom({ plugin: 'homingbird', key: 'requests' } as const, [], { shape: 'requests-2' })
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
