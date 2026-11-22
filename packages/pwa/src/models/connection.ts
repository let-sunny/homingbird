import type { AsRead, MemberId } from '@homingbird/protocol'
import { clientLabel } from '../client-labels.ts'
import { deskUnavailableReason } from '../presence.ts'
import { strings } from '../strings.ts'
import { dateTimeText } from './time.ts'

/** Connection: whether the desk is awake, the person's credentials, and the channels its agent answers. */
export const connectionModel = (input: ConnectionInput): ConnectionModel => {
  const presence = input.directory.find((entry) => entry.member.id === input.viewerId)?.presence ?? null
  return {
    presence,
    unavailable: deskUnavailableReason(presence),
    recommendation:
      presence?.agentOnline === true || !hasConnectedAgent(input.credentials)
        ? null
        : recommendationOf(input.joinCodes),
    ...credentialsAndChannels(input),
  }
}

/**
 * How to connect an agent, step by step, and where the guide says more: open while none is connected,
 * folded as "another agent" once one is.
 */
export const firstStepsModel = (input: FirstStepsInput): FirstStepsModel | null => {
  if (input.credentials === null) return null
  const connected = hasConnectedAgent(input.credentials)
  const words = strings.firstSteps
  return {
    title: connected ? words.anotherTitle : words.title,
    folded: connected,
    steps: [
      { text: words.plugin, command: claudeCodeCommands(input.origin) },
      {
        text: words.commandLine,
        command: `npm install -g @homingbird/cli\nhomingbird login --server ${input.origin}`,
      },
      { text: words.run, command: 'homingbird run --agent "codex exec"' },
    ],
    joinHint: input.joinCodes ? words.joinHint : null,
    guide: { href: GUIDE_CONNECT_URL, label: words.guide },
  }
}

/** The two lines that install the Claude Code plugin and open it on this server. */
export const claudeCodeCommands = (origin: string): string => `${PLUGIN_INSTALL}\n/homingbird ${origin}`

/** The channels where the person's agent answers, as colleagues see them. */
export const helpedChannels = (
  input: Pick<ConnectionInput, 'channels' | 'directory' | 'viewerId'>,
): ReadonlyArray<string> => {
  const helped = input.channels.filter((channel) => channel.answering)
  const fromDirectory = input.directory.find((entry) => entry.member.id === input.viewerId)?.channels ?? []
  return helped.length > 0 ? helped.map((channel) => channel.slug) : fromDirectory
}

export interface ConnectionInput {
  readonly viewerId: MemberId
  readonly directory: ReadonlyArray<AsRead.DirectoryEntry>
  readonly credentials: ReadonlyArray<AsRead.Credential> | null
  readonly channels: ReadonlyArray<AsRead.Channel>
  /** Whether the server offers join codes, which the recommendation then points to. */
  readonly joinCodes: boolean
}

export interface FirstStepsInput {
  readonly credentials: ReadonlyArray<AsRead.Credential> | null
  readonly origin: string
  readonly joinCodes: boolean
}

export interface FirstStepsModel {
  readonly title: string
  /** Shown folded once an agent is connected, for a second computer or a colleague's question. */
  readonly folded: boolean
  readonly steps: ReadonlyArray<{ readonly text: string; readonly command: string }>
  /** Where join codes are offered, the way to set up a server without a browser. */
  readonly joinHint: string | null
  readonly guide: { readonly href: string; readonly label: string }
}

export interface ConnectionModel {
  readonly presence: AsRead.Presence | null
  /** Why the person's running desk cannot answer, and when it tries again; empty while it can. */
  readonly unavailable: ReadonlyArray<string>
  /** How to keep a connected agent awake, shown until it is; the first steps cover a person with none. */
  readonly recommendation: { readonly title: string; readonly body: string } | null
  readonly credentials: { readonly noAgents: boolean; readonly rows: ReadonlyArray<CredentialRow> } | null
  readonly helped: ReadonlyArray<string>
}

export interface CredentialRow {
  readonly credential: AsRead.Credential
  readonly revoked: boolean
  readonly kind: string
  readonly client: string
  readonly marks: ReadonlyArray<{
    readonly text: string
    readonly style: 'is-current' | 'is-you' | 'is-revoked'
  }>
  readonly facts: ReadonlyArray<{ readonly term: string; readonly value: string }>
  readonly revokeTitle: string
  readonly revokeBody: string
}

const credentialRow = (credential: AsRead.Credential): CredentialRow => ({
  credential,
  revoked: credential.revokedAt !== null,
  kind: strings.credentialKind[credential.kind],
  client: clientLabel(credential.client),
  marks: [
    ...(credential.current
      ? [
          { text: strings.credentialCurrent, style: 'is-current' as const },
          { text: strings.credentialThisBrowser, style: 'is-you' as const },
        ]
      : []),
    ...(credential.revokedAt !== null
      ? [{ text: strings.credentialRevoked, style: 'is-revoked' as const }]
      : []),
  ],
  facts: [
    {
      term: strings.credentialLastUsed,
      value: dateTimeText(credential.lastUsedAt, strings.credentialNeverUsed),
    },
    { term: strings.credentialExpires, value: dateTimeText(credential.expiresAt, '') },
  ],
  revokeTitle: credential.current ? strings.revokeCurrentTitle : strings.revokeTitle,
  revokeBody: credential.current
    ? strings.revokeCurrentBody({ name: credential.name })
    : strings.revokeBody({ name: credential.name }),
})

const credentialsAndChannels = (input: ConnectionInput) => ({
  credentials:
    input.credentials === null
      ? null
      : {
          noAgents: !hasConnectedAgent(input.credentials),
          rows: input.credentials.map(credentialRow),
        },
  helped: helpedChannels(input),
})

const hasConnectedAgent = (credentials: ReadonlyArray<AsRead.Credential> | null): boolean =>
  credentials?.some((credential) => credential.kind === 'agent' && credential.revokedAt === null) === true

const recommendationOf = (joinCodes: boolean): ConnectionModel['recommendation'] => ({
  title: strings.deskTitle,
  body: joinCodes ? strings.deskBodyWithJoin : strings.deskBody,
})

const PLUGIN_INSTALL = '/plugin install homingbird --marketplace let-sunny/homingbird'
const GUIDE_CONNECT_URL = 'https://github.com/let-sunny/homingbird/blob/main/docs/guide.md#connect-an-agent'
