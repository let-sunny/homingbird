import { Schema as S } from '@homingbird/kernel'
import { ANSWERING_FLOW_MAX_CHARACTERS } from './answering-flow.ts'
import { CharacterSpec } from './character.ts'
import { ConversationId, CredentialId, DraftRequestId, MemberId, NoteId, Timestamp } from './ids.ts'

export const NOTE_BODY_MAX = 16_000
export const NoteBody = S.refine<string>(
  'note-body',
  (s) => s.trim().length > 0,
  'expected a non-empty note',
)(S.string({ minLength: 1, maxLength: NOTE_BODY_MAX }))

/** What wrote an agent's note: a label shown to people, never read by a model. */
export const AGENT_LABEL_MAX = 80
export const AgentLabel = S.refine<string>(
  'agent-label',
  (text) => text.trim() !== '' && !/[\p{Cc}\p{Cf}]/u.test(text),
  'expected one line of printable text',
)(S.string({ minLength: 1, maxLength: AGENT_LABEL_MAX }))

/** A label as an integration was handed it, made printable: control and format characters out, at most one line of 80. */
export const agentLabelOf = (text: unknown): string | null => {
  if (typeof text !== 'string') return null
  const label = text
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, AGENT_LABEL_MAX)
    .trim()
  return label === '' ? null : label
}

export const NOTE_BASIS_MAX = 1000
export const NoteBasis = S.string({ maxLength: NOTE_BASIS_MAX })

export const PROFILE_MAX = 500

export const Role = S.literal('member', 'admin')
export type Role = S.Infer<typeof Role>

export const MemberStatus = S.literal('active', 'deactivated')
export type MemberStatus = S.Infer<typeof MemberStatus>

export const LOCALES = ['en', 'ko'] as const
export const Locale = S.literal(...LOCALES)
export type Locale = S.Infer<typeof Locale>
export const DEFAULT_LOCALE: Locale = 'en'

export const Member = S.struct({
  id: MemberId,
  email: S.string({ maxLength: 320 }),
  name: S.string({ maxLength: 200 }),
  profile: S.string({ maxLength: PROFILE_MAX }),
  role: Role,
  status: MemberStatus,
  createdAt: Timestamp,
  character: S.nullable(CharacterSpec),
})
export type Member = S.Infer<typeof Member>

export const ChannelSlug = S.string({ pattern: /^[a-z0-9][a-z0-9-]{0,39}$/, maxLength: 40 })
export const CHANNEL_DESCRIPTION_MAX = 200

export const ChannelVisibility = S.literal('open', 'private')
export type ChannelVisibility = S.Infer<typeof ChannelVisibility>

export const Channel = S.struct({
  slug: ChannelSlug,
  description: S.string({ maxLength: CHANNEL_DESCRIPTION_MAX }),
  conversationId: ConversationId,
  visibility: ChannelVisibility,
  memberCount: S.int({ min: 0 }),
  helperCount: S.int({ min: 0 }),
  joined: S.boolean,
  answering: S.boolean,
  managing: S.boolean,
  createdAt: Timestamp,
})
export type Channel = S.Infer<typeof Channel>

export const ChannelMember = S.struct({ memberId: MemberId, answering: S.boolean, manager: S.boolean })
export type ChannelMember = S.Infer<typeof ChannelMember>

export const Relation = S.literal('self', 'contact', 'request_sent', 'request_received', 'blocked', 'none')
export type Relation = S.Infer<typeof Relation>

export const Presence = S.struct({ humanOnline: S.boolean, agentOnline: S.boolean })
export type Presence = S.Infer<typeof Presence>

export const PUBLIC_TEXT_MAX = 200

/** A sentence a member wrote for colleagues about one of their agent's principles. */
export const PublicText = S.refine<string>(
  'public-text',
  (text) => text.trim().length > 0 && !text.includes('\n'),
  'expected one line for colleagues',
)(S.string({ minLength: 1, maxLength: PUBLIC_TEXT_MAX }))

export const DirectoryEntry = S.struct({
  member: Member,
  agentIntroduction: S.optional(S.array(PublicText)),
  presence: Presence,
  lastSeenAt: S.nullable(Timestamp),
  relation: Relation,
  canMessage: S.boolean,
  channels: S.array(ChannelSlug),
})
export type DirectoryEntry = S.Infer<typeof DirectoryEntry>

export const ContactMode = S.literal('open', 'contacts')
export type ContactMode = S.Infer<typeof ContactMode>

export const NoteStatus = S.literal('draft', 'sent', 'discarded')
export type NoteStatus = S.Infer<typeof NoteStatus>

export const Origin = S.literal('agent', 'human_edited', 'human')
export type Origin = S.Infer<typeof Origin>

export const ReceiptState = S.literal('delivered', 'read', 'drafting', 'replied')
export type ReceiptState = S.Infer<typeof ReceiptState>

