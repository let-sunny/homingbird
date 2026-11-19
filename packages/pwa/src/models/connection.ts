import type { AsRead, MemberId, Presence } from '@homingbird/protocol'
import { strings } from '../strings.ts'
import { dateTimeText } from './time.ts'

/** Connection: whether the desk is awake, the person's credentials, and the channels its agent answers. */
export const connectionModel = (input: ConnectionInput): ConnectionModel => ({
  presence: input.directory.find((entry) => entry.member.id === input.viewerId)?.presence ?? null,
  credentials:
    input.credentials === null
      ? null
      : {
          noAgents: !input.credentials.some(
            (credential) => credential.kind === 'agent' && credential.revokedAt === null,
          ),
          rows: input.credentials.map(credentialRow),
        },
  helped: helpedChannels(input),
})

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
}

export interface ConnectionModel {
  readonly presence: Presence | null
  readonly credentials: { readonly noAgents: boolean; readonly rows: ReadonlyArray<CredentialRow> } | null
  readonly helped: ReadonlyArray<string>
}

export interface CredentialRow {
  readonly credential: AsRead.Credential
  readonly revoked: boolean
  readonly kind: string
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
