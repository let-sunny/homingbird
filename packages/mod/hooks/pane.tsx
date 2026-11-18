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
  const waiting = latest?.drafts.length ?? 0
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        {pip($, e, pipStateFor(state, latest, pending !== null))}
        <Box flexDirection="column">
          <Text bold>Homingbird{waiting > 0 ? ` · ${waiting} waiting` : ''}</Text>
          <Text dimColor>{CONNECTION_LABELS[state]}</Text>
        </Box>
      </Box>
      {role === 'desk' && <Text color="warning">{KEEP_OPEN}</Text>}
      {role === 'moved' && movedRows($, e, actions)}
      {trouble !== null && <Text color="error">{trouble}</Text>}
      {latest === null ? await signInRows($, e, actions) : await overviewRows($, e, latest, open, actions)}
    </Box>
  )
}

export interface PaneActions {
  readonly defaultServer: string
  readonly signIn: (server: string) => Promise<void>
  readonly becomeDesk: () => Promise<void>
  readonly approve: (draftId: string, editedBody: string | null) => Promise<void>
  readonly discard: (draftId: string) => Promise<void>
}

export const paneTitleFor = (waiting: number): string =>
  waiting > 0 ? `Homingbird (${waiting})` : 'Homingbird'

export const PANE = 'homingbird'

export const KEEP_OPEN = 'Keep this session open for Homingbird.'

const CONNECTION_LABELS: Readonly<Record<HomingbirdConnection, string>> = {
  idle: 'not the desk',
  starting: 'starting',
  live: 'desk · live',
  reconnecting: 'desk · reconnecting',
  'signed-out': 'not signed in',
  unavailable: 'command line not found',
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

function movedRows($: EngineInterface, e: ResolveInput, actions: PaneActions): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text>Another session is your Homingbird desk now. This one no longer reacts to notes.</Text>
      <Button key="become-desk" label="Make this the desk" onPress={() => void actions.becomeDesk()} />
    </Box>
  )
}

async function signInRows(
  $: EngineInterface,
  e: ResolveInput,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
  const pending = await read($, signIn)
  if (pending !== null)
    return (
      <Box flexDirection="column">
        <Text>Confirm the sign-in in your browser. If it did not open:</Text>
        <Link href={pending.verificationUri}>Open the sign-in page</Link>
        <Text dimColor>
          Code {pending.userCode}. Keep "approve button" ticked to approve notes from this pane.
        </Text>
      </Box>
    )
  return (
    <Box flexDirection="column">
      <Text>Sign in to your organization's Homingbird server to make this session your desk.</Text>
      {actions.defaultServer === '' ? (
        <Input
          key="server"
          label="Server URL"
          placeholder="https://homingbird.example.com"
          submitLabel="Sign in"
          onSubmit={(server) => void actions.signIn(server.trim())}
        />
      ) : (
        <Button
          key="sign-in"
          label="Sign in"
          variant="primary"
          onPress={() => void actions.signIn(actions.defaultServer)}
        />
      )}
    </Box>
  )
}

async function overviewRows(
  $: EngineInterface,
  e: ResolveInput,
  latest: HomingbirdOverview,
  open: ReadonlyArray<HomingbirdDraftRequest>,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text } = $.ui.resolve(e)
  const edited = await read($, editing)
  const drafted = new Set(latest.drafts.map((draft) => draft.inReplyTo))
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        {latest.memberName} on {latest.server}
      </Text>
      <Box flexDirection="column">
        <Text bold>Drafts waiting for your approval</Text>
        {latest.drafts.length === 0 && <Text dimColor>None.</Text>}
        {latest.drafts.map((draft) =>
          draftRow($, e, draft, latest.hasApproveButton, edited === draft.id, actions),
        )}
      </Box>
      <Box flexDirection="column">
        <Text bold>Notes waiting for a reply</Text>
        {latest.awaiting.length === 0 && open.length === 0 && <Text dimColor>None.</Text>}
        {latest.awaiting.map((waiting) => (
          <Text wrap="truncate-end">
            {waiting.from.name}: {firstLine(bodyOf(waiting.wrapped))}
            <Text dimColor>{drafted.has(waiting.noteId) ? ' · draft ready' : ' · drafting'}</Text>
          </Text>
        ))}
        {open.map((request) => (
          <Text wrap="truncate-end" dimColor>
            You asked for a draft{request.instruction === '' ? '' : `: ${firstLine(request.instruction)}`}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Conversations</Text>
        {latest.conversations.length === 0 && <Text dimColor>None yet.</Text>}
        {latest.conversations.map((conversation) => (
          <Text wrap="truncate-end">
            {conversationName(conversation)}
            {conversation.unreadCount > 0 ? ` · ${conversation.unreadCount} unread` : ''}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

function draftRow(
  $: EngineInterface,
  e: ResolveInput,
  draft: HomingbirdDraft,
  hasApproveButton: boolean,
  isEditing: boolean,
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  return (
    <Box key={`draft:${draft.id}`} flexDirection="column" borderStyle="round" paddingX={1}>
      <Text dimColor>
        {draft.inReplyTo === null ? 'New note' : 'Reply'}
        {draft.agentName === null ? '' : ` drafted by ${draft.agentName}`}
      </Text>
      {isEditing ? (
        <Input
          key={`edit:${draft.id}`}
          label="Edit, then send"
          value={draft.body}
          rows={4}
          submitLabel="Send"
          onSubmit={(body) => void actions.approve(draft.id, body)}
        />
      ) : (
        <Text>{draft.body}</Text>
      )}
      {hasApproveButton ? (
        <Box flexDirection="row" gap={1}>
          {!isEditing && (
            <Button
              key={`approve:${draft.id}`}
              label="Approve"
              variant="primary"
              onPress={() => void actions.approve(draft.id, null)}
            />
          )}
          <Button
            key={`edit-toggle:${draft.id}`}
            label={isEditing ? 'Cancel' : 'Edit'}
            onPress={() => void update($, editing, () => (isEditing ? null : draft.id))}
          />
          <Button
            key={`discard:${draft.id}`}
            label="Discard"
            onPress={() => void actions.discard(draft.id)}
          />
        </Box>
      ) : (
        <Text dimColor>Approve, edit or discard this draft in the Homingbird web client.</Text>
      )}
    </Box>
  )
}

const conversationName = (conversation: HomingbirdConversation): string =>
  conversation.kind === 'topic' ? `#${conversation.title ?? conversation.with}` : conversation.with

const firstLine = (text: string): string => text.split('\n')[0] ?? ''

const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'idle')
const desk = atom({ plugin: 'homingbird', key: 'desk' } as const, 'not-desk')
const editing = atom({ plugin: 'homingbird', key: 'editing' } as const, null)
const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null, { shape: 'overview-2' })
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)
const requests = atom({ plugin: 'homingbird', key: 'requests' } as const, [], { shape: 'requests-1' })
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