export const Receipt = S.struct({
  memberId: MemberId,
  state: ReceiptState,
  deliveredAt: Timestamp,
  readAt: S.nullable(Timestamp),
  draftingAt: S.nullable(Timestamp),
  repliedAt: S.nullable(Timestamp),
})
export type Receipt = S.Infer<typeof Receipt>

export const Note = S.struct({
  id: NoteId,
  conversationId: ConversationId,
  authorId: MemberId,
  status: NoteStatus,
  body: S.string({ maxLength: NOTE_BODY_MAX }),
  inReplyTo: S.nullable(NoteId),
  origin: Origin,
  agentName: S.nullable(S.string({ maxLength: 200 })),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  sentAt: S.nullable(Timestamp),
  receipts: S.array(Receipt),
  basis: S.optional(S.nullable(NoteBasis)),
  agentClient: S.optional(S.nullable(AgentLabel)),
  agentModel: S.optional(S.nullable(AgentLabel)),
})
export type Note = S.Infer<typeof Note>

export const DRAFT_INSTRUCTION_MAX = 2000
export const RELEASE_REASON_MAX = 500

export const NoticeKind = S.literal('released', 'channel_archived')
export type NoticeKind = S.Infer<typeof NoticeKind>

/** Something that happened to one person's note, kept so that it survives a reload; only that person sees it. */
export const Notice = S.struct({
  kind: NoticeKind,
  noteId: NoteId,
  conversationId: ConversationId,
  reason: S.nullable(S.string({ maxLength: RELEASE_REASON_MAX })),
  agentName: S.nullable(S.string({ maxLength: 200 })),
  channel: S.nullable(ChannelSlug),
  at: Timestamp,
})
export type Notice = S.Infer<typeof Notice>

export const DraftRequest = S.struct({
  id: DraftRequestId,
  conversationId: ConversationId,
  inReplyTo: S.nullable(NoteId),
  instruction: S.string({ maxLength: DRAFT_INSTRUCTION_MAX }),
  agentId: S.nullable(CredentialId),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  cancelledAt: S.nullable(Timestamp),
  draftIds: S.array(NoteId),
})
export type DraftRequest = S.Infer<typeof DraftRequest>

export const ConversationKind = S.literal('direct', 'group', 'channel')
export type ConversationKind = S.Infer<typeof ConversationKind>

export const Conversation = S.struct({
  id: ConversationId,
  kind: ConversationKind,
  title: S.nullable(S.string({ maxLength: 200 })),
  participantIds: S.array(MemberId, { minItems: 1 }),
  createdAt: Timestamp,
  lastActivityAt: Timestamp,
  lastNote: S.nullable(Note),
  unreadCount: S.int({ min: 0 }),
  draftCount: S.int({ min: 0 }),
  archivedAt: S.nullable(Timestamp),
})
export type Conversation = S.Infer<typeof Conversation>

export const CredentialKind = S.literal('human', 'agent')
export type CredentialKind = S.Infer<typeof CredentialKind>

export const Credential = S.struct({
  id: CredentialId,
  kind: CredentialKind,
  name: S.string({ maxLength: 200 }),
  client: S.string({ maxLength: 200 }),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  lastUsedAt: S.nullable(Timestamp),
  revokedAt: S.nullable(Timestamp),
  current: S.boolean,
})
export type Credential = S.Infer<typeof Credential>

export const ContactState = S.literal('accepted', 'request_sent', 'request_received')
export type ContactState = S.Infer<typeof ContactState>

export const Contact = S.struct({ memberId: MemberId, state: ContactState, since: Timestamp })
export type Contact = S.Infer<typeof Contact>

export const Settings = S.struct({
  allowedDomains: S.array(S.string({ minLength: 1, maxLength: 253, pattern: /^[a-z0-9.-]+$/ }), {
    maxItems: 100,
  }),
  contactMode: ContactMode,
  auditRetentionDays: S.nullable(S.int({ min: 1, max: 36_500 })),
  answeringFlow: S.optional(S.nullable(S.string({ maxLength: ANSWERING_FLOW_MAX_CHARACTERS }))),
  features: S.optional(S.record(S.boolean)),
})
export type Settings = S.Infer<typeof Settings>

export const AnsweringFlowSetting = S.struct({
  flow: S.nullable(S.string({ maxLength: ANSWERING_FLOW_MAX_CHARACTERS })),
  updatedAt: S.nullable(Timestamp),
})
export type AnsweringFlowSetting = S.Infer<typeof AnsweringFlowSetting>

export const AuditEntry = S.struct({
  id: S.int({ min: 1 }),
  at: Timestamp,
  actorId: S.nullable(MemberId),
  credentialId: S.nullable(CredentialId),
  credentialKind: S.nullable(CredentialKind),
  action: S.string({ maxLength: 100 }),
  target: S.nullable(S.string({ maxLength: 200 })),
  detail: S.unknown,
})
export type AuditEntry = S.Infer<typeof AuditEntry>
