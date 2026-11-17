import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, ResolveInput } from 'claude-code'

import type { HomingbirdConnection, HomingbirdDraft, HomingbirdOverview } from '../types'
import { bodyOf } from './drafting'
import { PIP_COLUMNS, PIP_PNG, PIP_ROWS } from './pip'

export const PANE = 'homingbird'

const overview = atom({ plugin: 'homingbird', key: 'overview' } as const, null)
const connection = atom({ plugin: 'homingbird', key: 'connection' } as const, 'starting')
const signIn = atom({ plugin: 'homingbird', key: 'signIn' } as const, null)
const editing = atom({ plugin: 'homingbird', key: 'editing' } as const, null)
const problem = atom({ plugin: 'homingbird', key: 'problem' } as const, null)

type PipImage = (props: { key: string; source: { png: string }; columns: number; rows: number; alt: string }) => RenderElement

export interface PaneActions {
  readonly defaultServer: string
  readonly connect: (server: string) => Promise<void>
  readonly approve: (draftId: string, editedBody: string | null) => Promise<void>
  readonly discard: (draftId: string) => Promise<void>
}

export async function renderPane(
  $: EngineInterface,
  e: ResolveInput,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text, Image } = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Image?: PipImage }
  const state = await read($, connection)
  const latest = await read($, overview)
  const trouble = await read($, problem)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        {Image !== undefined && (
          <Image key="pip" source={{ png: PIP_PNG }} columns={PIP_COLUMNS} rows={PIP_ROWS} alt=" " />
        )}
        <Text bold>Homingbird · {CONNECTION_LABELS[state]}</Text>
      </Box>
      {trouble !== null && <Text color="warning">{trouble}</Text>}
      {latest === null ? await signInRows($, e, actions) : await overviewRows($, e, latest, actions)}
    </Box>
  )
}

const CONNECTION_LABELS: Readonly<Record<HomingbirdConnection, string>> = {
  starting: 'starting',
  live: 'live',
  polling: 'checking every half minute',
  'signed-out': 'not connected',
  unavailable: 'command line not found',
}

async function signInRows($: EngineInterface, e: ResolveInput, actions: PaneActions): Promise<RenderElement> {
  const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
  const pending = await read($, signIn)
  if (pending !== null)
    return (
      <Box flexDirection="column">
        <Text>Open this page and confirm the code {pending.userCode}:</Text>
        <Link href={pending.verificationUri} label={pending.verificationUri} />
        <Text dimColor>Tick "approve button" there to approve notes from this pane.</Text>
      </Box>
    )
  return (
    <Box flexDirection="column">
      <Text>Connect this session to your organization's Homingbird server.</Text>
      {actions.defaultServer === '' ? (
        <Input
          key="server"
          label="Server URL"
          placeholder="https://homingbird.example.com"
          submitLabel="Connect"
          onSubmit={(server) => void actions.connect(server.trim())}
        />
      ) : (
        <Button key="connect" label="Connect" variant="primary" onPress={() => void actions.connect(actions.defaultServer)} />
      )}
    </Box>
  )
}

async function overviewRows(
  $: EngineInterface,
  e: ResolveInput,
  latest: HomingbirdOverview,
  actions: PaneActions,
): Promise<RenderElement> {
  const { Box, Text } = $.ui.resolve(e)
  const edited = await read($, editing)
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        {latest.memberName} on {latest.server}
      </Text>
      <Box flexDirection="column">
        <Text bold>Drafts waiting for your approval</Text>
        {latest.drafts.length === 0 && <Text dimColor>None.</Text>}
        {latest.drafts.map((draft) => draftRow($, e, draft, latest.hasApproveButton, edited === draft.id, actions))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Waiting for a reply</Text>
        {latest.awaiting.length === 0 && <Text dimColor>None.</Text>}
        {latest.awaiting.map((waiting) => (
          <Text wrap="truncate-end">
            {waiting.from.name}: {firstLine(bodyOf(waiting.wrapped))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Conversations</Text>
        {latest.conversations.length === 0 && <Text dimColor>None yet.</Text>}
        {latest.conversations.map((conversation) => (
          <Text wrap="truncate-end">
            {conversation.with}
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
            <Button key={`approve:${draft.id}`} label="Approve" variant="primary" onPress={() => void actions.approve(draft.id, null)} />
          )}
          <Button
            key={`edit-toggle:${draft.id}`}
            label={isEditing ? 'Cancel' : 'Edit'}
            onPress={() => void update($, editing, () => (isEditing ? null : draft.id))}
          />
          <Button key={`discard:${draft.id}`} label="Discard" onPress={() => void actions.discard(draft.id)} />
        </Box>
      ) : (
        <Text dimColor>Approve, edit or discard this draft in the Homingbird web client.</Text>
      )}
    </Box>
  )
}

const firstLine = (text: string): string => text.split('\n')[0] ?? ''
